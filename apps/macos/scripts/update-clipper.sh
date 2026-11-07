#!/usr/bin/env bash
set -euo pipefail
# Refresh a generated local developer app. No Swift compilation or CI required.
repository_root="$(cd "$(dirname "$0")/../../.." && pwd)"
application="$repository_root/apps/macos/dist/Doompile.app"
if [[ ! -d "$application" ]]; then
  echo 'Build the developer app once with npm run macos:build before updating only its clipper.' >&2
  exit 1
fi
cd "$repository_root"
node extensions/clipper/build.mjs
staging_directory=$(mktemp -d /tmp/doompile-mac-clipper.XXXXXX)
trap 'rm -rf "$staging_directory"' EXIT
ditto "$application" "$staging_directory/Doompile.app"
python3 - "$repository_root" "$staging_directory/Doompile.app" <<'PY'
import sys,shutil,plistlib
from pathlib import Path
repo,app=map(Path,sys.argv[1:])
plugins=list((app/'Contents/PlugIns').glob('*.appex'))
plugins=[plugin for plugin in plugins if plistlib.loads((plugin/'Contents/Info.plist').read_bytes()).get('NSExtension',{}).get('NSExtensionPointIdentifier')=='com.apple.Safari.web-extension']
if len(plugins)!=1:raise SystemExit('Expected one Safari WebExtension in the generated app')
resources=plugins[0]/'Contents/Resources';resources.mkdir(parents=True,exist_ok=True)
for obsolete in resources.glob('rich-editor*.js'):obsolete.unlink()
for source in (repo/'extensions/clipper/dist/safari').iterdir():
 target=resources/source.name
 if source.is_dir():shutil.copytree(source,target,dirs_exist_ok=True)
 else:shutil.copy2(source,target)
background=resources/'background.js'
background.write_text(background.read_text().replace("sendNativeMessage('app.doompile',", "sendNativeMessage('app.doompile.macos',"))
PY
codesign --force --deep --sign - --timestamp=none "$staging_directory/Doompile.app"
codesign --verify --deep --strict "$staging_directory/Doompile.app"
# Both destinations are generated build outputs, never the user's installed app.
ditto "$staging_directory/Doompile.app" "$application"
printf 'Updated clipper resources without Swift compilation: %s\n' "$application"
