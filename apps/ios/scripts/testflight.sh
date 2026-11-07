#!/usr/bin/env bash
set -euo pipefail

# Runs on an ephemeral GitHub macOS runner. Never enable shell tracing.
# Automatic signing needs only the four common Apple inputs. Manual signing is an optional fallback.
signing_mode=${IOS_SIGNING_MODE:-automatic}
case "$signing_mode" in
  automatic|manual) ;;
  *) echo 'IOS_SIGNING_MODE must be automatic or manual.' >&2; exit 1 ;;
esac
required=(APPLE_TEAM_ID APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_ISSUER_ID APP_STORE_CONNECT_P8_BASE64)
if [[ "$signing_mode" == manual ]]; then
  required+=(IOS_DISTRIBUTION_P12_BASE64 IOS_PROFILE_APP_BASE64 IOS_PROFILE_SHARE_BASE64 IOS_PROFILE_SAFARI_BASE64 IOS_PROFILE_ACTION_BASE64)
fi
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required signing input: $name" >&2
    exit 1
  fi
done

signing_dir=$(mktemp -d "${RUNNER_TEMP:-/tmp}/doompile-signing.XXXXXX")
signing_keychain="$signing_dir/signing.keychain-db"
signing_password=$(openssl rand -hex 24)
original_default=''
original_search=()
export DOOMPILE_SIGNING_DIRECTORY="$signing_dir"
export DOOMPILE_SIGNING_MODE="$signing_mode"

