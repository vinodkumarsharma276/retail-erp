#!/usr/bin/env bash
# Database backup:  sudo /opt/retailerp/src/infra/vm/backup.sh [label]
# Writes a pg_dump (custom format) to /opt/retailerp/backups (root-only), checks it
# can be read back, then uploads an age-encrypted copy to R2 when backup.env is set.
# Nightly cron (bootstrap.sh) and every deploy call it.
set -euo pipefail

# Reads KEY=VALUE lines without executing the file as shell code.
load_env() {
  local key value
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] && export "$key=$value"
  done < "$1"
}

main() {
  local label="${1:-manual}"
  local home="${RETAILERP_HOME:-/opt/retailerp}"
  local stack="$home/src/infra/vm/stack.sh"
  local dir="$home/backups"
  install -d -m 700 "$dir"
  umask 077

  local name file
  name="retailerp-$(date +%Y%m%d-%H%M%S)-${label//[^A-Za-z0-9._-]/_}.dump"
  file="$dir/$name"
  "$stack" exec -T postgres pg_dump -U retailerp -d retailerp -Fc > "$file"
  "$stack" exec -T postgres pg_restore -l < "$file" > /dev/null
  echo "== Backup $file ($(du -h "$file" | cut -f1))"

  if [[ -f "$home/backup.env" ]]; then
    load_env "$home/backup.env"
  fi
  if [[ -n "${AGE_RECIPIENT:-}" && -n "${RCLONE_CONFIG_R2_ACCESS_KEY_ID:-}" ]]; then
    age -r "$AGE_RECIPIENT" -o "$file.age" "$file"
    rclone copyto "$file.age" "r2:${R2_BUCKET}/db/$name.age"
    rm -f "$file.age"
    rclone delete --min-age "${REMOTE_RETENTION_DAYS:-30}d" "r2:${R2_BUCKET}/db" || true
    echo "== Uploaded encrypted copy to r2:${R2_BUCKET}/db/$name.age"
  else
    echo "!! backup.env incomplete: kept on this server only" >&2
  fi

  ls -1t "$dir"/*.dump 2>/dev/null | tail -n +"$(( ${LOCAL_KEEP:-7} + 1 ))" | xargs -r rm -f
}

main "$@"
exit