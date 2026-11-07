#!/usr/bin/env bash
set -euo pipefail
# Personal ad-hoc distribution, authenticated by the existing Sparkle Ed25519 key.
# This is not a Developer ID / notarized build.
repository_root=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$repository_root"
mac_build_number=$(python3 apps/macos/update_configuration.py)
export DOOMPILE_MACOS_BUILD_NUMBER="$mac_build_number"
python3 apps/macos/scripts/update_key.py
application_source=${DOOMPILE_MACOS_APP_PATH:?Set DOOMPILE_MACOS_APP_PATH to the built app}
sparkle_bin=${DOOMPILE_SPARKLE_BIN:?Set DOOMPILE_SPARKLE_BIN to the matching Sparkle tools}
umask 077
release_temp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/doompile-personal-release.XXXXXX")
trap 'rm -rf "$release_temp"' EXIT
ditto "$application_source" "$release_temp/Doompile.app"
export DOOMPILE_PERSONAL_RELEASE_APP="$release_temp/Doompile.app"
python3 - <<'PY'
import os, plistlib
from pathlib import Path
path = Path(os.environ['DOOMPILE_PERSONAL_RELEASE_APP'])/'Contents/Info.plist'
info = plistlib.loads(path.read_bytes())
info['CFBundleVersion'] = os.environ['DOOMPILE_MACOS_BUILD_NUMBER']
info['DoompilePublicURL'] = os.environ['DOOMPILE_PUBLIC_URL']
path.write_bytes(plistlib.dumps(info))
PY
codesign --force --deep --sign - --timestamp=none "$release_temp/Doompile.app"
codesign --verify --deep --strict "$release_temp/Doompile.app"
mkdir "$release_temp/updates"
archive="$release_temp/updates/Doompile-macOS-$mac_build_number.zip"
ditto -c -k --sequesterRsrc --keepParent "$release_temp/Doompile.app" "$archive"
node scripts/release-manifest.mjs "$archive" macos
python3 apps/macos/scripts/generate-appcast.py "$release_temp/Doompile.app" "$release_temp/updates" "$sparkle_bin"
rm -rf apps/macos/dist/release
mkdir -p apps/macos/dist/release
ditto "$release_temp/updates" apps/macos/dist/release
