"""Shared, non-secret Universal Link configuration for both Apple project generators."""
import os
from urllib.parse import urlsplit, urlunsplit


def link_configuration(value=None):
    value = (os.environ.get('DOOMPILE_PUBLIC_URL', '') if value is None else value).strip()
    if not value:
        return {}, {}
    parsed = urlsplit(value)
    host = parsed.hostname
    if not host or parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('DOOMPILE_PUBLIC_URL must be an HTTPS origin without path, credentials, query or fragment.')
    local = host.lower() in ('localhost', '127.0.0.1', '::1')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and local):
        raise ValueError('DOOMPILE_PUBLIC_URL requires HTTPS (or loopback HTTP for development).')
    if parsed.scheme == 'https' and parsed.port not in (None, 443):
        raise ValueError('Apple associated domains do not support alternate ports.')
    host = host.lower().encode('idna').decode('ascii')
    authority = '[' + host + ']' if ':' in host else host
    if parsed.port and parsed.port != (443 if parsed.scheme == 'https' else 80):
        authority += ':' + str(parsed.port)
    origin = urlunsplit((parsed.scheme, authority, '', '', ''))
    entitlements = {'com.apple.developer.associated-domains': ['applinks:' + host]} if parsed.scheme == 'https' and not local else {}
    return {'DoompilePublicURL': origin}, entitlements
