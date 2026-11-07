#!/usr/bin/env python3
"""Record which artifacts are ready after a trusted hosted CI job succeeds."""

import argparse
import json
import os
from pathlib import Path
import re


def receipt(kind, environment, artifact_id=None):
    commit = environment['GITHUB_SHA']
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Invalid source commit.')
    if environment['GITHUB_REF'] != 'refs/heads/main' or environment['GITHUB_EVENT_NAME'] not in ('push', 'workflow_dispatch'):
        raise ValueError('Release receipts require a trusted main run.')
    if kind != 'web' and (artifact_id is None or artifact_id <= 0):
        raise ValueError('A native release needs its sealed artifact.')
    return {
        'schema': 1,
        'kind': kind,
        'commit': commit,
        'repository_id': int(environment['GITHUB_REPOSITORY_ID']),
        'run': int(environment['GITHUB_RUN_ID']),
        'attempt': int(environment['GITHUB_RUN_ATTEMPT']),
        'artifact_id': artifact_id,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['web', 'ios', 'macos'])
    parser.add_argument('output', type=Path)
    parser.add_argument('--artifact-id', type=int)
    args = parser.parse_args()
    args.output.write_text(json.dumps(receipt(args.kind, os.environ, args.artifact_id)) + '\n')
