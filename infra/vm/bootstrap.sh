#!/usr/bin/env bash
# One-time server setup for the RetailERP stack on Ubuntu 22.04/24.04 (x86_64 or arm64).
#
#   curl -fsSL https://raw.githubusercontent.com/vinodkumarsharma276/retail-erp/main/infra/vm/bootstrap.sh -o bootstrap.sh
#   sudo bash bootstrap.sh you@example.com
#
# Idempotent: re-running keeps existing settings and secrets. It
#  - sets the time zone, installs Docker, git, age, rclone and security auto-updates
#  - opens 80/443 in the host firewall (Oracle images reject them by default)
#  - adds swap on small machines
#  - clones the repository to /opt/retailerp/src
#  - creates /opt/retailerp/{.env,api.env,backup.env} with generated secrets (chmod 600)
#  - installs the nightly backup cron job
# It does not start the stack: the first deploy.sh run does.
set -euo pipefail

ACME_EMAIL="${1:-}"
HOME_DIR=/opt/retailerp
REPO=https://github.com/vinodkumarsharma276/retail-erp.git
[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }

echo "== Packages"
timedatectl set-timezone Asia/Kolkata || true
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl git age rclone unattended-upgrades openssl cron
dpkg-reconfigure -f noninteractive unattended-upgrades
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker cron

echo "== Firewall (host)"
for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
  # shellcheck disable=SC2086
  iptables -C INPUT $rule -j ACCEPT 2>/dev/null || iptables -I INPUT 1 $rule -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi

echo "== Swap"
if [[ "$(swapon --show | wc -l)" -eq 0 && "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 4000000 ]]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== $HOME_DIR"
install -d -m 755 "$HOME_DIR"
install -d -m 700 "$HOME_DIR/backups"
[[ -d "$HOME_DIR/src/.git" ]] || git clone --quiet "$REPO" "$HOME_DIR/src"
git config --global --add safe.directory "$HOME_DIR/src"

gen() { openssl rand -hex "$1"; }
seed() { # seed <example> <target>
  [[ -f "$2" ]] && { echo "   keep existing $(basename "$2")"; return; }
  install -m 600 "$1" "$2"
  echo "   created $(basename "$2")"
}
seed "$HOME_DIR/src/infra/vm/stack.env.example" "$HOME_DIR/.env"
seed "$HOME_DIR/src/apps/api/.env.production.example" "$HOME_DIR/api.env"
seed "$HOME_DIR/src/infra/vm/backup.env.example" "$HOME_DIR/backup.env"

sed -i "s/^POSTGRES_PASSWORD=<generate>$/POSTGRES_PASSWORD=$(gen 24)/" "$HOME_DIR/.env"
[[ -n "$ACME_EMAIL" ]] && sed -i "s/^ACME_EMAIL=$/ACME_EMAIL=$ACME_EMAIL/" "$HOME_DIR/.env"
for key in JWT_SECRET JWT_REFRESH_SECRET BANK_FEED_SECRET_KEY; do
  sed -i "s/^$key=<generate>$/$key=$(gen 48)/" "$HOME_DIR/api.env"
done

chmod +x "$HOME_DIR"/src/infra/vm/*.sh

# The CI key's forced command (ci-deploy.sh) may run deploy.sh as root, nothing else.
if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
  echo "$SUDO_USER ALL=(root) NOPASSWD: $HOME_DIR/src/infra/vm/deploy.sh" > /etc/sudoers.d/retailerp-deploy
  chmod 440 /etc/sudoers.d/retailerp-deploy
  visudo -cf /etc/sudoers.d/retailerp-deploy >/dev/null
fi

echo "== Nightly backup (02:30 IST)"
cat > /etc/cron.d/retailerp-backup <<CRON
30 2 * * * root $HOME_DIR/src/infra/vm/backup.sh nightly >> /var/log/retailerp-backup.log 2>&1
CRON

cat <<NEXT

Done. Next:
  1. Edit $HOME_DIR/api.env  (OPENAI_API_KEY, check CORS_ORIGIN) and
     $HOME_DIR/backup.env (R2 + AGE_RECIPIENT); check ACME_EMAIL in $HOME_DIR/.env.
  2. Point api.retailerpai.com (DNS only) at this server's public IP.
  3. Deploy: sudo $HOME_DIR/src/infra/vm/deploy.sh <git-sha>   (or run the GitHub deploy workflow)
  4. CI key: add to ~/.ssh/authorized_keys of the deploy user as
     command="$HOME_DIR/src/infra/vm/ci-deploy.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... github-actions
NEXT