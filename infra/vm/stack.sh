#!/usr/bin/env bash
# docker compose for the hosted stack with the server's settings files.
#   ./stack.sh ps | logs -f api | exec postgres psql -U retailerp
set -euo pipefail
RETAILERP_HOME="${RETAILERP_HOME:-/opt/retailerp}"
export RETAILERP_HOME
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec docker compose --env-file "$RETAILERP_HOME/.env" -f "$here/compose.yml" "$@"