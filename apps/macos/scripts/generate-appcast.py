#!/usr/bin/env python3
"""Sign a release with Sparkle; the private key travels through stdin only."""

import argparse
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_configuration import release_build_number, update_configuration
from update_key import public_key

SPARKLE = '{http://www.andymatuschak.org/xml-namespaces/sparkle}'


def generate(application, archives, sparkle_bin, environment=None):
    environment = dict(os.environ if environment is None else environment)
    settings = update_configuration(environment, required=True)
    build = release_build_number(environment)
    info = plistlib.loads((application / 'Contents/Info.plist').read_bytes())
    for name in ('SUFeedURL', 'SUPublicEDKey', 'SURequireSignedFeed', 'SUVerifyUpdateBeforeExtraction'):
        if info.get(name) != settings[name]:
            raise ValueError('Archived app has a different update configuration: ' + name)
    if info.get('CFBundleVersion') != build:
        raise ValueError('Archived app has a different build number.')
    secret = environment.pop('DOOMPILE_MACOS_UPDATE_PRIVATE_KEY', '').strip()
    if public_key(secret) != settings['SUPublicEDKey']:
        raise ValueError('DOOMPILE_MACOS_UPDATE_PRIVATE_KEY must match the public key embedded in the app.')

    archive = archives / ('Doompile-macOS-' + build + '.zip')
    if not archive.is_file():
        raise ValueError('Missing release archive: ' + archive.name)
    result = subprocess.run([
        str(sparkle_bin / 'generate_appcast'), '--ed-key-file', '-',
        '--download-url-prefix', urljoin(settings['SUFeedURL'], './'),
        '--maximum-deltas', '0', '--maximum-versions', '1', str(archives),
    ], input=secret + '\n', text=True, capture_output=True, env=environment)
    if result.returncode:
        # A third-party signing tool must never echo a malformed secret to logs.
        diagnostics = (result.stderr + '\n' + result.stdout).replace(secret, '[redacted]')
        diagnostics = re.sub(r'[A-Za-z0-9+/]{43,}={0,2}', '[redacted]', diagnostics)
        raise ValueError('Sparkle could not generate the signed appcast (exit ' + str(result.returncode) + '):\n' + diagnostics[-3000:].strip())
    feed = archives / 'appcast.xml'
    root = ET.fromstring(feed.read_bytes())
    item = root.find('channel/item')
    if item is None or item.findtext(SPARKLE + 'version') != build:
        raise ValueError('Generated appcast does not contain the release build.')
    enclosure = item.find('enclosure')
    if (enclosure is None or not enclosure.get(SPARKLE + 'edSignature')
            or enclosure.get('url') != urljoin(settings['SUFeedURL'], archive.name)
            or enclosure.get('length') != str(archive.stat().st_size)):
        raise ValueError('Generated appcast does not describe the signed release archive.')
    verified = subprocess.run([
        str(sparkle_bin / 'sign_update'), '--ed-key-file', '-', '--verify', str(feed),
    ], input=secret + '\n', text=True, capture_output=True, env=environment)
    if verified.returncode:
        raise ValueError('Sparkle appcast signature verification failed.')
    print('Verified signed appcast for Doompile ' + build + '.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('application', type=Path)
    parser.add_argument('archives', type=Path)
    parser.add_argument('sparkle_bin', type=Path)
    args = parser.parse_args()
    try:
        generate(args.application.resolve(), args.archives.resolve(), args.sparkle_bin.resolve())
    except (ValueError, OSError, ET.ParseError) as error:
        sys.exit(str(error))
