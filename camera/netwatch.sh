#!/usr/bin/env bash
# Network self-heal watchdog for the bird-cam Pi (WiFi-only deployments).
#
# Install on the Pi:
#   sudo cp netwatch.sh /usr/local/sbin/ && sudo chmod +x /usr/local/sbin/netwatch.sh
#   sudo cp netwatch.service netwatch.timer /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now netwatch.timer
#
# Logic: if the internet has been unreachable for 5 min, bounce WiFi; for 20 min,
# reboot. The failure timestamp lives in /run (tmpfs) so it resets on reboot and
# the moment connectivity returns — no reboot loops while things are healthy.
set -u
STAMP="/run/netwatch.first-fail"
if ping -c2 -W3 1.1.1.1 >/dev/null 2>&1 || ping -c2 -W3 8.8.8.8 >/dev/null 2>&1; then
  rm -f "$STAMP"; exit 0
fi
now=$(date +%s); first=$(cat "$STAMP" 2>/dev/null || echo "$now"); echo "$first" >"$STAMP"
elapsed=$(( now - first )); logger -t netwatch "offline ${elapsed}s"
if   [ "$elapsed" -ge 1200 ]; then logger -t netwatch reboot; /sbin/reboot
elif [ "$elapsed" -ge 300 ];  then logger -t netwatch "bounce wifi"; systemctl restart NetworkManager; fi
