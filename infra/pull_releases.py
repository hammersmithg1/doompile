#!/usr/bin/env python3
"""Pull checked main releases using read access to GitHub, without an Actions runner."""

import argparse
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tarfile
import tempfile
import zipfile

from instance import instance_environment
from preserve_native_artifacts import preserve
from publish_macos_update import checksum, publish


WORKFLOWS = {
    '.github/workflows/web.yml': {'web', 'ios', 'macos'},
    '.github/workflows/ios.yml': {'ios'},
    '.github/workflows/macos.yml': {'macos'},
}
RECEIPT_NAME = re.compile(r'doompile-delivery-(web|ios|macos)-([1-9][0-9]*)')
SHA = re.compile(r'[0-9a-f]{40}')


def trusted_run(run, repository_id, commit):
    return (
        run.get('path') in WORKFLOWS
        and run.get('head_branch') == 'main'
        and run.get('head_sha') == commit
        and (run.get('head_repository') or {}).get('id') == repository_id
        and (run.get('repository') or {}).get('id') == repository_id
        and run.get('event') in ('push', 'workflow_dispatch')
        and run.get('status') == 'completed'
        and run.get('conclusion') in ('success', 'failure')
    )


class GitHub:
    def __init__(self, repository, repository_id):
        if not re.fullmatch(r'[\w.-]+/[\w.-]+', repository, re.ASCII):
            raise ValueError('Set DOOMPILE_DELIVERY_REPOSITORY to owner/repository.')
        self.repository = repository
        self.repository_id = repository_id
        self.path = 'repos/' + repository

    def read(self, suffix=''):
        return json.loads(subprocess.check_output(['gh', 'api', self.path + suffix]))

    def main(self):
        value = self.read('/git/ref/heads/main')['object']['sha']
        if not SHA.fullmatch(value):
            raise ValueError('Invalid main commit returned by GitHub.')
        return value

    def download(self, artifact, output):
        expected = artifact.get('digest', '')
        if not re.fullmatch(r'sha256:[0-9a-f]{64}', expected):
            raise ValueError('Artifact has no verified digest.')
        with output.open('xb') as stream:
            subprocess.run(
                ['gh', 'api', f"{self.path}/actions/artifacts/{artifact['id']}/zip"],
                stdout=stream, check=True,
            )
        if 'sha256:' + checksum(output) != expected:
            raise ValueError('Artifact digest mismatch.')


def read_receipt(path, kind, attempt, run, repository_id):
    with zipfile.ZipFile(path) as archive:
        if archive.namelist() != ['delivery.json'] or archive.getinfo('delivery.json').file_size > 4096:
            raise ValueError('Invalid release receipt archive.')
        value = json.loads(archive.read('delivery.json'))
    expected = {
        'schema': 1, 'kind': kind, 'attempt': attempt, 'run': run['id'],
        'commit': run['head_sha'], 'repository_id': repository_id,
    }
    if not isinstance(value, dict) or any(value.get(key) != item for key, item in expected.items()):
        raise ValueError('Release receipt does not match its trusted run.')
    identifier = value.get('artifact_id')
    if (kind == 'web' and identifier is not None) or (kind != 'web' and (type(identifier) is not int or identifier <= 0)):
        raise ValueError('Invalid release artifact reference.')
    return value


def unseal(archive_path, directory, identity):
    if not identity:
        raise ValueError('Set DOOMPILE_DELIVERY_IDENTITY on the release receiver.')
    with zipfile.ZipFile(archive_path) as archive:
        if archive.namelist() != ['native.tar.age']:
            raise ValueError('Invalid sealed native artifact.')
        member = archive.getinfo('native.tar.age')
        if stat.S_ISLNK(member.external_attr >> 16):
            raise ValueError('Invalid sealed native artifact.')
        archive.extract(member, directory)
    # age reads its identity over stdin. The clear archive only exists as a pipe.
    with subprocess.Popen(
        ['age', '--decrypt', '--identity', '-', str(directory / 'native.tar.age')],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    ) as decrypt:
        decrypt.stdin.write(identity.rstrip().encode('utf-8') + b'\n')
        decrypt.stdin.close()
        with tarfile.open(fileobj=decrypt.stdout, mode='r|gz') as archive:
            for member in archive:
                path = PurePosixPath(member.name)
                if not path.parts or '..' in path.parts or path.parts[0] not in ('release', 'symbols'):
                    raise ValueError('Unexpected directory in native release.')
                archive.extract(member, directory, filter='data')
        while decrypt.stdout.read(65536):
            pass
        if decrypt.wait():
            raise ValueError('Could not authenticate the native release archive.')
    if not (directory/'release').is_dir() or not (directory/'symbols').is_dir():
        raise ValueError('Native release or symbols are missing.')


