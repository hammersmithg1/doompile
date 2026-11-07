#!/usr/bin/env python3
"""Native release entry point; invoke through the canonical setec wrapper."""
import importlib.util
import os
import socket
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
NAMES = ['APPLE_TEAM_ID','APP_STORE_CONNECT_KEY_ID','APP_STORE_CONNECT_ISSUER_ID',
 'APP_STORE_CONNECT_P8_BASE64','IOS_DISTRIBUTION_P12_BASE64','IOS_DISTRIBUTION_P12_PASSWORD',
 'IOS_PROFILE_APP_BASE64','IOS_PROFILE_SHARE_BASE64','IOS_PROFILE_SAFARI_BASE64',
 'IOS_PROFILE_ACTION_BASE64','MACOS_DEVELOPER_ID_P12_BASE64','MACOS_DEVELOPER_ID_P12_PASSWORD',
 'DOOMPILE_MACOS_UPDATE_PRIVATE_KEY']

def restore_ci_dns():
    # Load setec inputs first, then retain runner DNS for public requests.
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        return
    subprocess.run(['sudo','tailscale','set','--accept-dns=false'],check=True)
    if os.environ.get('RUNNER_OS') == 'macOS':
        # github-action@v4 configures Ethernet outside the daemon; match its reset.
        for setting in ('-setdnsservers','-setsearchdomains'):
            subprocess.run(['networksetup',setting,'Ethernet','Empty'],check=True)
    deadline = time.monotonic()+30
    while True:
        try:
            for host in ('github.com', 'api.appstoreconnect.apple.com'):
                socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
            print('Public runner DNS is available; Tailscale remains connected',flush=True)
            return
        except socket.gaierror:
            if time.monotonic()>=deadline:
                raise SystemExit('Public runner DNS did not recover after leaving tailnet DNS')
            time.sleep(2)


def main():
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        if os.environ.get('GITHUB_REF') != 'refs/heads/main':
            raise SystemExit('Release signing is limited to main')
        for name in NAMES:
            value = os.environ.get(name)
            if value:
                escaped = value.replace('%','%25').replace('\r','%0D').replace('\n','%0A')
                print('::add-mask::'+escaped, flush=True)
    restore_ci_dns()
    environment = os.environ.copy()
    kind = sys.argv[1]
    if kind == 'ios':
        spec = importlib.util.spec_from_file_location('apple_api', ROOT/'.agents/ci/apple_api.py')
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
        number = api.next_build()
        environment['DOOMPILE_IOS_BUILD_NUMBER'] = number
        environment['IOS_SIGNING_MODE'] = environment.get('IOS_SIGNING_MODE') or 'manual'
        print('Uploading iOS build '+number, flush=True)
        command = ['bash', 'apps/ios/scripts/testflight.sh']
    elif kind in ('macos-personal','macos-notarized'):
        number = environment.get('DOOMPILE_MACOS_BUILD_NUMBER','').strip()
        if not number:
            series = environment.get('DOOMPILE_MACOS_BUILD_SERIES', '')
            run = environment.get('GITHUB_RUN_ID', '')
            attempt = environment.get('GITHUB_RUN_ATTEMPT', '')
            if not all(part.isdecimal() and int(part) > 0 for part in (series, run, attempt)):
                raise SystemExit('Set DOOMPILE_MACOS_BUILD_SERIES for CI or an explicit Mac build number.')
            # The configured series starts above the previous release channel.
            # Run IDs distinguish automatic and manually dispatched builds.
            number = f'{series}.{run}.{attempt}'
        environment['DOOMPILE_MACOS_BUILD_NUMBER'] = number
        print('Packaging Mac build '+number, flush=True)
        command = ['bash', 'apps/macos/scripts/'+('personal-release.sh' if kind == 'macos-personal' else 'release.sh')]
    else:
        raise SystemExit('Expected ios, macos-personal or macos-notarized')
    subprocess.run(command, cwd=ROOT, env=environment, check=True)
    if kind == 'ios':
        deadline = time.monotonic()+1200
        while time.monotonic()<deadline:
            api.access_token.cache_clear()
            found = next((b for b in api.builds().get('data',[]) if b['attributes']['version']==number), None)
            state = found['attributes']['processingState'] if found else 'WAITING_FOR_APPLE'
            print('App Store Connect '+number+': '+state, flush=True)
            if state == 'VALID':
                break
            if state in ('FAILED','INVALID'):
                raise SystemExit('Apple rejected build '+number)
            time.sleep(20)
        else:
            raise SystemExit('Apple processing is still pending; check App Store Connect before announcing the release')

if __name__ == '__main__':
    main()
