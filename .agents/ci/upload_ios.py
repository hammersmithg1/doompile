# Require Apple's positive receipt: altool can return zero for a 409.
import json
import os
import subprocess
import sys


def require_upload_success(returncode, output):
    if returncode:
        raise RuntimeError('altool failed with exit code ' + str(returncode))
    try:
        receipt = json.loads(output)
    except (ValueError, TypeError):
        raise RuntimeError('altool did not return a JSON upload receipt') from None
    if not isinstance(receipt, dict) or receipt.get('product-errors') or receipt.get('errors'):
        raise RuntimeError('Apple rejected the upload; do not wait for processing')
    success = receipt.get('success-message')
    if not isinstance(success, str) or not success.strip():
        raise RuntimeError('Apple did not confirm a successful upload')
    return receipt


def main():
    result = subprocess.run([
        'xcrun', 'altool', '--upload-app', '--type', 'ios', '--file', sys.argv[1],
        '--apiKey', os.environ['APP_STORE_CONNECT_KEY_ID'],
        '--apiIssuer', os.environ['APP_STORE_CONNECT_ISSUER_ID'],
        '--output-format', 'json',
    ], capture_output=True, text=True, timeout=900)
    print(result.stdout, end='', flush=True)
    print(result.stderr, end='', file=sys.stderr, flush=True)
    require_upload_success(result.returncode, result.stdout)


if __name__ == '__main__':
    main()
