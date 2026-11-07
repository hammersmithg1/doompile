#!/usr/bin/env python3
"""Exercise real Sparkle signing with an isolated ad-hoc app and an ephemeral key.

Never starts Doompile, reads its store, publishes a release, or uses production keys.
"""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'infra'))
from publish_macos_update import publish

spec = importlib.util.spec_from_file_location('generate_appcast', Path(__file__).with_name('generate-appcast.py'))
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def test_delivery(application, sparkle_bin):
    with tempfile.TemporaryDirectory(prefix='doompile-update-delivery-') as temporary:
        root = Path(temporary)
        generated = subprocess.run([
            'swift', '-module-cache-path', str(root / 'module-cache'), '-e',
            'import CryptoKit; import Foundation; let key = Curve25519.Signing.PrivateKey(); '
            'print(String(data: try! JSONSerialization.data(withJSONObject: ["private": key.rawRepresentation.base64EncodedString(), "public": key.publicKey.rawRepresentation.base64EncodedString()]), encoding: .utf8)!)',
        ], capture_output=True, text=True, check=True)
        keys = json.loads(generated.stdout)
        secret, public = keys['private'], keys['public']
        environment = {**os.environ,
            'DOOMPILE_MACOS_UPDATE_FEED_URL': 'https://updates.invalid/appcast.xml',
            'DOOMPILE_MACOS_UPDATE_PUBLIC_KEY': public,
            'DOOMPILE_MACOS_UPDATE_PRIVATE_KEY': secret,
            'DOOMPILE_MACOS_BUILD_NUMBER': '42.1',
        }
        app = root / 'Doompile.app'
        subprocess.run(['ditto', str(application), str(app)], check=True)
        info_path = app / 'Contents/Info.plist'
        info = plistlib.loads(info_path.read_bytes())
        info.update(generator.update_configuration(environment, required=True))
        info['CFBundleVersion'] = '42.1'
        info_path.write_bytes(plistlib.dumps(info))
        subprocess.run(['codesign', '--force', '--deep', '--sign', '-', '--timestamp=none', str(app)], capture_output=True, check=True)
        archives = root / 'archives'
        archives.mkdir()
        archive = archives / 'Doompile-macOS-42.1.zip'
        subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(archive)], check=True)
        subprocess.run(['node', str(REPO / 'scripts/release-manifest.mjs'), str(archive), 'macos'], env=environment, check=True)
        generator.generate(app, archives, sparkle_bin, environment)
        feed = archives / 'appcast.xml'
        item = ET.fromstring(feed.read_bytes()).find('channel/item')
        signature = item.find('enclosure').get(generator.SPARKLE + 'edSignature')
        def verify(path, signature=None):
            return subprocess.run([
                str(sparkle_bin / 'sign_update'), '--ed-key-file', '-', '--verify', str(path),
                *([signature] if signature else []),
            ], input=secret + '\n', capture_output=True, text=True).returncode == 0
        assert verify(archive, signature), 'Archive signature failed'
        destination = root / 'published'
        publish(archives, destination)
        assert (destination / 'appcast.xml').read_bytes() == feed.read_bytes(), 'Publication modified the signed feed'
        assert verify(destination / 'appcast.xml'), 'Published feed signature failed'
        with archive.open('ab') as output:
            output.write(b'tampered')
        assert not verify(archive, signature), 'Tampered archive was accepted'
        feed.write_bytes(feed.read_bytes().replace(b'<title>', b'<title>tampered ', 1))
        assert not verify(feed), 'Tampered feed was accepted'
        print('PASS: signed archive and feed, byte-preserving publication, rejection of archive/feed tampering. No app was launched or installed.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('application', type=Path)
    parser.add_argument('sparkle_bin', type=Path)
    args = parser.parse_args()
    test_delivery(args.application.resolve(), args.sparkle_bin.resolve())
