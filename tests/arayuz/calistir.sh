#!/bin/bash
# Arayüz testi: WHM eklentisi (index.php, api.php, ag.js) gerçek motor ve gerçek CSF dosyalarıyla, WHM olmadan PHP'nin
# yerleşik sunucusunda açılır; başsız Chromium (Playwright) sekmeleri gezer, IP kartlarını ve menüleri açar, Yoksay
# akışını uçtan uca çalıştırır. Denetlenenler: JS hatası yok; 1280 ve 390 px'te yatay taşma yok; kesilen rozet yok;
# her Kontrol edilecekler satırının menüsünde Yoksay var; Yoksay → Yoksayılanlar → Yoksaymayı kaldır çalışıyor.
#
#   bash tests/arayuz/calistir.sh            (root; kurulu CSF ya da tests/senaryo/kur-bulut.sh; php, node, playwright)
#   GORUNTU=1 … → ekran görüntüleri tests/arayuz/cikti/ altına
#
# Sunucuda ÇALIŞTIRMAYIN: Yoksay akışı gerçek yoksayma dosyasına yazar (sonra geri alınır) ve eklentinin durum dizinini
# kullanır. Test makinesi ya da kapsayıcı içindir. Playwright: npm i playwright && npx playwright install chromium.
set -u
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
[ "$(id -u)" = 0 ] || { echo "arayüz testi: root gerekir (api.php motoru root ister)"; exit 2; }
for b in php node; do command -v "$b" >/dev/null 2>&1 || { echo "arayüz testi: $b yok"; exit 2; }; done
[ -x /usr/sbin/csf ] || { echo "arayüz testi: kurulu CSF gerekir (tests/senaryo/kur-bulut.sh)"; exit 2; }
# playwright: yerel node_modules, NODE_PATH, npm'in genel dizini ya da /opt/node-tools (bulut oturumu) sırasıyla denenir
for p in "${NODE_PATH:-}" "$(npm root -g 2>/dev/null)" /opt/node-tools/node_modules; do
    [ -n "$p" ] && NODE_PATH="$p" node -e "require('playwright')" 2>/dev/null && { export NODE_PATH="$p"; break; }
done
node -e "require('playwright')" 2>/dev/null || { echo "arayüz testi: playwright modülü yok (npm i playwright && npx playwright install chromium)"; exit 2; }
W="$(mktemp -d)"; PORT="${PORT:-8098}"
cleanup() { [ -n "${PHPPID:-}" ] && kill "$PHPPID" 2>/dev/null; rm -rf "$W"; }
trap cleanup EXIT
# panelin kopyası: shebang satırları kalkar (cPanel'in PHP yolu), version.json install.sh'nin yazdığı biçimde
mkdir -p "$W/panel" && cp -a "$REPO/whm/." "$W/panel/" && sed -i '1{/^#!/d}' "$W/panel/index.php" "$W/panel/api.php"
printf '{"version":"%s","commit":"%s","repo":"%s","installed":"%s"}\n' "$(sed -n 's/^VERSION="\([^"]*\)".*/\1/p' "$REPO/csf_autogroup.sh")" \
    "$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null)" "$REPO" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$W/panel/version.json"
[ -f "$REPO/config.env" ] || { cp "$REPO/config.env.example" "$REPO/config.env"; sed -i 's/^MSG_LANG=.*/MSG_LANG=tr/' "$REPO/config.env"; }
mkdir -p /var/cpanel/csf_autogroup
( cd "$W/panel" && REMOTE_USER=root exec php -S "127.0.0.1:$PORT" -t "$W/panel" >"$W/php.log" 2>&1 ) &
PHPPID=$!
for i in $(seq 1 30); do curl -s --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/index.php" && break; sleep 0.5; done
OUT=""; [ "${GORUNTU:-0}" = 1 ] && { OUT="$H/cikti"; mkdir -p "$OUT"; }
node "$H/tarayici.js" "http://127.0.0.1:$PORT/index.php" "$OUT"; RC=$?
[ "$RC" = 0 ] || { echo "--- php.log"; tail -5 "$W/php.log"; }
exit $RC
