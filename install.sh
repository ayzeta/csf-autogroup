#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# CSF Auto-Group — installer.  Run as root:  bash install.sh
# Writes config.env next to the script and installs a root cron job.
# Re-runnable; remembers answers in .install.conf.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$SRC/csf_autogroup.sh"
CONF="$SRC/.install.conf"

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run as root (needs cron + CSF)."; exit 1; }
[ -f "$SCRIPT" ] || { echo "ERROR: csf_autogroup.sh not found next to install.sh."; exit 1; }
command -v csf >/dev/null 2>&1 || [ -x /sbin/csf ] || echo "WARNING: csf not found — this tool requires ConfigServer Security & Firewall."

# Defaults (overridden by a previous run)
MSG_LANG="en"; ALERT_MAIL="root@localhost"; CRON_MIN="*/10"
[ -f "$CONF" ] && . "$CONF"

ask() { local p="$1" d="$2" v; read -r -p "$p [$d]: " v || true; echo "${v:-$d}"; }

echo "── CSF Auto-Group install ──"
MSG_LANG="$(ask 'Language for logs/emails (en/tr)' "$MSG_LANG")"
ALERT_MAIL="$(ask 'Email address for alerts' "$ALERT_MAIL")"
CRON_MIN="$(ask 'Cron minute field (how often to run)' "$CRON_MIN")"

echo
echo "  language : $MSG_LANG"
echo "  alerts   : $ALERT_MAIL"
echo "  schedule : $CRON_MIN * * * *   ($SCRIPT)"
read -r -p "Proceed? [y/N]: " ok; case "${ok:-N}" in y|Y) ;; *) echo "Aborted."; exit 0;; esac

cat > "$CONF" <<EOF
MSG_LANG="$MSG_LANG"; ALERT_MAIL="$ALERT_MAIL"; CRON_MIN="$CRON_MIN"
EOF

# config.env (keep any thresholds already customized; only set the two prompts)
if [ -f "$SRC/config.env" ]; then
    sed -i -e "s/^MSG_LANG=.*/MSG_LANG=$MSG_LANG/" -e "s#^ALERT_MAIL=.*#ALERT_MAIL=$ALERT_MAIL#" "$SRC/config.env"
    grep -q '^MSG_LANG='  "$SRC/config.env" || echo "MSG_LANG=$MSG_LANG"   >> "$SRC/config.env"
    grep -q '^ALERT_MAIL=' "$SRC/config.env" || echo "ALERT_MAIL=$ALERT_MAIL" >> "$SRC/config.env"
else
    cp "$SRC/config.env.example" "$SRC/config.env"
    sed -i -e "s/^MSG_LANG=.*/MSG_LANG=$MSG_LANG/" -e "s#^ALERT_MAIL=.*#ALERT_MAIL=$ALERT_MAIL#" "$SRC/config.env"
fi
chmod 700 "$SCRIPT"; chmod 600 "$SRC/config.env"

# Cron (idempotent, safe under set -e)
CRON_LINE="$CRON_MIN * * * * $SCRIPT >/dev/null 2>&1"
EXISTING="$(crontab -l 2>/dev/null | grep -vF "$SCRIPT" || true)"
printf '%s\n%s\n' "$EXISTING" "$CRON_LINE" | crontab -

echo
echo "── Done ──"
echo "Installed cron: $CRON_LINE"
echo "Config: $SRC/config.env   ·   Log: /var/log/csf_autogroup.log"
echo
echo "⚠️  This auto-bans /24 subnets. Make sure your own IPs are in csf.allow,"
echo "    start with high thresholds, and watch the log for a few days:"
echo "      tail -f /var/log/csf_autogroup.log"
echo "Test one run now with:  $SCRIPT"
