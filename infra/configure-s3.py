#!/usr/bin/env python3
"""Create absent S3 credentials in setec; never display or persist their values locally.
Run on an admin device through agent_secrets.py. Existing credentials are preserved.
"""
import os
import secrets
import subprocess
from pathlib import Path

wrapper = Path.home() / '.agents/common/scripts/agent_secrets.py'
for name in ('DOOMPILE_S3_ACCESS_KEY', 'DOOMPILE_S3_SECRET_KEY'):
    if os.environ.get(name):
        print(f'Already configured: {name}')
        continue
    value = ('doompile-' + secrets.token_hex(8)) if name.endswith('ACCESS_KEY') else secrets.token_urlsafe(48)
    subprocess.run(['python3', str(wrapper), '--scope', 'devbox', '--put', name], input=value.encode(), check=True, stdout=subprocess.DEVNULL)
    print(f'Created in devbox: {name}')
