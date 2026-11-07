#!/usr/bin/env bash
set -euo pipefail

# A local developer build. Does not install, open, or register anything in Safari.
# The user's temporary extension folder remains untouched.
repository_root="$(cd "$(dirname "$0")/../../.." && pwd)"
macos_root="$repository_root/apps/macos"
staging_root="$macos_root/.staging/clipper"
derived_data="$macos_root/build"
application="$derived_data/Build/Products/Debug/Doompile.app"
destination="$macos_root/dist/Doompile.app"

cd "$repository_root"
npm run editor:build
node extensions/clipper/build.mjs --out-dir "$staging_root"
DOOMPILE_CLIPPER_DIR="$staging_root/safari" python3 apps/macos/generate_project.py

xcodebuild -project apps/macos/Doompile.xcodeproj -scheme Doompile \
  -configuration Debug -destination 'generic/platform=macOS' \
  -derivedDataPath "$derived_data" CODE_SIGNING_ALLOWED=NO build

test -d "$application"
mkdir -p "$macos_root/dist"
# Both paths are generated outputs under this checkout, never user applications.
if [[ -d "$destination" ]]; then rm -rf "$destination"; fi
ditto "$application" "$destination"
# Ad-hoc signing makes the local build runnable without an Apple account. This is
# not a Developer ID signature, notarization, or a release distribution channel.
codesign --force --deep --sign - --timestamp=none "$destination"
codesign --verify --deep --strict "$destination"
printf 'Built local developer app: %s\n' "$destination"
