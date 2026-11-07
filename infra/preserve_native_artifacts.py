#!/usr/bin/env python3
"""Preserve CI binaries/symbols under the one canonical project root."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil

def preserve(platform, run, sources, project_root):
    if platform not in ('ios', 'macos') or not re.fullmatch(r'[0-9]+-[0-9]+', run):
        raise ValueError('Invalid platform or run ID.')
    root=project_root/'runtime/diagnostics/native'/platform
    root.mkdir(parents=True,exist_ok=True)
    destination=root/run
    if destination.exists():
        return
    temporary=root/('.'+run+'.new')
    if temporary.exists():
        shutil.rmtree(temporary)
    temporary.mkdir(mode=0o750)
    try:
        for source in sources:
            source=source.resolve()
            if not source.is_dir():
                raise SystemExit('Missing native artifact directory')
            shutil.copytree(source,temporary/source.name,symlinks=True)
        (temporary/'ci.json').write_text(json.dumps({'platform':platform,'run':run},indent=2)+'\n')
        temporary.rename(destination)
    finally:
        if temporary.exists():shutil.rmtree(temporary)
    print('Preserved '+platform+' binaries and symbols: '+str(destination))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('platform',choices=['ios','macos'])
    parser.add_argument('run')
    parser.add_argument('source',nargs='+',type=Path)
    parser.add_argument('--root',type=Path,default=Path(os.environ.get('DOOMPILE_PROJECT_ROOT') or Path(__file__).resolve().parents[1]))
    args=parser.parse_args()
    preserve(args.platform, args.run, args.source, args.root.resolve())

if __name__=='__main__':main()
