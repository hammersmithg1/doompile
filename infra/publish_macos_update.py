#!/usr/bin/env python3
"""Publish verified CI artifacts locally: immutable ZIP first, appcast last."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET

SPARKLE = '{http://www.andymatuschak.org/xml-namespaces/sparkle}'


def build_number(value):
    if not re.fullmatch(r'[1-9][0-9]*(?:\.[0-9]+){0,2}', value):
        raise ValueError('Invalid release build number.')
    parts = [int(part) for part in value.split('.')]
    return tuple(parts + [0] * (3 - len(parts)))


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_copy(source, destination):
    handle, name = tempfile.mkstemp(prefix='.' + destination.name + '-', dir=destination.parent)
    temporary = Path(name)
    try:
        with os.fdopen(handle, 'wb') as output, source.open('rb') as incoming:
            shutil.copyfileobj(incoming, output)
            output.flush()
            os.fsync(output.fileno())
            os.fchmod(output.fileno(), 0o644)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def publish(source, destination):
    manifest = json.loads((source / 'release.json').read_text())
    build = manifest['build']
    version = build_number(build)
    archive_name = 'Doompile-macOS-' + build + '.zip'
    if manifest.get('platform') != 'macos' or manifest.get('file') != archive_name:
        raise ValueError('Manifest does not describe a Mac release archive.')
    archive = source / archive_name
    if archive.is_symlink() or archive.stat().st_size != manifest['size'] or checksum(archive) != manifest['sha256']:
        raise ValueError('Release archive checksum or size does not match its manifest.')
    feed = source / 'appcast.xml'
    item = ET.fromstring(feed.read_bytes()).find('channel/item')
    if item is None or item.findtext(SPARKLE + 'version') != build:
        raise ValueError('Appcast does not describe the release build.')
    enclosure = item.find('enclosure')
    if (enclosure is None or not enclosure.get(SPARKLE + 'edSignature')
            or enclosure.get('length') != str(manifest['size'])
            or enclosure.get('url', '').rsplit('/', 1)[-1] != archive_name):
        raise ValueError('Appcast does not describe the signed archive.')
    destination.mkdir(parents=True, exist_ok=True)
    with (destination / '.publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current_feed = destination / 'appcast.xml'
        if current_feed.is_file():
            current = ET.fromstring(current_feed.read_bytes()).findtext('channel/item/' + SPARKLE + 'version')
            if current is None or build_number(current) > version:
                raise ValueError('Refusing to replace a newer update feed.')
            if build_number(current) == version and current_feed.read_bytes() != feed.read_bytes():
                raise ValueError('Refusing to change an already published build.')
        target = destination / archive_name
        if target.is_symlink() or (target.exists() and checksum(target) != manifest['sha256']):
            raise ValueError('Refusing to overwrite an immutable release archive.')
        if not target.exists():
            atomic_copy(archive, target)
        atomic_copy(feed, current_feed)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    publish(args.source, args.destination)
    print('Published Mac update: ' + str(args.destination / 'appcast.xml'))
