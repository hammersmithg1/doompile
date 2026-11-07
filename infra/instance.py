"""Operator settings stay outside Git; environment values take precedence."""

import json
import os
from pathlib import Path

from apple_links import link_configuration


LOCAL_SETTINGS = {
    'DOOMPILE_PROD_URL',
    'DOOMPILE_STAGING_URL',
    'DOOMPILE_ADMIN_EMAIL',
    'DOOMPILE_APPLE_APP_IDS',
    'DOOMPILE_DELIVERY_REPOSITORY',
    'DOOMPILE_DELIVERY_REPOSITORY_ID',
}


def instance_environment(root: Path):
    path = root / '.agents/local/instance.json'
    defaults = json.loads(path.read_text()) if path.is_file() else {}
    if not isinstance(defaults, dict) or any(
        key not in LOCAL_SETTINGS or not isinstance(value, str)
        for key, value in defaults.items()
    ):
        raise ValueError('instance.json may contain only non-credential instance settings.')
    return {**defaults, **os.environ}


def site_origin(environment, name):
    key = 'DOOMPILE_' + name.upper() + '_URL'
    value = environment.get(key, '').strip()
    if not value:
        raise ValueError('Set ' + key + ' to the public origin for this environment.')
    try:
        info, _ = link_configuration(value)
    except ValueError:
        raise ValueError(key + ' must be an HTTPS origin, or loopback HTTP for development.') from None
    return info['DoompilePublicURL']
