#!/usr/bin/env python3
"""Run commands with secrets authorized by the caller's Tailscale identity."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

SCOPES = {'machine': ['all', 'device'], 'devbox': ['all', 'devbox', 'device'],
          'admin': ['all', 'devbox', 'admin', 'device']}
ENV_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_]*\Z')
DEVICE = re.compile(r'[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\Z')


def settings(home=None):
    home = home or Path.home()
    path = home / '.agents/local/setec.json'
    if not path.exists():
        raise RuntimeError('Configure ~/.agents/local/setec.json with role and device first.')
    profile = json.loads(path.read_text())
    if profile.get('role') not in SCOPES or not DEVICE.fullmatch(profile.get('device', '')):
        raise RuntimeError('Invalid setec device profile.')
    config = json.loads((home / '.agents/common/setec.json').read_text())
    server = config.get('server', '')
    parsed = urlsplit(server)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ('', '/')):
        raise RuntimeError('setec server must be an HTTPS origin.')
    return profile, server.rstrip('/')


def request(server, method, data):
    # Use macOS system TLS and send values on stdin, never in process arguments.
    config = ['silent', 'show-error', 'max-time = 60', 'connect-timeout = 15',
              'noproxy = "*"', 'request = "POST"',
              'url = ' + json.dumps(server + '/api/' + method),
              'header = "Content-Type: application/json"',
              'header = "Sec-X-Tailscale-No-Browsers: setec"',
              'write-out = "\\n%{http_code}"',
              'data-binary = ' + json.dumps(json.dumps(data))]
    try:
        result = subprocess.run(['curl', '--config', '-'], input='\n'.join(config) + '\n',
                                capture_output=True, text=True, timeout=65)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('Cannot reach setec; check Tailscale and server availability.') from None
    body, _, status = result.stdout.rpartition('\n')
    if status in ('401', '403'):
        raise RuntimeError('setec denied access; check Tailscale grants.')
    if result.returncode or status != '200':
        raise RuntimeError('setec request failed (HTTP ' + (status if status.isdigit() else 'unknown') + ').')
    try:
        return json.loads(body)
    except ValueError:
        raise RuntimeError('Invalid response from setec.') from None


def prefixes(profile, scopes=None, device=None):
    selected = SCOPES[profile['role']] if scopes is None else scopes
    if any(s not in SCOPES[profile['role']] for s in selected):
        raise RuntimeError('Scope is outside the configured device role.')
    device = device or profile['device']
    if not DEVICE.fullmatch(device):
        raise RuntimeError('Invalid device name.')
    if device != profile['device'] and profile['role'] != 'admin':
        raise RuntimeError('Only admin can select another device.')
    # Canonical precedence is independent of argument order.
    return [s + '/' if s != 'device' else 'devices/' + device + '/'
            for s in SCOPES[profile['role']] if s in selected]


def load(scopes=None, device=None, home=None, *, with_names=False):
    profile, server = settings(home)
    selected = prefixes(profile, scopes, device)
    visible = request(server, 'list', {}) or []
    names = [info['Name'] for info in visible]
    merged = {}
    for prefix in selected:
        for path in sorted(n for n in names if n.startswith(prefix)):
            name = path[len(prefix):]
            if not ENV_NAME.fullmatch(name):
                continue
            value = base64.b64decode(request(server, 'get', {'Name': path})['Value'], validate=True).decode('utf-8')
            if '\0' in value:
                raise RuntimeError('A secret contains a NUL byte and cannot be used as ENV.')
            merged[name] = value
    managed_names = {n.rsplit('/', 1)[-1] for n in names if ENV_NAME.fullmatch(n.rsplit('/', 1)[-1])}
    return (merged, managed_names) if with_names else merged


def command_environment(values, managed_names):
    # A long-running shell may still hold keys from a previously selected scope.
    return {**{k:v for k,v in os.environ.items() if k not in managed_names}, **values}


def put(name, scope, value, device=None, home=None):
    if not ENV_NAME.fullmatch(name):
        raise RuntimeError('Invalid ENV name.')
    profile, server = settings(home)
    path = prefixes(profile, [scope], device)[0] + name
    version = request(server, 'put', {'Name': path, 'Value': base64.b64encode(value).decode('ascii')})
    request(server, 'activate', {'Name': path, 'Version': version})
    return path, version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope', action='append', choices=['all', 'devbox', 'admin', 'device'])
    parser.add_argument('--device', help='Admin: select another device personal scope')
    parser.add_argument('--check', action='store_true', help='List loaded ENV names, never values')
    parser.add_argument('--put', metavar='ENV_NAME', help='Admin: read a value from stdin and activate it')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if args.put:
            if len(args.scope or []) != 1 or args.check or args.command:
                parser.error('--put needs exactly one --scope and no command or --check')
            if sys.stdin.isatty():
                parser.error('Pass the secret on stdin; do not type it into a terminal command')
            name, version = put(args.put, args.scope[0], sys.stdin.buffer.read(), args.device)
            print('Activated ' + name + ', version ' + str(version))
            return
        values, managed_names = load(args.scope, args.device, with_names=True)
        if args.check:
            print('Available: ' + ', '.join(sorted(values)))
            return
        command = args.command[1:] if args.command[:1] == ['--'] else args.command
        if not command:
            parser.error('Pass -- <command> or --check')
        env = command_environment(values, managed_names)
        os.execvpe(command[0], command, env)
    except (RuntimeError, OSError, ValueError, KeyError, TypeError) as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Could not load setec secrets.', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
