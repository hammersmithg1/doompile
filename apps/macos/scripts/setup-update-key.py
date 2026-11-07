#!/usr/bin/env python3
"""Prepare a Sparkle key through the operator's secret provider.

Prints only the public build settings. A new seed is saved to the CI device scope.
"""

import base64
import json
import os
from pathlib import Path
import subprocess
import sys
from update_key import public_key
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_configuration import update_configuration


def setup():
    feed = os.environ.get('DOOMPILE_MACOS_UPDATE_FEED_URL', '').strip()
    if not feed:
        raise ValueError('Set the update feed URL.')
    expected_public = os.environ.get('DOOMPILE_MACOS_UPDATE_PUBLIC_KEY', '').strip()
    device = os.environ.get('DOOMPILE_CI_SETEC_DEVICE') or 'doompile-ci'
    secret = os.environ.get('DOOMPILE_MACOS_UPDATE_PRIVATE_KEY', '').strip()
    needs_save = False
    if not secret:
        if expected_public:
            raise ValueError('The public key is already configured. Restore its private key in setec instead of replacing it.')
        generated = subprocess.run([
            'swift', '-module-cache-path', '/tmp/doompile-update-key-module-cache', '-e',
            'import CryptoKit; import Foundation; let key = Curve25519.Signing.PrivateKey(); '
            'print(key.rawRepresentation.base64EncodedString())',
        ], capture_output=True, text=True)
        if generated.returncode:
            raise ValueError('Could not generate an Ed25519 update key.')
        secret = generated.stdout.strip()
        decoded = base64.b64decode(secret, validate=True)
        if len(decoded) != 32:
            raise ValueError('Unexpected generated key format.')
        needs_save = True
    decoded = base64.b64decode(secret, validate=True)
    if len(decoded) == 64:
        # Accept a conventional seed+public pair only when its public half matches.
        # Sparkle's current export format is the seed alone; this preserves the key.
        seed = base64.b64encode(decoded[:32]).decode('ascii')
        if public_key(seed) != base64.b64encode(decoded[-32:]).decode('ascii'):
            raise ValueError('Invalid seed/public key pair.')
        secret = seed
        needs_save = True
    public = public_key(secret)
    if expected_public and expected_public != public:
        raise ValueError('The key in setec does not match the configured update key.')
    settings = {
        'DOOMPILE_MACOS_UPDATE_FEED_URL': feed,
        'DOOMPILE_MACOS_UPDATE_PUBLIC_KEY': public,
    }
    update_configuration(settings, required=True)
    if needs_save:
        saved = subprocess.run([
            sys.executable, str(Path.home() / '.agents/common/scripts/agent_secrets.py'),
            '--scope', 'device', '--device', device, '--put', 'DOOMPILE_MACOS_UPDATE_PRIVATE_KEY',
        ], input=secret, text=True, capture_output=True)
        if saved.returncode:
            raise ValueError('Could not store the update key in setec.')
    print(json.dumps(settings, indent=2))


if __name__ == '__main__':
    try:
        setup()
    except (ValueError, OSError):
        sys.exit('Update key setup failed. Check setec access and the existing public key; no private key was written locally.')
