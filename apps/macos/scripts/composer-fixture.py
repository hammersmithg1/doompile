#!/usr/bin/env python3
"""Launch the local UI fixture against the production synchronization engine."""
import os
from pathlib import Path
root = Path(__file__).resolve().parents[3]
os.chdir(root)
environment = dict(os.environ, TSX_TSCONFIG_PATH=str(root / "apps/web/tsconfig.json"))
os.execvpe("node", ["node", "--import", "tsx", ".agents/ci/composer-fixture.ts"], environment)
