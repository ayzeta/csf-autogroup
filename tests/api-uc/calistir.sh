#!/bin/bash
# api.php tempban_check ucu: dışarıdan (WHMCS CSF Self-Service Unblock) çağrılan, GET ve CSRF anahtarsız TEK okuma ucu.
# Satır biçimi WSL'deki gerçek CSF 16.33'ün csf -td çıktısından (2026-11-19):
#   1795053487|198.51.100.77||in|300|olcum tek / …|198.51.100.78|22|in|300|… / …|198.51.99.0/24||in|300|…
# Uç php-cli ile CGI ortamı kurularak çağrılır (WHM eklentileri de CLI SAPI ile çalışır). ag_guard root ister: root olarak koşulur.
#   bash tests/api-uc/calistir.sh [api.php]      (verilirse o dosyayla: eski sürümle düşürme)
set -u
cd "$(dirname "$0")/../.." || exit 2
API="${1:-whm/api.php}"
PHP="$(command -v php || true)"
[ -n "$PHP" ] || { echo "api-uc: php yok, atlandı"; exit 0; }
[ "$(id -u)" = 0 ] || { echo "api-uc: root gerekir (ag_guard), atlandı"; exit 0; }
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
cp whm/lib.php "$W/lib.php"; cp "$API" "$W/api.php"
PASS=0; FAIL=0
ok() { if eval "$2"; then PASS=$((PASS + 1)); echo "  ✓ $1"; else FAIL=$((FAIL + 1)); echo "  ✗ $1"; echo "      → $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-300)"; fi; }
call() {   # METHOD QUERY [CSF_VAR] → OUT (başlıklar + gövde), BODY (gövde)
    OUT=$(cd "$W" && env -i PATH="$PATH" REMOTE_USER=root REQUEST_METHOD="$1" QUERY_STRING="$2" AG_CSF_VAR="${3:-$W/csf}" \
        CONTENT_LENGTH=0 "$PHP" -d display_errors=0 api.php 2>/dev/null)
    BODY=$(printf '%s' "$OUT" | awk 'f { print } /^\r?$/ { f = 1 }')
}
mkdir -p "$W/csf"
N=$(date +%s)
printf '%s\n' "$((N - 60))|198.51.100.77||in|300|olcum tek" "$((N - 50))|198.51.100.78|22|in|300|olcum port" \
    "$((N - 40))|198.51.99.0/24||in|600|olcum aralik" "$((N - 900))|198.51.100.79|443|in|300|suresi gecmis" \
    "$((N - 30))|198.51.100.80|80|in|300|iki port" "$((N - 20))|198.51.100.80|443|in|900|iki port" > "$W/csf/csf.tempban"

