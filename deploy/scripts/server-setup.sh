#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server.
# Run as root on the server:   bash server-setup.sh [username]     (default username: qgm)
#
# What it does (safe to re-run):
#   1. installs security updates and basic tools
#   2. creates a sudo user (copies root's SSH key so you can log in as that user)
#   3. firewall (ufw): only SSH, HTTP and HTTPS are open
#   4. fail2ban (blocks repeated SSH login failures) + automatic security updates
#   5. 2 GB swap file (protects small servers from running out of memory)
#   6. Docker Engine + Compose plugin from Docker's official apt repository
#   7. backup folder
# It does NOT disable root/password login - do that with harden-ssh.sh after you've
# confirmed you can log in as the new user.
set -euo pipefail

APP_USER="${1:-qgm}"
BACKUP_DIR="/var/backups/qgm"

step() { printf '\n==> [%s] %s\n' "$1" "$2"; }

[[ $EUID -eq 0 ]] || { echo "Please run as root: sudo bash $0"; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
[[ "$ID" == "ubuntu" ]] || { echo "This script supports Ubuntu only (found: $ID)."; exit 1; }
[[ "$VERSION_ID" == "24.04" ]] || echo "WARNING: written for Ubuntu 24.04, this server runs $VERSION_ID."
[[ "$APP_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "Invalid username: $APP_USER"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

step 1/7 "Installing updates and basic tools (this can take a few minutes)"
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install ca-certificates curl git ufw fail2ban unattended-upgrades

step 2/7 "Creating user '$APP_USER'"
if ! id "$APP_USER" > /dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$APP_USER"
fi
usermod -aG sudo "$APP_USER"
if [[ "$(passwd -S "$APP_USER" | awk '{print $2}')" != "P" ]]; then
  echo "Choose a password for '$APP_USER' (needed for sudo; save it in your password manager):"
  passwd "$APP_USER"
fi
USER_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$USER_HOME/.ssh"
if [[ -s /root/.ssh/authorized_keys && ! -s "$USER_HOME/.ssh/authorized_keys" ]]; then
  install -m 600 -o "$APP_USER" -g "$APP_USER" /root/.ssh/authorized_keys "$USER_HOME/.ssh/authorized_keys"
fi
[[ -s "$USER_HOME/.ssh/authorized_keys" ]] || echo "WARNING: $APP_USER has no SSH key yet - add one before running harden-ssh.sh."

step 3/7 "Configuring the firewall (SSH, HTTP, HTTPS only)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

step 4/7 "Enabling fail2ban and automatic security updates"
systemctl enable --now fail2ban
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

step 5/7 "Adding a 2 GB swap file (if none exists)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step 6/7 "Installing Docker Engine (official repository)"
if ! command -v docker > /dev/null; then
  # Remove unofficial/conflicting packages (none on a fresh server).
  # shellcheck disable=SC2046
  apt-get -y -q remove $(dpkg --get-selections docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc 2> /dev/null | cut -f1) || true
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources << EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  # Rotate container logs so they can't fill the disk.
  install -d -m 755 /etc/docker
  [[ -f /etc/docker/daemon.json ]] || echo '{ "log-driver": "local", "log-opts": { "max-size": "20m", "max-file": "5" } }' > /etc/docker/daemon.json
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
usermod -aG docker "$APP_USER"
docker run --rm hello-world > /dev/null && echo "Docker works."

step 7/7 "Creating the backup folder $BACKUP_DIR"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$BACKUP_DIR"

printf '\n✅ Server setup complete.\n'
printf '   Docker: %s\n' "$(docker --version)"
printf '   Compose: %s\n' "$(docker compose version)"
printf '\nNEXT: keep this window open and, in a NEW terminal on your laptop, test:\n'
printf '   ssh %s@<server-ip>\n' "$APP_USER"
printf 'Only when that works, run harden-ssh.sh (as root) to switch off root and password logins.\n'
