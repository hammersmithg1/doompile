import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pull_releases import GitHub, pull, read_receipt, trusted_run, unseal, verify_native
from release_receipt import receipt
from seal_native_artifact import seal


COMMIT = 'a' * 40
RUN = {
    'id': 12, 'run_attempt': 1, 'head_branch': 'main', 'head_sha': COMMIT,
    'path': '.github/workflows/web.yml', 'repository': {'id': 7},
    'head_repository': {'id': 7}, 'event': 'push', 'status': 'completed',
    'conclusion': 'success',
}
ENVIRONMENT = {
    'GITHUB_SHA': COMMIT, 'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'push',
    'GITHUB_REPOSITORY_ID': '7', 'GITHUB_RUN_ID': '12', 'GITHUB_RUN_ATTEMPT': '1',
}


class ReleaseDeliveryTests(unittest.TestCase):
    def test_only_completed_runs_from_the_configured_main_are_trusted(self):
        self.assertTrue(trusted_run(RUN, 7, COMMIT))
        for change in (
            {'head_repository': {'id': 8}}, {'repository': {'id': 8}},
            {'event': 'pull_request'}, {'event': 'pull_request_target'},
            {'head_sha': 'b' * 40}, {'head_branch': 'feature'},
            {'conclusion': 'cancelled'}, {'status': 'in_progress'},
            {'path': '.github/workflows/other.yml'},
        ):
            with self.subTest(change=change):
                self.assertFalse(trusted_run({**RUN, **change}, 7, COMMIT))

    def test_receipt_is_bound_to_the_run_and_attempt(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'receipt.zip'
            value = receipt('macos', ENVIRONMENT, 70)
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('delivery.json', json.dumps(value))
            self.assertEqual(read_receipt(path, 'macos', 1, RUN, 7), value)
            with self.assertRaisesRegex(ValueError, 'does not match'):
                read_receipt(path, 'macos', 2, RUN, 7)
            with self.assertRaisesRegex(ValueError, 'trusted main'):
                receipt('web', {**ENVIRONMENT, 'GITHUB_EVENT_NAME': 'pull_request'})

    def test_digest_mismatch_stops_delivery(self):
        client = GitHub('owner/project', 7)
        with tempfile.TemporaryDirectory() as temp, patch('pull_releases.subprocess.run') as download:
            download.side_effect = lambda *args, **options: options['stdout'].write(b'tampered')
            with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                client.download({'id': 3, 'digest': 'sha256:' + '0' * 64}, Path(temp)/'file.zip')

    def test_an_unavailable_native_package_does_not_block_a_checked_web_release(self):
        client = Mock(repository_id=7)
        client.main.return_value = COMMIT
        client.read.side_effect = [
            {'id': 7},
            {'workflow_runs': [RUN, {**RUN, 'id': 13, 'event': 'pull_request'}]},
            {'artifacts': [
                {'id': 70, 'name': 'doompile-delivery-macos-1', 'expired': False},
                {'id': 71, 'name': 'doompile-delivery-web-1', 'expired': False},
            ]},
        ]
        with tempfile.TemporaryDirectory() as temp, patch('pull_releases.deliver') as deliver:
            root = Path(temp)
            deliver.side_effect = [ValueError('Native package unavailable'), None]
            with self.assertRaisesRegex(RuntimeError, 'pending retry'):
                pull(root, client, {})
            self.assertEqual([call.args[3] for call in deliver.call_args_list], ['macos', 'web'])
            self.assertEqual(json.loads((root/'runtime/ci-delivery/delivered.json').read_text()), [71])

    @unittest.skipUnless(shutil.which('age'), 'age is needed for the private transport round trip')
    def test_native_release_and_symbols_round_trip_without_public_plaintext(self):
        identity = subprocess.run(['age-keygen'], capture_output=True, text=True, check=True).stdout
        recipient = subprocess.run(['age-keygen', '-y'], input=identity, capture_output=True, text=True, check=True).stdout.strip()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            release = root/'build/release'
            symbols = root/'build/Doompile.app.dSYM'
            release.mkdir(parents=True)
            symbols.mkdir()
            binary = b'fixture native binary'
            (release/'Doompile-macOS-41.1.zip').write_bytes(binary)
            (release/'release.json').write_text(json.dumps({
                'file': 'Doompile-macOS-41.1.zip', 'platform': 'macos', 'commit': COMMIT,
                'size': len(binary), 'sha256': hashlib.sha256(binary).hexdigest(),
            }))
            (symbols/'fixture').write_text('private debug symbols')
            sealed = root/'native.tar.age'
            seal(release, symbols, sealed, recipient)
            self.assertNotIn(binary, sealed.read_bytes())
            self.assertNotIn(b'private debug symbols', sealed.read_bytes())
            artifact = root/'artifact.zip'
            with zipfile.ZipFile(artifact, 'w') as archive:
                archive.write(sealed, 'native.tar.age')
            output = root/'received'
            output.mkdir()
            unseal(artifact, output, identity)
            verify_native(output, {'kind': 'macos', 'commit': COMMIT})
            self.assertEqual((output/'symbols/Doompile.app.dSYM/fixture').read_text(), 'private debug symbols')
            with self.assertRaisesRegex(ValueError, 'does not match'):
                verify_native(output, {'kind': 'macos', 'commit': 'b' * 40})


if __name__ == '__main__':
    unittest.main()
