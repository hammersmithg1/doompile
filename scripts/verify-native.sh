#!/usr/bin/env bash
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/doompile-native-verify.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
cd "$repository_root"
node extensions/clipper/build.mjs --out-dir "$test_root/clipper"
npm run editor:build
export DOOMPILE_CLIPPER_DIR="$test_root/clipper/safari"
python3 apps/ios/generate_project.py
python3 apps/macos/generate_project.py
SWIFTPM_MODULECACHE_OVERRIDE="$test_root/module-cache" CLANG_MODULE_CACHE_PATH="$test_root/module-cache" \
swift test --package-path apps/ios --scratch-path "$test_root/core" --cache-path "$test_root/cache" --config-path "$test_root/config" --security-path "$test_root/security" --disable-sandbox
bash apps/macos/scripts/test.sh
xcodebuild -project apps/ios/Doompile.xcodeproj -scheme Doompile -destination 'generic/platform=iOS Simulator' -derivedDataPath "$test_root/ios" CODE_SIGNING_ALLOWED=NO build
xcodebuild -project apps/macos/Doompile.xcodeproj -scheme Doompile -destination 'generic/platform=macOS' -derivedDataPath "$test_root/mac" CODE_SIGNING_ALLOWED=NO build
