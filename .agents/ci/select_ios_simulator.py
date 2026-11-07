#!/usr/bin/env python3
# Choose an explicit iOS version for diagnostics, otherwise the newest runtime.
import argparse
import json
import re
import subprocess
import sys
parser=argparse.ArgumentParser(description='Select an available iPhone simulator')
parser.add_argument('--os',default='')
args=parser.parse_args()
if args.os and not re.fullmatch(r'[0-9]+(?:\.[0-9]+){1,2}',args.os):
    raise SystemExit('Expected an iOS version such as 18.5 or 26.2')
value=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','available','--json'],text=True))
candidates=[]
for runtime,devices in value['devices'].items():
    match=re.search(r'SimRuntime\.iOS-([0-9-]+)$',runtime)
    if not match:continue
    version=tuple(int(part) for part in match.group(1).split('-'))
    if args.os and version!=tuple(int(part) for part in args.os.split('.')):continue
    for device in devices:
        if device.get('isAvailable') and device['name'].startswith('iPhone'):
            candidates.append((version,device['name'].endswith(' Pro'),device['name'],device['udid']))
if not candidates:raise SystemExit('No matching available iPhone simulator')
version,_,name,identifier=max(candidates)
print('Selected '+name+' on iOS '+'.'.join(map(str,version)),file=sys.stderr)
print(identifier)
