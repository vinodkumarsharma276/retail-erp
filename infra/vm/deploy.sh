#!/usr/bin/env bash
# Release one API build:  sudo /opt/retailerp/src/infra/vm/deploy.sh <git-sha>
#
#  1. checks out <git-sha> in /opt/retailerp/src (compose file, Caddyfile, scripts)
#  2. pulls image $API_IMAGE:<git-sha>
#  3. takes a pre-deploy database backup
#  4. applies committed Prisma migrations in a one-off container
#  5. starts the new API and waits for /api/ready
#  6. on failure before migrations: nothing changed; after: rolls the API image and
#     checkout back to the previous release (the schema stays migrated; restore the
#     pre-deploy backup with restore.sh if the old code cannot run on it).
set -euo pipefail

main() {
  local sha="${1:-}"
  [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || { echo "usage: deploy.sh <git-sha>" >&2; exit 2; }

  local home="${RETAILERP_HOME:-/opt/retailerp}"
  local src="$home/src"
  local stack="$src/infra/vm/stack.sh"

  # Run the deploy script of the release being deployed, not the one checked out.
  if [[ -z "${RETAILERP_DEPLOY_REEXEC:-}" ]]; then
    git -C "$src" fetch --quiet origin
    local script
    script="$(mktemp)"
    git -C "$src" show "${sha}:infra/vm/deploy.sh" > "$script"
    RETAILERP_DEPLOY_REEXEC="$script" exec bash "$script" "$sha"
  fi
  rm -f "$RETAILERP_DEPLOY_REEXEC"

  exec 9>"$home/.deploy.lock"
  flock -n 9 || { echo "Another deploy is running." >&2; exit 1; }

  local prev_sha prev_tag
  prev_sha="$(git -C "$src" rev-parse HEAD)"
  prev_tag="$(sed -n 's/^API_TAG=//p' "$home/.env")"
  echo "== Deploying $sha (previous: ${prev_tag:-none})"

  sha="$(git -C "$src" rev-parse --verify "${sha}^{commit}")"
  # Until migrations run, any failure puts the checkout and API_TAG back as they were.
  revert() {
    echo "!! $1; API stays on ${prev_tag:-none}." >&2
    git -C "$src" checkout --quiet --detach "$prev_sha"
    set_tag "$home" "$prev_tag"
    exit 1
  }
  git -C "$src" checkout --quiet --detach "$sha"
  set_tag "$home" "$sha"

  "$stack" pull api || revert "Image for $sha not found"
  "$stack" up -d --wait postgres || revert "PostgreSQL did not start"
  if "$stack" ps --status running --services | grep -qx api; then
    "$src/infra/vm/backup.sh" "pre-$sha" || revert "Pre-deploy backup failed"
  else
    echo "== API not running yet; skipping pre-deploy backup"
  fi

  echo "== Applying migrations"
  "$stack" run --rm --no-deps api npx prisma migrate deploy \
    || revert "Migration failed (if it stopped half-way, restore the pre-deploy backup with restore.sh)"
  "$stack" up -d --remove-orphans
  if wait_healthy "$stack"; then
    echo "== $sha is live"
    docker image prune -af --filter "until=336h" >/dev/null || true
    return 0
  fi

  echo "!! $sha failed its health check." >&2
  "$stack" logs --tail 80 api >&2 || true
  if [[ -n "$prev_tag" ]]; then
    echo "== Rolling back to $prev_tag" >&2
    git -C "$src" checkout --quiet --detach "$prev_sha"
    set_tag "$home" "$prev_tag"
    "$src/infra/vm/stack.sh" up -d --remove-orphans
    wait_healthy "$src/infra/vm/stack.sh" || echo "!! Previous release is unhealthy too." >&2
  fi
  exit 1
}

set_tag() {
  local home="$1" tag="$2"
  sed -i "s/^API_TAG=.*/API_TAG=${tag}/" "$home/.env"
}

wait_healthy() {
  local stack="$1" id status
  for _ in $(seq 1 40); do
    id="$("$stack" ps -q api)"
    status="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || echo starting)"
    [[ "$status" == "healthy" ]] && return 0
    sleep 3
  done
  return 1
}

main "$@"
exit