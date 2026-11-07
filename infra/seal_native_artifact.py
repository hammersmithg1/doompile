#!/usr/bin/env python3
"""Encrypt the native binary and symbols for the operator before artifact upload."""

import argparse
import os
from pathlib import Path
import subprocess
import tarfile


def seal(release, symbols, output, recipient):
    if not recipient:
        raise ValueError('Set DOOMPILE_DELIVERY_RECIPIENT to the release receiver public key.')
    if not (release/'release.json').is_file() or not symbols.is_dir() or not any(symbols.iterdir()):
        raise ValueError('Native release or symbols are missing.')
    try:
        with subprocess.Popen(
            ['age', '--encrypt', '--recipient', recipient, '--output', str(output)],
            stdin=subprocess.PIPE,
        ) as encrypt:
            with tarfile.open(fileobj=encrypt.stdin, mode='w|gz') as archive:
                archive.add(release, arcname='release')
                name = 'symbols/' + symbols.name if symbols.suffix == '.dSYM' else 'symbols'
                archive.add(symbols, arcname=name)
            encrypt.stdin.close()
            if encrypt.wait():
                raise ValueError('Could not encrypt the native release.')
    except Exception:
        output.unlink(missing_ok=True)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release', type=Path)
    parser.add_argument('symbols', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    seal(args.release, args.symbols, args.output, os.environ.get('DOOMPILE_DELIVERY_RECIPIENT'))
