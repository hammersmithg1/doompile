#!/usr/bin/env bash
set -euo pipefail
source_root=$(cd "$(dirname "$0")/.." && pwd)
export DOOMPILE_PROJECT_ROOT=${DOOMPILE_PROJECT_ROOT:-$source_root}
exec "$source_root/infra/ops" deploy "${1:-staging}" --source "$source_root"