echo "tempban_check ucu ($API)"
call GET "a=tempban_check&ip=198.51.100.77"
ok "Content-Type application/json, gövde yalnız JSON (WHM başlığı yok)" "printf '%s' \"\$OUT\" | grep -qi '^Content-Type: application/json' && printf '%s' \"\$BODY\" | grep -q '^{.*}\$'"
ok "tek IP satırı: banlı, until = zaman + süre, portsuz" "printf '%s' \"\$BODY\" | grep -q '\"ok\":true,\"blocked\":true,\"until\":$((N + 240)),\"ports\":\"\"'"
call GET "a=tempban_check&ip=198.51.100.78"
ok "port sınırlı satır da banlı, ports 22" "printf '%s' \"\$BODY\" | grep -q '\"blocked\":true,\"until\":$((N + 250)),\"ports\":\"22\"'"
call GET "a=tempban_check&ip=198.51.99.5"
ok "IP'yi kapsayan aralık satırı banlı sayılır (rows adresi aralık)" "printf '%s' \"\$BODY\" | grep -q '\"blocked\":true,\"until\":$((N + 560)),.*\"addr\":\"198.51.99.0/24\"'"
call GET "a=tempban_check&ip=198.51.100.79"
ok "süresi geçmiş görünen satır dosyada durdukça banlı (lfd satırı kuralıyla birlikte siler)" "printf '%s' \"\$BODY\" | grep -q '\"blocked\":true,\"until\":$((N - 600)),'"
call GET "a=tempban_check&ip=198.51.100.80"
ok "iki satır: until en geç biteni, ports ikisi" "printf '%s' \"\$BODY\" | grep -q '\"blocked\":true,\"until\":$((N + 880)),\"ports\":\"80,443\"'"
call GET "a=tempban_check&ip=198.51.100.81"
ok "listede olmayan IP: banlı değil, until null" "printf '%s' \"\$BODY\" | grep -q '\"ok\":true,\"blocked\":false,\"until\":null,'"
call GET "a=tempban_check&ip=198.51.100.7"
ok "önek eşleşmesi değil tam adres (198.51.100.7 ≠ .77/.78/.79)" "printf '%s' \"\$BODY\" | grep -q '\"blocked\":false'"
call GET "a=tempban_check&ip=198.51.100.300"
ok "geçersiz IP: ok false, bad_ip" "printf '%s' \"\$BODY\" | grep -q '\"ok\":false,\"error\":\"bad_ip\"'"
call GET "a=tempban_check&ip=198.51.100.77" "$W/yok"
ok "csf.tempban yoksa ban yok (ok true, blocked false)" "printf '%s' \"\$BODY\" | grep -q '\"ok\":true,\"blocked\":false'"
mkdir -p "$W/bozuk/csf.tempban"
call GET "a=tempban_check&ip=198.51.100.77" "$W/bozuk"
ok "csf.tempban okunamıyorsa ok false (çağıran 'ban yok' saymaz)" "printf '%s' \"\$BODY\" | grep -q '\"ok\":false,\"error\":\"unreadable\"'"
# bekçi: uç yalnız okur — durum dizini oluşmaz / değişmez (ag_bootstrap çağrılmaz), motor çağrılmaz
ST=/var/cpanel/csf_autogroup; S0=$(ls -la --time-style=+%s "$ST" 2>/dev/null | md5sum)
call GET "a=tempban_check&ip=198.51.100.77"
ok "uç durum dizinine dokunmaz (ag_bootstrap çağrılmaz)" "[ \"\$(ls -la --time-style=+%s '$ST' 2>/dev/null | md5sum)\" = '$S0' ]"
FN=$(awk '/^function ag_tempban_check/ { f = 1 } f { print } f && /^}/ { exit }' "$W/api.php")
ok "uç gövdesinde yazma / kilit / motor çağrısı yok (ag_run, file_put_contents, flock, exec, shell_exec, unlink)" "[ -n \"\$FN\" ] && ! printf '%s' \"\$FN\" | grep -qE 'ag_run|file_put_contents|flock|fopen|exec\\(|shell_exec|proc_open|unlink|rename|ag_bootstrap'"
# istisna yalnız bu uç ve yalnız GET: başka eylem GET'le CSRF denetimine düşer, bu uç POST'la da öyle
call GET "a=status"
ok "başka eylem GET ile reddedilir (POST only)" "printf '%s' \"\$BODY\" | grep -q '\"error\":\"POST only\"'"
call POST "a=tempban_check&ip=198.51.100.77"
ok "tempban_check POST'la ve anahtarsız gelirse CSRF denetimi reddeder" "printf '%s' \"\$BODY\" | grep -q '\"ok\":false,\"error\":\"session\"'"
OUT=$(cd "$W" && env -i PATH="$PATH" REQUEST_METHOD=GET QUERY_STRING="a=tempban_check&ip=198.51.100.77" AG_CSF_VAR="$W/csf" "$PHP" api.php 2>/dev/null)
ok "WHM oturumu yoksa (REMOTE_USER boş) reddedilir" "printf '%s' \"\$OUT\" | grep -q 'only be opened from WHM'"

