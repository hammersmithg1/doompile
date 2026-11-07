#!/usr/bin/env bash
set -euo pipefail
# Run through setec locally or with an ephemeral CI secret environment. Never use set -x.
required=(APPLE_TEAM_ID APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_ISSUER_ID APP_STORE_CONNECT_P8_BASE64 MACOS_DEVELOPER_ID_P12_BASE64 DOOMPILE_MACOS_UPDATE_PRIVATE_KEY)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then echo "Missing signing input: $name" >&2; exit 1; fi
done
umask 077
repository_root="$(cd "$(dirname "$0")/../../.." && pwd)"
macos_build_number="$(python3 "$repository_root/apps/macos/update_configuration.py")"
export DOOMPILE_MACOS_BUILD_NUMBER="$macos_build_number"
python3 "$repository_root/apps/macos/scripts/update_key.py"
signing_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/doompile-mac-signing.XXXXXX")"
signing_keychain="$signing_dir/signing.keychain-db"
signing_password="$(openssl rand -hex 24)"
original_search=()
original_default=''
cleanup() {
  if [[ -n "$original_default" ]]; then security default-keychain -d user -s "$original_default" >/dev/null 2>&1 || true; fi
  if [[ ${#original_search[@]} -gt 0 ]]; then security list-keychains -d user -s "${original_search[@]}" >/dev/null 2>&1 || true; fi
  security delete-keychain "$signing_keychain" >/dev/null 2>&1 || true
  rm -rf "$signing_dir"
}
trap cleanup EXIT
export DOOMPILE_MAC_SIGNING_DIRECTORY="$signing_dir"
python3 - <<'PY'
import os, base64, plistlib
from pathlib import Path
root = Path(os.environ['DOOMPILE_MAC_SIGNING_DIRECTORY'])
for key, filename in [('APP_STORE_CONNECT_P8_BASE64','AuthKey.p8'), ('MACOS_DEVELOPER_ID_P12_BASE64','DeveloperID.p12')]:
    try:
        (root / filename).write_bytes(base64.b64decode(''.join(os.environ[key].split()), validate=True))
    except ValueError:
        raise SystemExit('Invalid signing input: ' + key) from None
(root / 'ExportOptions.plist').write_bytes(plistlib.dumps({'method':'developer-id','teamID':os.environ['APPLE_TEAM_ID'],'signingStyle':'automatic','signingCertificate':'Developer ID Application'}))
PY
original_default=$(security default-keychain -d user | python3 -c 'import shlex,sys; print(shlex.split(sys.stdin.read())[0])')
while IFS= read -r keychain_path; do original_search+=("$keychain_path"); done < <(security list-keychains -d user | python3 -c 'import shlex,sys; print("\n".join(shlex.split(sys.stdin.read())))')
security create-keychain -p "$signing_password" "$signing_keychain"
security set-keychain-settings -lut 21600 "$signing_keychain"
security unlock-keychain -p "$signing_password" "$signing_keychain"
security list-keychains -d user -s "$signing_keychain" ${original_search[@]+"${original_search[@]}"}
security default-keychain -d user -s "$signing_keychain"
security import "$signing_dir/DeveloperID.p12" -P "${MACOS_DEVELOPER_ID_P12_PASSWORD:-}" -A -t cert -f pkcs12 -k "$signing_keychain" >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$signing_password" "$signing_keychain" >/dev/null
cd "$repository_root"
node extensions/clipper/build.mjs --out-dir "$signing_dir/clipper"
npm run editor:build
DOOMPILE_CLIPPER_DIR="$signing_dir/clipper/safari" python3 apps/macos/generate_project.py
auth_args=(-allowProvisioningUpdates -authenticationKeyPath "$signing_dir/AuthKey.p8" -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID" -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID")
xcodebuild -project apps/macos/Doompile.xcodeproj -scheme Doompile -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath "$signing_dir/DerivedData" \
  -archivePath "$signing_dir/Doompile.xcarchive" DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic \
  CODE_SIGN_IDENTITY='Developer ID Application' ENABLE_HARDENED_RUNTIME=YES \
  CURRENT_PROJECT_VERSION="$DOOMPILE_MACOS_BUILD_NUMBER" "${auth_args[@]}" archive
xcodebuild -exportArchive -archivePath "$signing_dir/Doompile.xcarchive" -exportOptionsPlist "$signing_dir/ExportOptions.plist" -exportPath "$signing_dir/export" "${auth_args[@]}"
application="$signing_dir/export/Doompile.app"
codesign --verify --deep --strict "$application"
ditto -c -k --keepParent "$application" "$signing_dir/notarization.zip"
xcrun notarytool submit "$signing_dir/notarization.zip" --key "$signing_dir/AuthKey.p8" --key-id "$APP_STORE_CONNECT_KEY_ID" --issuer "$APP_STORE_CONNECT_ISSUER_ID" --wait
xcrun stapler staple "$application"
spctl --assess --type execute "$application"
mkdir -p "$signing_dir/updates"
archive="$signing_dir/updates/Doompile-macOS-$DOOMPILE_MACOS_BUILD_NUMBER.zip"
ditto -c -k --sequesterRsrc --keepParent "$application" "$archive"
node scripts/release-manifest.mjs "$archive" macos
sparkle_bin="$signing_dir/DerivedData/SourcePackages/artifacts/sparkle/Sparkle/bin"
python3 apps/macos/scripts/generate-appcast.py "$application" "$signing_dir/updates" "$sparkle_bin"
# Replace only generated output after both notarization and signature checks pass.
rm -rf apps/macos/dist/release
mkdir -p apps/macos/dist/release
ditto "$signing_dir/updates" apps/macos/dist/release
mkdir -p apps/macos/dist/symbols
ditto -c -k --keepParent "$signing_dir/Doompile.xcarchive/dSYMs" apps/macos/dist/symbols/Doompile-macOS-dSYMs.zip
node scripts/release-manifest.mjs apps/macos/dist/symbols/Doompile-macOS-dSYMs.zip macos
