#!/usr/bin/env python3
"""Install only the public setec client/config on an ephemeral CI machine."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import urlsplit

server = os.environ.get('DOOMPILE_CI_SETEC_URL', '').strip()
parsed = urlsplit(server)
if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
        or parsed.password is not None or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
    raise SystemExit('Configure the CI secret service as an HTTPS origin.')
device = os.environ.get('DOOMPILE_CI_SETEC_DEVICE') or 'doompile-ci'
if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}', device):
    raise SystemExit('Invalid CI device profile.')

root = Path(__file__).resolve().parent
home = Path.home() / '.agents'
(home/'common/scripts').mkdir(parents=True, exist_ok=True)
(home/'local').mkdir(parents=True, exist_ok=True)
shutil.copyfile(root/'agent_secrets.py', home/'common/scripts/agent_secrets.py')
(home/'common/setec.json').write_text(json.dumps({'server':server})+'\n')
(home/'local/setec.json').write_text(json.dumps({'role':'machine','device':device})+'\n')
subprocess.run(['sudo','tailscale','set','--webclient'], check=True)
prefs = json.loads(subprocess.check_output(['sudo','tailscale','debug','prefs'], text=True))
if not prefs.get('RunWebClient'):
    raise SystemExit('Tailscale web client was not enabled')
print('Project signing identity and public setec client ready')
