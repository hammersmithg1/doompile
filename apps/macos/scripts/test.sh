#!/usr/bin/env bash
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/../../.." && pwd)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/doompile-macos-tests.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
cd "$repository_root"
python3 -m unittest discover -s apps/macos/Tests -p '*test.py'
mkdir -p "$test_root/Sources/DoompileMacSupport" "$test_root/Tests/DoompileMacSupportTests"
cp apps/ios/Shared/*.swift apps/macos/Support/*.swift "$test_root/Sources/DoompileMacSupport/"
cp apps/macos/Tests/*.swift "$test_root/Tests/DoompileMacSupportTests/"
cat > "$test_root/Package.swift" <<'SWIFT'
// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "DoompileMacSupport", platforms: [.macOS(.v14)], targets: [
    .target(name: "DoompileMacSupport"),
    .testTarget(name: "DoompileMacSupportTests", dependencies: ["DoompileMacSupport"])
])
SWIFT
SWIFTPM_MODULECACHE_OVERRIDE="$test_root/module-cache" CLANG_MODULE_CACHE_PATH="$test_root/module-cache" \
swift test --package-path "$test_root" --scratch-path "$test_root/build" \
  --cache-path "$test_root/cache" --config-path "$test_root/config" \
  --security-path "$test_root/security" --disable-sandbox