def verify_native(directory, receipt):
    manifest = json.loads((directory / 'release' / 'release.json').read_text())
    name = manifest['file']
    if (manifest.get('platform') != receipt['kind'] or manifest.get('commit') != receipt['commit']
            or not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+\.(ipa|zip)', name)):
        raise ValueError('Native release manifest does not match its checked source.')
    archive = directory / 'release' / name
    if archive.is_symlink() or archive.stat().st_size != manifest['size'] or checksum(archive) != manifest['sha256']:
        raise ValueError('Native archive does not match its manifest.')


def deploy_web(root, github, commit, directory):
    active = root / 'runtime/prod/release.json'
    if active.is_file() and json.loads(active.read_text()).get('git_commit') == commit[:12]:
        return
    ref = 'refs/doompile-delivery/main'
    subprocess.run([
        'git', '-C', str(root), 'fetch', '--no-tags', '--no-write-fetch-head',
        f'https://github.com/{github.repository}.git', f'+refs/heads/main:{ref}',
    ], check=True)
    if subprocess.check_output(['git', '-C', str(root), 'rev-parse', ref], text=True).strip() != commit:
        raise ValueError('Main advanced before deployment. Waiting for its checks.')
    source = directory / 'source'
    subprocess.run(['git', '-C', str(root), 'worktree', 'add', '--detach', str(source), commit], check=True)
    try:
        subprocess.run(
            ['bash', str(source/'infra/deploy.sh'), 'prod'],
            env={**os.environ, 'DOOMPILE_PROJECT_ROOT': str(root)}, check=True,
        )
    finally:
        subprocess.run(['git', '-C', str(root), 'worktree', 'remove', '--force', str(source)], check=True)


def deliver(root, github, run, kind, attempt, receipt_artifact, artifacts, directory, environment):
    receipt_path = directory / 'receipt.zip'
    github.download(receipt_artifact, receipt_path)
    receipt = read_receipt(receipt_path, kind, attempt, run, github.repository_id)
    if github.main() != receipt['commit']:
        raise ValueError('Main advanced while verifying the release.')
    if kind == 'web':
        deploy_web(root, github, receipt['commit'], directory)
        return
    artifact = artifacts.get(receipt['artifact_id'])
    if artifact is None or artifact.get('name') != f'doompile-native-{kind}-{attempt}':
        raise ValueError('The sealed package is absent from the trusted run.')
    package = directory / 'package.zip'
    github.download(artifact, package)
    unseal(package, directory, environment.get('DOOMPILE_DELIVERY_IDENTITY'))
    verify_native(directory, receipt)
    preserve(kind, f"{run['id']}-{attempt}", [directory/'release', directory/'symbols'], root)
    if kind == 'macos':
        if github.main() != receipt['commit']:
            raise ValueError('Main advanced before publishing the Mac update.')
        publish(directory/'release', root/'runtime/prod/downloads/macos')


def pull(root, github, environment, dry_run=False):
    if github.read().get('id') != github.repository_id:
        raise ValueError('The configured GitHub repository ID does not match.')
    commit = github.main()
    runs = github.read(f'/actions/runs?head_sha={commit}&branch=main&status=completed&per_page=100')['workflow_runs']
    state = root / 'runtime/ci-delivery'
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        ledger = state / 'delivered.json'
        delivered = set(json.loads(ledger.read_text())) if ledger.is_file() else set()
        failed = False
        for run in sorted(runs, key=lambda row: row['id']):
            if not trusted_run(run, github.repository_id, commit):
                continue
            rows = github.read(f"/actions/runs/{run['id']}/artifacts?per_page=100")['artifacts']
            artifacts = {row['id']: row for row in rows if row.get('expired') is False}
            for identifier, row in sorted(artifacts.items()):
                name = RECEIPT_NAME.fullmatch(row['name'])
                if not name or identifier in delivered:
                    continue
                kind, attempt = name[1], int(name[2])
                if kind not in WORKFLOWS[run['path']] or attempt > run['run_attempt']:
                    continue
                if dry_run:
                    print(f"Ready {kind} receipt for run {run['id']}-{attempt}")
                    continue
                try:
                    with tempfile.TemporaryDirectory(prefix='apply-', dir=state) as temp:
                        deliver(root, github, run, kind, attempt, row, artifacts, Path(temp), environment)
                except (ValueError, OSError, subprocess.CalledProcessError, tarfile.TarError, zipfile.BadZipFile) as error:
                    failed = True
                    print(f"Delivery failed for {kind} run {run['id']}-{attempt}: {error}", flush=True)
                    continue
                delivered.add(identifier)
                pending = state / '.delivered.json.new'
                pending.write_text(json.dumps(sorted(delivered)) + '\n')
                pending.replace(ledger)
                print(f"Delivered {kind} for {commit[:12]} from run {run['id']}-{attempt}", flush=True)
        if dry_run:
            print(f'Checked delivery source for main {commit[:12]}.')
        if failed:
            raise RuntimeError('One or more releases are pending retry.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve()
    environment = instance_environment(root)
    github = GitHub(environment.get('DOOMPILE_DELIVERY_REPOSITORY', ''),
                    int(environment.get('DOOMPILE_DELIVERY_REPOSITORY_ID', '0')))
    pull(root, github, environment, args.dry_run)
