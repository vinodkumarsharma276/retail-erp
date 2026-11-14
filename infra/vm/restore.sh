#!/usr/bin/env bash
# Restore a backup made by backup.sh (or a pg_dump -Fc copied from elsewhere).
#
#   sudo restore.sh <file.dump | file.dump.age> [--identity key.txt] [--target db] [--yes]
#
# --target retailerp (default) replaces the live database: the API is stopped, a
#   safety backup is taken, the database is recreated and restored, the API restarts.
# --target <other>  restores into a scratch database for a restore drill; the live
#   database and API are untouched. Drop it afterwards with --drop <other>.
set -euo pipefail

TMP_DUMP=""
trap 'if [[ -n "$TMP_DUMP" ]]; then rm -f "$TMP_DUMP"; fi' EXIT

main() {
  local home="${RETAILERP_HOME:-/opt/retailerp}"
  local stack="$home/src/infra/vm/stack.sh"
  local file="" identity="" target="retailerp" yes=0 drop=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --identity) identity="$2"; shift 2 ;;
      --target) target="$2"; shift 2 ;;
      --drop) drop="$2"; shift 2 ;;
      --yes) yes=1; shift ;;
      *) file="$1"; shift ;;
    esac
  done
  psql() { "$stack" exec -T postgres psql -v ON_ERROR_STOP=1 -U retailerp -d postgres "$@"; }

  if [[ -n "$drop" ]]; then
    [[ "$drop" != "retailerp" ]] || { echo "refusing to drop the live database" >&2; exit 2; }
    psql -c "DROP DATABASE IF EXISTS \"$drop\" WITH (FORCE)"
    echo "== Dropped $drop"; return 0
  fi
  [[ -f "$file" ]] || { echo "usage: restore.sh <file.dump|file.dump.age> [--identity key] [--target db] [--yes]" >&2; exit 2; }
  [[ "$target" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "invalid target database name" >&2; exit 2; }

  umask 077
  local dump="$file"
  if [[ "$file" == *.age ]]; then
    [[ -n "$identity" ]] || { echo "--identity <age key file> is required for .age files" >&2; exit 2; }
    TMP_DUMP="$(mktemp)"; dump="$TMP_DUMP"
    age -d -i "$identity" -o "$dump" "$file"
  fi
  "$stack" exec -T postgres pg_restore -l < "$dump" > /dev/null

  if [[ "$target" == "retailerp" ]]; then
    if [[ $yes -ne 1 ]]; then
      read -r -p "Replace the LIVE database with $(basename "$file")? Type RESTORE: " answer
      [[ "$answer" == "RESTORE" ]] || { echo "aborted"; exit 1; }
    fi
    if "$stack" ps --status running --services | grep -qx api; then
      "$home/src/infra/vm/backup.sh" pre-restore
    fi
    "$stack" stop api
  fi

  psql -c "DROP DATABASE IF EXISTS \"$target\" WITH (FORCE)"
  psql -c "CREATE DATABASE \"$target\" OWNER retailerp"
  "$stack" exec -T postgres pg_restore -U retailerp -d "$target" --no-owner --no-privileges --exit-on-error < "$dump"
  echo "== Restored $(basename "$file") into $target"

  if [[ "$target" == "retailerp" ]]; then
    "$stack" up -d api
    echo "== API restarted; check: $stack ps"
  fi
}

main "$@"
exit