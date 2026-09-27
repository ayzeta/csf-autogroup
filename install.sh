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
# -y / --yes : non-interactive re-deploy using saved answers (for update.sh).
AUTO=0
case "${1:-}" in -y|--yes) AUTO=1;; esac

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run as root (needs cron + CSF)."; exit 1; }
[ -f "$SCRIPT" ] || { echo "ERROR: csf_autogroup.sh not found next to install.sh."; exit 1; }
command -v csf >/dev/null 2>&1 || [ -x /sbin/csf ] || echo "WARNING: csf not found — this tool requires ConfigServer Security & Firewall."
command -v dig >/dev/null 2>&1 || command -v host >/dev/null 2>&1 || \
    echo "NOTE: neither 'dig' nor 'host' found — install bind-utils (dnf install bind-utils) for owner/hostname info in emails and CC_IGNORE/csf.rignore checks."

# Defaults (overridden by a previous run)
MSG_LANG="en"; ALERT_MAIL="root@localhost"; CRON_MIN="*/10"
[ -f "$CONF" ] && . "$CONF"

ask() { local p="$1" d="$2" v; read -r -p "$p [$d]: " v || true; echo "${v:-$d}"; }
# .install.conf her güncellemede kabukta okunur: yalnız güvenli karakterlere izin verilir.
valid() {   # KEY VALUE
    case "$1" in
        MSG_LANG)   [[ "$2" =~ ^(en|tr)$ ]] ;;
        ALERT_MAIL) [[ "$2" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]] ;;
        CRON_MIN)   [[ "$2" =~ ^(\*/[0-9]{1,2}|[0-9]{1,2})$ ]] ;;
    esac
}
ask_valid() {   # KEY PROMPT DEFAULT
    local v
    while :; do
        v="$(ask "$2" "$3")"
        valid "$1" "$v" && { echo "$v"; return; }
        echo "  invalid value: $v" >&2
    done
}

if [ $AUTO -eq 1 ]; then
    # Non-interactive: reuse saved answers, keep config.env (thresholds/lang) as-is.
    [ -f "$CONF" ] || { echo "ERROR: no saved config (.install.conf). Run 'bash install.sh' once interactively first."; exit 1; }
    for k in MSG_LANG ALERT_MAIL CRON_MIN; do
        valid "$k" "${!k}" || { echo "ERROR: invalid $k in .install.conf: ${!k}  — run 'bash install.sh' interactively."; exit 1; }
    done
    echo "── Update (non-interactive) ──  lang: $MSG_LANG  alerts: $ALERT_MAIL  cron: $CRON_MIN"
    [ -f "$SRC/config.env" ] || { cp "$SRC/config.env.example" "$SRC/config.env"
        sed -i -e "s/^MSG_LANG=.*/MSG_LANG=$MSG_LANG/" -e "s#^ALERT_MAIL=.*#ALERT_MAIL=$ALERT_MAIL#" "$SRC/config.env"; }
else
    echo "── CSF Auto-Group install ──"
    MSG_LANG="$(ask_valid MSG_LANG 'Language for logs/emails (en/tr)' "$MSG_LANG")"
    ALERT_MAIL="$(ask_valid ALERT_MAIL 'Email address for alerts' "$ALERT_MAIL")"
    CRON_MIN="$(ask_valid CRON_MIN 'Cron minute field (e.g. */10)' "$CRON_MIN")"

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
fi
chmod 700 "$SCRIPT"; [ -f "$SRC/config.env" ] && chmod 600 "$SRC/config.env"

# Cron (idempotent, safe under set -e)
CRON_LINE="$CRON_MIN * * * * $SCRIPT >/dev/null 2>&1"
EXISTING="$(crontab -l 2>/dev/null | grep -vF "$SCRIPT" || true)"
printf '%s\n%s\n' "$EXISTING" "$CRON_LINE" | crontab -

# ── Log rotation (logrotate varsa) ──────────────────────────────────
# Günlük LOG_ROTATE_MB'ı geçince döndürülür, son LOG_ROTATE_KEEP arşiv sıkıştırılmış saklanır. Betik bu dosyayı görünce
# kendi satır sınırıyla kesmeyi bırakır; logrotate yoksa LOG_MAX_LINES kullanılır.
ROTATE="skipped (logrotate not found)"
if [ -d /etc/logrotate.d ] && command -v logrotate >/dev/null 2>&1; then
    # boyut ve arşiv sayısı config.env'den (Ayarlar sekmesi): dosyayı betiğin kendisi yazar
    if R="$("$SCRIPT" --logrotate 2>/dev/null)"; then ROTATE="$R"; else ROTATE="failed (try: $SCRIPT --logrotate)"; fi
