#!/bin/bash
# Bir sağlayıcının (ASN) son 24 saatteki web istekleri tarayıcı mı tarama mı: sayfa / dosya (css, js, resim, yazı tipi) oranı, IP
# başına farklı adres, dakikadaki en çok istek, tarayıcı kimliği ve kaç IP paylaştığı, en çok istenen sayfalar, siteler. Salt okur:
# Apache erişim günlükleri (domlogs) ve CSF'in ASN verisi (Etkisini ölç ile aynı kaynaklar).
#   bash tools/asn-profile.sh 9009      (GEO, DIRS ortamdan değiştirilebilir)
A="${1#AS}"; A="${A#as}"; [[ "$A" =~ ^[0-9]+$ ]] || { echo "kullanım: bash tools/asn-profile.sh 9009" >&2; exit 2; }
GEO="${GEO:-/var/lib/csf/Geo/ip2asn-combined.tsv}"
[ -r "$GEO" ] || { echo "CSF'in ASN verisi yok: $GEO" >&2; exit 1; }
TMPF=$(mktemp) && TMPR=$(mktemp) || exit 1; trap 'rm -f "$TMPF" "$TMPR"' EXIT
DIRS="${DIRS:-/var/log/apache2/domlogs /usr/local/apache/domlogs /etc/apache2/logs/domlogs}"
SINCE=$(LC_ALL=C date -d '24 hours ago' +%Y%m%d%H%M%S)
find -L $DIRS -type f -mmin -1440 ! -name '*bytes_log*' ! -name '*.offset*' ! -name '*.gz' 2>/dev/null | sort -u > "$TMPF"
LC_ALL=C awk -F'\t' -v a="$A" '$3 == a && $1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { split($1, p, "."); split($2, q, ".")
    printf "%.0f %.0f\n", ((p[1]*256+p[2])*256+p[3])*256+p[4], ((q[1]*256+q[2])*256+q[3])*256+q[4] }' "$GEO" | sort -n > "$TMPR"
LC_ALL=C awk -v rf="$TMPR" -v lf="$TMPF" -v since="$SINCE" '
BEGIN { while ((getline l < rf) > 0) { split(l, x, " "); n++; LO[n] = x[1] + 0; HI[n] = x[2] + 0 }
        while ((getline l < lf) > 0) if (l != "") ARGV[ARGC++] = l
        split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", M, " "); for (i = 1; i <= 12; i++) MI[M[i]] = sprintf("%02d", i) }
function inr(ip,  p, v, a, b, c) { if (split(ip, p, ".") != 4) return 0; v = ((p[1]*256+p[2])*256+p[3])*256+p[4]; a = 1; b = n
    while (a <= b) { c = int((a + b) / 2); if (v < LO[c]) b = c - 1; else if (v > HI[c]) a = c + 1; else return 1 }; return 0 }
{ ip = $1; if (!(ip in SEEN)) SEEN[ip] = inr(ip); if (!SEEN[ip]) next
  if (!match($0, /\[[0-9][0-9]\/[A-Z][a-z][a-z]\/[0-9][0-9][0-9][0-9]:[0-9][0-9]:[0-9][0-9]:[0-9][0-9]/)) next
  s = substr($0, RSTART + 1, RLENGTH - 1); split(s, d, /[\/:]/); k = d[3] MI[d[2]] d[1] d[4] d[5] d[6]; if (k < since) next
  q = index($0, "\""); r = substr($0, q + 1); e = index(r, "\""); req = substr(r, 1, e - 1); rest = substr(r, e + 2)
  split(rest, f, " "); code = f[1]; split(req, rq, " "); path = rq[2]; ua = rest; sub(/^[^"]*"[^"]*" "/, "", ua); sub(/"[^"]*$/, "", ua)
  site = FILENAME; sub(/.*\//, "", site); sub(/-ssl_log$/, "", site)
  asset = (path ~ /\.(css|js|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|eot|ico|mp4|map)(\?|$)/)
  T++; R[ip]++; if (code ~ /^2/) { OK++; OKI[ip]++ }; if (asset) { AS++; ASI[ip]++ }
  if (!((ip, path) in PP)) { PP[ip, path] = 1; DP[ip]++ }
  mk = ip " " substr(k, 1, 12); PM[mk]++; if (PM[mk] > MX[ip]) MX[ip] = PM[mk]
  if (!((ip, site) in SS)) { SS[ip, site] = 1; NS[ip]++ }; SITE[site]++
  if (!(ip in UA)) UA[ip] = ua; if (!((ua, ip) in UI)) { UI[ua, ip] = 1; UAN[ua]++ }; UAR[ua]++
  if (!asset && code ~ /^2/) { pp = path; sub(/\?.*/, "?…", pp); PG[pp]++ }
  if (path ~ /robots\.txt|sitemap|wp-json|xmlrpc|wp-login|\.env|\.git/) SPEC[path]++ }
function top(A, k, fmt,  i, b, bk, c) { for (c = 0; c < k; c++) { b = 0; bk = ""; for (i in A) if (A[i] > b) { b = A[i]; bk = i }; if (bk == "") break; printf fmt, A[bk], bk; delete A[bk] } }
END {
  ni = 0; for (i in R) ni++
  printf "AS%s · son 24 saat: %d istek, %d IP · başarılı (2xx) %d · dosya isteği (css/js/resim/yazı tipi) %d (%%%d)\n", "'"$A"'", T, ni, OK, AS, (T ? AS * 100 / T : 0)
  # IP sınıfları: tarayıcı gibi (dosya da istiyor) / yalnız sayfa
  for (i in R) { if (ASI[i] > 0) { BR++; BRR += R[i] } else { PO++; POR += R[i] } }
  printf "  dosya da isteyen IP: %d (%d istek) · yalnız sayfa isteyen IP: %d (%d istek)\n", BR, BRR, PO, POR
  print "\nEn çok istek atan 15 IP:   istek  başarılı  dosya%  farklı adres  dk/en çok  site  tarayıcı kimliği"
  for (c = 0; c < 15; c++) { b = 0; bk = ""; for (i in R) if (R[i] > b && !(i in DONE)) { b = R[i]; bk = i }; if (bk == "") break; DONE[bk] = 1
    printf "  %-16s %6d  %8d  %5d%%  %12d  %9d  %4d  %s\n", bk, R[bk], OKI[bk], (R[bk] ? ASI[bk] * 100 / R[bk] : 0), DP[bk], MX[bk], NS[bk], substr(UA[bk], 1, 60) }
  print "\nTarayıcı kimlikleri (kaç IP · kaç istek):"; for (u in UAN) UX[u] = UAN[u]
  for (c = 0; c < 8; c++) { b = 0; bk = ""; for (u in UX) if (UX[u] > b) { b = UX[u]; bk = u }; if (bk == "") break; printf "  %4d IP · %6d istek · %s\n", UX[bk], UAR[bk], substr(bk, 1, 90); delete UX[bk] }
  print "\nEn çok başarılı sayfa istekleri (dosya değil):"; top(PG, 12, "  %6d  %s\n")
  print "\nSiteler:"; top(SITE, 8, "  %6d  %s\n")
  print "\nÖzel adresler (robots, sitemap, wp-json, xmlrpc, wp-login, .env, .git):"; top(SPEC, 8, "  %6d  %s\n")
}' /dev/null
rm -f "$TMPF" "$TMPR"
