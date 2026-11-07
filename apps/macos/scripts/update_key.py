"""Read Sparkle's seed format without persisting or printing private material."""

import base64
import binascii
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def public_key(secret):
    try:
        decoded = base64.b64decode(secret, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError('Invalid DOOMPILE_MACOS_UPDATE_PRIVATE_KEY.') from None
    if len(decoded) == 96:  # Sparkle's legacy expanded private key + public key.
        return base64.b64encode(decoded[-32:]).decode('ascii')
    if len(decoded) != 32:
        raise ValueError('DOOMPILE_MACOS_UPDATE_PRIVATE_KEY must contain a 32-byte Ed25519 seed (or Sparkle legacy 96-byte key).')
    with tempfile.TemporaryDirectory(prefix='doompile-public-key-') as cache:
        result = subprocess.run([
            'swift', '-module-cache-path', cache, '-e',
            'import CryptoKit; import Foundation; '
            'let seed = Data(base64Encoded: readLine()!)!; '
            'let key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed); '
            'print(key.publicKey.rawRepresentation.base64EncodedString())',
        ], input=secret + '\n', capture_output=True, text=True)
    if result.returncode:
        raise ValueError('Could not derive the public update key.')
    return result.stdout.strip()


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from update_configuration import update_configuration
    try:
        expected = update_configuration(required=True)['SUPublicEDKey']
        if public_key(os.environ.get('DOOMPILE_MACOS_UPDATE_PRIVATE_KEY', '').strip()) != expected:
            raise ValueError('The private update key does not match the app public key.')
    except (ValueError, OSError) as error:
        sys.exit(str(error))
