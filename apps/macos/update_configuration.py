"""Public Sparkle settings shared by project generation and release tooling."""

import base64
import binascii
import os
import re
from urllib.parse import urlsplit


def update_configuration(environment=None, *, required=False, defaults=None):
    environment = os.environ if environment is None else environment
    if defaults is None:
        defaults = {}
    feed = (environment.get('DOOMPILE_MACOS_UPDATE_FEED_URL') or defaults.get('feedURL', '')).strip()
    key = (environment.get('DOOMPILE_MACOS_UPDATE_PUBLIC_KEY') or defaults.get('publicKey', '')).strip()
    if not feed and not key and not required:
        return {}
    if not feed or not key:
        raise ValueError('Set both DOOMPILE_MACOS_UPDATE_FEED_URL and DOOMPILE_MACOS_UPDATE_PUBLIC_KEY.')
    parsed = urlsplit(feed)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment
            or not parsed.path.endswith('/appcast.xml') or any(c.isspace() for c in feed)):
        raise ValueError('DOOMPILE_MACOS_UPDATE_FEED_URL must be a public HTTPS URL ending in /appcast.xml, without credentials, query or fragment.')
    try:
        if len(base64.b64decode(key, validate=True)) != 32:
            raise ValueError()
    except (ValueError, binascii.Error):
        raise ValueError('DOOMPILE_MACOS_UPDATE_PUBLIC_KEY must be a base64 Ed25519 public key (32 bytes).') from None
    return {
        'SUFeedURL': feed,
        'SUPublicEDKey': key,
        'SUEnableAutomaticChecks': True,
        'SUScheduledCheckInterval': 86400,
        'SUAutomaticallyUpdate': False,
        'SUEnableSystemProfiling': False,
        'SUVerifyUpdateBeforeExtraction': True,
        'SURequireSignedFeed': True,
    }


def release_build_number(environment=None):
    environment = os.environ if environment is None else environment
    build = environment.get('DOOMPILE_MACOS_BUILD_NUMBER', '').strip()
    if not build and environment.get('GITHUB_RUN_NUMBER'):
        build = environment['GITHUB_RUN_NUMBER'] + '.' + environment.get('GITHUB_RUN_ATTEMPT', '1')
    if not re.fullmatch(r'[1-9][0-9]*(?:\.[0-9]+){0,2}', build):
        raise ValueError('Set an increasing numeric DOOMPILE_MACOS_BUILD_NUMBER for local releases (CI uses GITHUB_RUN_NUMBER.GITHUB_RUN_ATTEMPT).')
    return build


if __name__ == '__main__':
    update_configuration(required=True)
    print(release_build_number())
