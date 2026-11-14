#!/usr/bin/env bash
# Forced command for the CI deploy SSH key (see bootstrap.sh). The key can only
# run "deploy <git-sha>"; anything else is refused.
set -euo pipefail
read -r verb sha extra <<<"${SSH_ORIGINAL_COMMAND:-}"
if [[ "$verb" != "deploy" || ! "$sha" =~ ^[0-9a-f]{40}$ || -n "${extra:-}" ]]; then
  echo "refused: expected 'deploy <40-char git sha>'" >&2
  exit 2
fi
exec sudo /opt/retailerp/src/infra/vm/deploy.sh "$sha"