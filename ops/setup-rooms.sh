#!/usr/bin/env bash
#
# One-time setup for Online 1v1 on the urbancare VM, run with sudo:
#
#   sudo bash ~/stickman/ops/setup-rooms.sh
#
# 1. runs the room server (server/server.js) from the checkout as a systemd service
# 2. adds nginx's /ws proxy to it, inside the live site file: that file has certbot's TLS
#    lines in it, so it is edited in place (with a backup) rather than replaced by
#    ops/nginx/stickman.conf
# 3. lets the deploy user restart that one service without a password, so ops/deploy.sh
#    can pick up changes to server/
#
# Safe to run again: each step checks whether it is already done.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo bash $0"; exit 1; }
RUN_AS=${SUDO_USER:-urbancare_admin}
CHECKOUT=/home/urbancare/stickman
SITE=/etc/nginx/sites-available/stickman
UNIT=/etc/systemd/system/stickman-rooms.service
SUDOERS=/etc/sudoers.d/stickman-rooms

[ -f "$CHECKOUT/server/server.js" ] || { echo "No $CHECKOUT/server/server.js - push first."; exit 1; }
command -v node >/dev/null || { echo "Node is not installed."; exit 1; }

echo "1/3 room server: stickman-rooms.service, running as $RUN_AS"
cat > "$UNIT" <<EOF
[Unit]
Description=Shuttle Sticks online rooms (WebSocket relay)
After=network.target

[Service]
User=$RUN_AS
WorkingDirectory=$CHECKOUT
Environment=PORT=8787 HOST=127.0.0.1 STATIC=0
ExecStart=$(command -v node) server/server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable stickman-rooms >/dev/null 2>&1
systemctl restart stickman-rooms
sleep 1
if ! systemctl is-active --quiet stickman-rooms; then
  journalctl -u stickman-rooms -n 20 --no-pager
  echo "The room server did not start (log above)."
  exit 1
fi
echo "    running"

echo "2/3 nginx: /ws -> 127.0.0.1:8787"
if grep -q 'location = /ws' "$SITE"; then
  echo "    already set up"
else
  backup="$SITE.bak.$(date +%Y%m%d%H%M%S)"
  cp "$SITE" "$backup"
  python3 - "$SITE" <<'PY'
import sys
path = sys.argv[1]
text = open(path).read()
block = """    # Online 1v1: the room server (server/server.js, run by stickman-rooms.service).
    location = /ws {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

"""
marker = "    # Never serve dotfiles"
at = text.find(marker)
if at < 0:
    sys.exit("Could not find where to add /ws in " + path + " (no '# Never serve dotfiles' line).")
open(path, "w").write(text[:at] + block + text[at:])
PY
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "    added (backup: $backup)"
  else
    cp "$backup" "$SITE"
    nginx -t || true
    echo "nginx rejected the change; the old file is back in place."
    exit 1
  fi
fi

echo "3/3 sudoers: $RUN_AS may run 'systemctl restart stickman-rooms' (for ops/deploy.sh)"
rule="$RUN_AS ALL=(root) NOPASSWD: $(command -v systemctl) restart stickman-rooms"
if [ -f "$SUDOERS" ] && grep -qxF "$rule" "$SUDOERS"; then
  echo "    already set up"
else
  printf '%s\n' "$rule" > "$SUDOERS.tmp"
  chmod 440 "$SUDOERS.tmp"
  if visudo -cf "$SUDOERS.tmp" >/dev/null; then
    mv "$SUDOERS.tmp" "$SUDOERS"
    echo "    added"
  else
    rm -f "$SUDOERS.tmp"
    echo "    visudo rejected the rule; skipped (deploy.sh will remind you to restart by hand)"
  fi
fi

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 --resolve stickman.urbancare.ge:443:127.0.0.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' https://stickman.urbancare.ge/ws || true)
if [ "$code" = 101 ]; then
  echo "Done: wss://stickman.urbancare.ge/ws answers. Online 1v1 is live."
else
  echo "Set up, but wss://stickman.urbancare.ge/ws answered ${code:-nothing} instead of 101."
  exit 1
fi