fi

# ── WHM plugin (cPanel servers only) ────────────────────────────────
# Page + JSON endpoints under WHM → Plugins. Root / "all"-privileged WHM users only.
# Files are written next to their target and renamed into place, so a request
# arriving mid-update never reads a half-written PHP file.
REGISTER=/usr/local/cpanel/bin/register_appconfig
CGI=/usr/local/cpanel/whostmgr/docroot/cgi/csf_autogroup
PLUGIN="skipped (not a cPanel server)"
if [ -x "$REGISTER" ] && [ -d "$SRC/whm" ]; then
    PHP=""
    for c in /usr/local/cpanel/3rdparty/bin/php /usr/local/bin/php /usr/bin/php; do
        [ -x "$c" ] && { PHP="$c"; break; }
    done
    LINT_OK=1
    if [ -n "$PHP" ]; then
        for f in "$SRC"/whm/*.php; do
            if ! "$PHP" -l "$f" >/dev/null 2>&1; then echo "PHP syntax error: $f"; LINT_OK=0; fi
        done
    fi
    if [ -z "$PHP" ]; then
        PLUGIN="skipped (PHP not found)"
    elif [ "$LINT_OK" != 1 ]; then
        PLUGIN="skipped (PHP syntax check failed — the plugin was left as it was)"
    else
        put() {   # MODE SOURCE TARGET [SHEBANG-PHP]
            local tmp="$3.new.$$"
            install -m "$1" "$2" "$tmp" || return 1
            if [ -n "${4:-}" ]; then sed -i "1s|^#!.*|#!$4|" "$tmp"; fi
            mv -f "$tmp" "$3"
        }
        install -d -m 0755 "$CGI" "$CGI/assets"
        install -d -m 0700 /var/cpanel/csf_autogroup
        put 0600 "$SRC/whm/lib.php" "$CGI/lib.php"                 # library first, entry points last
        for a in "$SRC"/whm/assets/*; do put 0644 "$a" "$CGI/assets/$(basename "$a")"; done
        V="$(sed -n 's/^VERSION="\([^"]*\)".*/\1/p' "$SCRIPT")"
        G="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || true)"
        printf '{"version":"%s","commit":"%s","repo":"%s","installed":"%s"}\n' \
            "$V" "$G" "$SRC" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$CGI/version.json.new" && mv -f "$CGI/version.json.new" "$CGI/version.json"
        put 0755 "$SRC/whm/api.php" "$CGI/api.php" "$PHP"
        put 0755 "$SRC/whm/index.php" "$CGI/index.php" "$PHP"
        chown -R root:root "$CGI"
        install -d -m 0755 /var/cpanel/apps
        install -m 0600 "$SRC/whm/csf_autogroup.conf" /var/cpanel/apps/csf_autogroup.conf
        for d in /usr/local/cpanel/whostmgr/docroot/addon_plugins /usr/local/cpanel/whostmgr/docroot/themes/x/icons; do
            if [ -d "$d" ]; then install -m 0644 "$SRC/whm/csf_autogroup.svg" "$d/csf_autogroup.svg"; break; fi
        done
        if "$REGISTER" /var/cpanel/apps/csf_autogroup.conf >/dev/null 2>&1; then
            PLUGIN="WHM → Plugins → CSF Auto-Group"
        else
            PLUGIN="files installed, but register_appconfig failed"
        fi
    fi
fi

echo
echo "── Done ──"
echo "Installed cron: $CRON_LINE"
echo "WHM plugin: $PLUGIN"
echo "Log rotation: $ROTATE"
echo "Config: $SRC/config.env   ·   Log: /var/log/csf_autogroup.log"
echo
echo "⚠️  This auto-bans /24 subnets. Make sure your own IPs are in csf.allow,"
echo "    start with high thresholds, and watch the log for a few days:"
echo "      tail -f /var/log/csf_autogroup.log"
echo "Test one run now with:  $SCRIPT"