cleanup() {
  if [[ -n "$original_default" ]]; then
    security default-keychain -d user -s "$original_default" >/dev/null 2>&1 || true
  fi
  if [[ ${#original_search[@]} -gt 0 ]]; then
    security list-keychains -d user -s "${original_search[@]}" >/dev/null 2>&1 || true
  fi
  security delete-keychain "$signing_keychain" >/dev/null 2>&1 || true
  if [[ -f "$signing_dir/installed-profiles.txt" ]]; then
    while IFS= read -r profile_path; do rm -f "$profile_path"; done < "$signing_dir/installed-profiles.txt"
  fi
  rm -rf "$signing_dir"
}
trap cleanup EXIT

# Normalize whitespace so a wrapped base64 secret is accepted without exposing its contents.
python3 - <<'PY'
import base64, os
from pathlib import Path
directory = Path(os.environ['DOOMPILE_SIGNING_DIRECTORY'])
inputs = [('APP_STORE_CONNECT_P8_BASE64', 'AuthKey_' + os.environ['APP_STORE_CONNECT_KEY_ID'] + '.p8')]
if os.environ['DOOMPILE_SIGNING_MODE'] == 'manual':
    inputs += [('IOS_DISTRIBUTION_P12_BASE64', 'certificate.p12'), ('IOS_PROFILE_APP_BASE64', 'app.mobileprovision'), ('IOS_PROFILE_SHARE_BASE64', 'share.mobileprovision'), ('IOS_PROFILE_SAFARI_BASE64', 'safari.mobileprovision'), ('IOS_PROFILE_ACTION_BASE64', 'action.mobileprovision')]
for name, filename in inputs:
    path = directory / filename
    try:
        path.write_bytes(base64.b64decode(''.join(os.environ[name].split()), validate=True))
    except ValueError:
        raise SystemExit('Invalid base64 signing input: ' + name) from None
    path.chmod(0o600)
PY

# Xcode-generated development keys also stay in the temporary keychain in automatic mode.
original_default=$(security default-keychain -d user | python3 -c 'import shlex,sys; print(shlex.split(sys.stdin.read())[0])')
while IFS= read -r keychain_path; do original_search+=("$keychain_path"); done < <(
  security list-keychains -d user | python3 -c 'import shlex,sys; print("\n".join(shlex.split(sys.stdin.read())))'
)
security create-keychain -p "$signing_password" "$signing_keychain"
security set-keychain-settings -lut 21600 "$signing_keychain"
security unlock-keychain -p "$signing_password" "$signing_keychain"
security list-keychains -d user -s "$signing_keychain" ${original_search[@]+"${original_search[@]}"}
security default-keychain -d user -s "$signing_keychain"

if [[ "$signing_mode" == manual ]]; then
  security import "$signing_dir/certificate.p12" -P "${IOS_DISTRIBUTION_P12_PASSWORD:-}" -A -t cert -f pkcs12 -k "$signing_keychain" >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$signing_password" "$signing_keychain" >/dev/null
  for target in app share safari action; do
    security cms -D -i "$signing_dir/$target.mobileprovision" > "$signing_dir/$target.plist"
  done
fi

python3 - <<'PY'
import os, plistlib, shutil
from pathlib import Path
directory = Path(os.environ['DOOMPILE_SIGNING_DIRECTORY'])
team = os.environ['APPLE_TEAM_ID']
export = {'method': 'app-store-connect', 'teamID': team, 'signingStyle': os.environ['DOOMPILE_SIGNING_MODE'], 'uploadSymbols': True, 'manageAppVersionAndBuildNumber': False}
if os.environ['DOOMPILE_SIGNING_MODE'] == 'manual':
    profiles = {}
    prefixes = set()
    installed = []
    for target, bundle in [('app', 'app.doompile'), ('share', 'app.doompile.share'), ('safari', 'app.doompile.safari'), ('action', 'app.doompile.action')]:
        profile = plistlib.loads((directory / (target + '.plist')).read_bytes())
        entitlements = profile['Entitlements']
        if team not in profile.get('TeamIdentifier', []):
            raise SystemExit('Provisioning profile team does not match ' + bundle)
        matching = [prefix for prefix in profile.get('ApplicationIdentifierPrefix', []) if entitlements.get('application-identifier') == prefix + '.' + bundle]
        if not matching:
            raise SystemExit('Provisioning profile bundle does not match ' + bundle)
        prefix = matching[0]
        prefixes.add(prefix)
        if 'group.app.doompile' not in entitlements.get('com.apple.security.application-groups', []):
            raise SystemExit('Provisioning profile must allow App Group group.app.doompile: ' + bundle)
        shared_group = prefix + '.app.doompile.shared'
        allowed = entitlements.get('keychain-access-groups', [])
        if shared_group not in allowed and prefix + '.*' not in allowed:
            raise SystemExit('Provisioning profile must allow the shared Keychain group: ' + bundle)
        if entitlements.get('get-task-allow', False) or 'ProvisionedDevices' in profile or profile.get('ProvisionsAllDevices', False):
            raise SystemExit('An App Store distribution profile is required: ' + bundle)
        destination = Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles' / (profile['UUID'] + '.mobileprovision')
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise SystemExit('Refusing to overwrite an existing runner provisioning profile: ' + bundle)
        shutil.copyfile(directory / (target + '.mobileprovision'), destination)
        installed.append(str(destination))
        # Record each installation immediately so partial setup is cleaned after a later failure.
        (directory / 'installed-profiles.txt').write_text('\n'.join(installed) + '\n')
        profiles[bundle] = profile['UUID']
        (directory / (target + '.uuid')).write_text(profile['UUID'])
    if len(prefixes) != 1:
        raise SystemExit('All three targets must share an App ID prefix for Keychain sharing.')
    export.update(signingCertificate='Apple Distribution', provisioningProfiles=profiles)
(directory / 'ExportOptions.plist').write_bytes(plistlib.dumps(export))
PY

auth_args=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$signing_dir/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8"
  -authenticationKeyID "$APP_STORE_CONNECT_KEY_ID"
  -authenticationKeyIssuerID "$APP_STORE_CONNECT_ISSUER_ID"
)
signing_args=(DEVELOPMENT_TEAM="$APPLE_TEAM_ID")
if [[ "$signing_mode" == automatic ]]; then
  signing_args+=(CODE_SIGN_STYLE=Automatic DOOMPILE_SIGNING_STYLE=Automatic)
else
  signing_args+=(
    CODE_SIGN_STYLE=Manual DOOMPILE_SIGNING_STYLE=Manual
    CODE_SIGN_IDENTITY='Apple Distribution'
    DOOMPILE_PROFILE_APP="$(cat "$signing_dir/app.uuid")"
    DOOMPILE_PROFILE_SHARE="$(cat "$signing_dir/share.uuid")"
    DOOMPILE_PROFILE_SAFARI="$(cat "$signing_dir/safari.uuid")"
    DOOMPILE_PROFILE_ACTION="$(cat "$signing_dir/action.uuid")"
  )
  auth_args=()
fi

# A rerun gets a distinct valid CFBundleVersion instead of retrying an already-uploaded number.
build_number="${DOOMPILE_IOS_BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-1}.${GITHUB_RUN_ATTEMPT:-1}}"
xcodebuild -project apps/ios/Doompile.xcodeproj -scheme Doompile \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$signing_dir/Doompile.xcarchive" \
  CURRENT_PROJECT_VERSION="$build_number" \
  "${signing_args[@]}" ${auth_args[@]+"${auth_args[@]}"} archive

# Preserve only symbols and a source manifest; signing credentials stay in the temporary directory.
mkdir -p apps/ios/build/diagnostics
ditto -c -k --keepParent "$signing_dir/Doompile.xcarchive/dSYMs" apps/ios/build/diagnostics/Doompile-iOS-dSYMs.zip
node scripts/release-manifest.mjs apps/ios/build/diagnostics/Doompile-iOS-dSYMs.zip ios

xcodebuild -exportArchive -archivePath "$signing_dir/Doompile.xcarchive" \
  -exportOptionsPlist "$signing_dir/ExportOptions.plist" -exportPath "$signing_dir/export" \
  ${auth_args[@]+"${auth_args[@]}"}

# altool locates AuthKey_<id>.p8 through this environment variable. No Apple password is used.
export API_PRIVATE_KEYS_DIR="$signing_dir"
python3 .agents/ci/upload_ios.py "$signing_dir/export/Doompile.ipa"

# Preserve the uploaded binary without retaining any private signing input.
mkdir -p apps/ios/build/release
ditto "$signing_dir/export/Doompile.ipa" "apps/ios/build/release/Doompile-iOS-$build_number.ipa"
node scripts/release-manifest.mjs "apps/ios/build/release/Doompile-iOS-$build_number.ipa" ios