# abuse_key (1.15.114): AbuseIPDB anahtarı POST + CSRF ile; api.php motoru STANDART GİRDİYLE çağırır (anahtar komut satırında olmaz),
# motor ayrı dosyaya yazar. Geçici depo kopyası (version.json → repo) ve kendi durum dizini; CSF'e dokunulmaz.
if [ -f csf_autogroup.sh ] && grep -q "case 'abuse_key'" "$W/api.php"; then
    mkdir -p "$W/repo" "$W/st" "$W/csfx"; cp csf_autogroup.sh "$W/repo/"; chown root:root "$W/repo/csf_autogroup.sh"
    : > "$W/csfx/csf.deny"; : > "$W/csfx/csf.allow"; : > "$W/csfx/csf.conf"   # motor açılışta csf.deny ister
    printf '%s\n' "MSG_LANG=tr" "SAYAC_FILE=$W/st/counter" "LOG_FILE=$W/st/log" "CSF_DIR=$W/csfx" "CSF_VAR=$W/csfx" "DENY_FILE=$W/csfx/csf.deny" > "$W/repo/config.env"
    printf '{"version":"t","commit":"","repo":"%s","installed":""}\n' "$W/repo" > "$W/version.json"
    TOK=$(cd "$W" && env -i PATH="$PATH" REMOTE_USER=root "$PHP" -r 'require "lib.php"; ag_bootstrap(); echo ag_csrf_token();' 2>/dev/null)
    post() {   # GÖVDE → OUT / BODY
        OUT=$(cd "$W" && printf '%s' "$1" | env -i PATH="$PATH" REMOTE_USER=root REQUEST_METHOD=POST CONTENT_TYPE=application/x-www-form-urlencoded \
            CONTENT_LENGTH=${#1} "$PHP" -d display_errors=0 api.php 2>/dev/null)
        BODY=$(printf '%s' "$OUT" | awk 'f { print } /^\r?$/ { f = 1 }')
    }
    post "a=abuse_key&key=APIANAHTAR0123456789abcdQRST&csrf=$TOK"
    ok "abuse_key: anahtar POST ile kaydedilir, motor dosyaya yazar (0600)" "printf '%s' \"\$BODY\" | grep -q '\"ok\":true' && grep -q '^APIANAHTAR0123456789abcdQRST\$' '$W/st/abuseipdb/key' && [ \"\$(stat -c %a '$W/st/abuseipdb/key')\" = 600 ]"
    ok "abuse_key: anahtar config.env'e yazılmaz" "! grep -q APIANAHTAR '$W/repo/config.env'"
    ok "abuse_key: api.php motoru anahtarı komut satırında vermez (standart girdi)" "grep -q \"ag_run(\['--config', 'abuse-key', '--json'\], 20, \\\$k)\" '$W/api.php'"
    post "a=abuse_key&key=k%C3%B6t%C3%BC%20anahtar&csrf=$TOK"
    ok "abuse_key: harf ve rakam dışı anahtar reddedilir" "printf '%s' \"\$BODY\" | grep -q '\"ok\":false' && grep -q '^APIANAHTAR' '$W/st/abuseipdb/key'"
    post "a=abuse_key&key=&csrf=$TOK"
    ok "abuse_key: boş anahtar kaldırır" "printf '%s' \"\$BODY\" | grep -q '\"ok\":true' && [ ! -e '$W/st/abuseipdb/key' ]"
    post "a=abuse_key&key=APIANAHTAR0123456789abcdQRST"
    ok "abuse_key: CSRF anahtarı olmadan reddedilir" "printf '%s' \"\$BODY\" | grep -q '\"error\":\"session\"' && [ ! -e '$W/st/abuseipdb/key' ]"
    # abuse_block (1.15.116): aralık kartı düğmesi; /16–/31 dışı ve bozuk giriş motora gitmeden reddedilir, geçerli giriş motora
    # gider (anahtar yok → motorun "nokey" cevabı); CSRF'siz istek reddedilir
    post "a=abuse_block&cidr=158.101.136.0/24&csrf=$TOK"
    ok "abuse_block: geçerli aralık motora gider (anahtarsız: nokey)" "printf '%s' \"\$BODY\" | grep -q '\"error\":\"nokey\"'"
    post "a=abuse_block&cidr=158.0.0.0/8&csrf=$TOK"
    ok "abuse_block: /16'dan geniş aralık reddedilir" "printf '%s' \"\$BODY\" | grep -q '\"error\":\"bad_input\"'"
    post "a=abuse_block&cidr=158.101.136.0%2F24%3Bid&csrf=$TOK"
    ok "abuse_block: bozuk giriş reddedilir" "printf '%s' \"\$BODY\" | grep -q '\"error\":\"bad_input\"'"
    post "a=abuse_block&cidr=158.101.136.0/24"
    ok "abuse_block: CSRF anahtarı olmadan reddedilir" "printf '%s' \"\$BODY\" | grep -q '\"error\":\"session\"'"
fi

echo "api-uc: $PASS geçti, $FAIL düştü"
[ "$FAIL" = 0 ]
