#!/bin/bash
# Panel betiğinde tanımsız ad taraması (ESLint no-undef).
# Yakaladığı sınıf: bir işlevin içinde tanımlı yardımcının başka bir işlevden
# çağrılması — o yol yalnız belli veriyle (ör. ASN bilgisi) çalıştığı için
# tarayıcı testi kaçırabilir; çalışma anında "X is not defined" ile kart düşer.
# ESLint yolu: ESLINT=… ya da /opt/lint/node_modules/.bin/eslint
# (kurulum: mkdir -p /opt/lint && cd /opt/lint && npm init -y && npm i eslint@8.57.0)
set -u
D=$(cd "$(dirname "$0")/../.." && pwd)
E=${ESLINT:-/opt/lint/node_modules/.bin/eslint}
if [ ! -x "$E" ]; then echo "ATLANDI: eslint yok ($E)"; exit 0; fi
C=$(mktemp)
printf '%s' '{"root":true,"env":{"browser":true,"es2017":true},"parserOptions":{"ecmaVersion":2020,"sourceType":"script"},"rules":{"no-undef":"error"}}' > "$C"
"$E" --no-eslintrc -c "$C" "$D/whm/assets/ag.js"; r=$?
rm -f "$C"
[ $r -eq 0 ] && echo "GEÇTİ: ag.js tanımsız ad yok" || echo "DÜŞTÜ: ag.js tanımsız ad"
exit $r
