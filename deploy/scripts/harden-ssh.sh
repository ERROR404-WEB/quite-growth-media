#!/usr/bin/env bash
# Locks down SSH: key-only logins, no root login, only the app user may log in.
# Run as root AFTER confirming `ssh <user>@<server-ip>` works:   bash harden-ssh.sh [username]
set -euo pipefail

APP_USER="${1:-qgm}"
CONF=/etc/ssh/sshd_config.d/00-qgm-hardening.conf

[[ $EUID -eq 0 ]] || { echo "Please run as root: sudo bash $0"; exit 1; }
id "$APP_USER" > /dev/null 2>&1 || { echo "User $APP_USER does not exist - run server-setup.sh first."; exit 1; }
USER_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
if [[ ! -s "$USER_HOME/.ssh/authorized_keys" ]]; then
  echo "Refusing: $APP_USER has no SSH key in $USER_HOME/.ssh/authorized_keys - you would be locked out."
  exit 1
fi

# "00-" so it is read before cloud-init's 50-cloud-init.conf (sshd uses the first value it sees).
cat > "$CONF" << EOF
# Managed by deploy/scripts/harden-ssh.sh
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers $APP_USER
EOF

if ! sshd -t; then
  rm -f "$CONF"
  echo "sshd rejected the new settings; nothing was changed."
  exit 1
fi
systemctl reload ssh

echo "Effective settings:"
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|allowusers) '
printf '\n✅ SSH hardened. Test in a NEW terminal before closing this one:  ssh %s@<server-ip>\n' "$APP_USER"
printf 'To undo (from a working session):  sudo rm %s && sudo systemctl reload ssh\n' "$CONF"
