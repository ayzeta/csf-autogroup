#!/bin/bash
# CSF Auto-Group — ban sızıntısı denetimi (yalnız okur, hiçbir şeyi değiştirmez).
#
# Son SAAT saatin (varsayılan 24) web günlüklerindeki her isteğe bakar: istek geldiği AN o IP hangi bandaydı?
# Ban yürürlükteyken siteye ulaşmış istekler katman katman sayılır (kalıcı/geçici tekil, blok/ağ, kısmi ban,
# sağlayıcı/ülke banı, kiralık sunucu listesi). İzinli adresler (csf.allow + Include, izinli servisler) sayılmaz:
# onların geçmesi doğrudur. Ayrıca güvenlik duvarında CSF'ten ÖNCE adres çeviren (DNAT) ya da kabul eden kuralları
# listeler (ör. Imunify360 WebShield): bunlar CSF banlarının atlanabileceği yollardır.
#
#   bash tools/ban-leak.sh [SAAT]
#
# Notlar: geçici banların zamanı lfd günlüğünden (lfd.log, lfd.log.1) okunur; sağlayıcı/ülke kümelerinin ve kiralık
# listenin ne zamandan beri yürürlükte olduğu bilinmez, şu anki içerikleriyle bütün pencere boyunca var sayılır.
# Web günlüğünde bağlantı portu yazmaz: -ssl_log dosyaları 443, diğerleri 80 sayılır.
set -u
H="${1:-24}"; [[ "$H" =~ ^[0-9]+$ ]] || H=24
CSF_DIR="${CSF_DIR:-/etc/csf}"; CSF_VAR="${CSF_VAR:-/var/lib/csf}"; LFD_LOG="${LFD_LOG:-/var/log/lfd.log}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
NOW=$(date +%s); SINCE=$(( NOW - H * 3600 )); SKEY=$(date -d "@$SINCE" +%Y%m%d%H%M%S)
# çıktı ekrana ve rapor dosyasına (uzun çıktı terminalde kaybolmasın)
OUT="${OUT:-/root/ban-leak-$(date +%Y%m%d-%H%M).txt}"; { : > "$OUT"; } 2>/dev/null || OUT="$W/rapor.txt"
exec > >(tee "$OUT") 2>&1
adim() { printf '[%3d sn] %s\n' "$SECONDS" "$*"; }
echo "Ban sızıntısı denetimi — son $H saat · rapor: $OUT"

conf() { sed -n "s/^$1 *= *\"\(.*\)\".*/\1/p" "$CSF_DIR/csf.conf" 2>/dev/null | head -n 1 | tr -d ' ' | tr '[:lower:]' '[:upper:]'; }
CCD=",$(conf CC_DENY),"; CCP=",$(conf CC_DENY_PORTS),"; CCPT=",$(conf CC_DENY_PORTS_TCP),"

# 1) izin listesi: csf.allow (+ Include) ve izinli servisler — bunlardan gelen istekler sayılmaz
adim "izin listesi okunuyor (csf.allow, izinli servisler)"
{ cat "$CSF_DIR/csf_autogroup.services.allow" 2>/dev/null
  [ -r "$CSF_DIR/csf.allow" ] && { cat "$CSF_DIR/csf.allow"; awk '/^[[:space:]]*Include[[:space:]]/ { print $2 }' "$CSF_DIR/csf.allow" | while read -r f; do [ -r "$f" ] && cat "$f"; done; }
} | sed 's/#.*//' | awk '{ a = ""; if ($1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/) a = $1
      else if (match($0, /(^|\|)s=[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?/)) { a = substr($0, RSTART, RLENGTH); sub(/.*s=/, "", a) }
      if (a == "") next; n = split(a, p, "/"); if (n == 2 && p[2] + 0 < 8) next; print a }' | sort -u |
  awk -F'[./]' '{ b = (NF == 5 ? $5 : 32); lo = (($1 * 256 + $2) * 256 + $3) * 256 + $4; printf "%.0f %.0f\n", lo, lo + 2 ^ (32 - b) - 1 }' | sort -n -k1,1 > "$W/allow"

adim "izinli aralık: $(grep -c . "$W/allow")"
adim "banlar okunuyor (csf.deny, lfd günlüğü, csf.tempban)"
# 2) zamanlı banlar: "CIDR|başlangıç|bitiş|katman|portlar"  (portlar boş = bütün portlar)
# 2a) csf.deny: tarih yorumun sonunda ("- Thu Oct  9 14:02:38 2026")
awk -v now="$NOW" '
    function de(s,  a, k, M, i, h) { split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", M, " "); k = split(s, a, /[ \t]+/)
        if (k < 4 || a[k] !~ /^[0-9][0-9][0-9][0-9]$/ || a[k - 1] !~ /^[0-9][0-9]:[0-9][0-9]:[0-9][0-9]$/) return 0
        split(a[k - 1], h, ":"); for (i = 1; i <= 12; i++) if (M[i] == a[k - 3]) return mktime(a[k] " " i " " a[k - 2] " " h[1] " " h[2] " " h[3])
        return 0 }
    /^[[:space:]]*(#|$)/ { next }
    { c = $0; sub(/[ \t]*#.*/, "", c); t = de($0); if (t <= 0) t = 1
      if (c ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/) { print c "|" t "|9999999999|tekil kalıcı ban|"; next }
      if (c ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/[0-9]+$/) {
          k = ($0 ~ /Auto-grouped|csf_autogroup/) ? (c ~ /\/16$/ ? "ağ banı (eklenti)" : "blok banı (eklenti)") : "aralık banı (elle / başka araç)"
          print c "|" t "|9999999999|" k "|"; next }
      if (c ~ /\|s=/ && c ~ /(^|\|)in(\||$)/ || c ~ /^(tcp|udp)\|in\|/) {          # gelişmiş satır: tcp|in|d=80,443|s=CIDR
          s = c; sub(/.*s=/, "", s); sub(/\|.*/, "", s); d = ""; if (match(c, /d=[0-9,_:]+/)) { d = substr(c, RSTART + 2, RLENGTH - 2) }
          if (s ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/ && c ~ /^tcp/) print s "|" t "|9999999999|kısmi ban (portlar)|" d } }' "$CSF_DIR/csf.deny" 2>/dev/null > "$W/bans"
# 2b) geçici banlar lfd günlüğünden: "*Blocked in csf* for N secs"; erken kaldırma ("temporary block removed") bitişi öne çeker
for f in "$LFD_LOG.1" "$LFD_LOG"; do [ -r "$f" ] && cat "$f"; done | awk -v now="$NOW" '
    function lt(s,  a, M, i, y, h, t) { split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", M, " "); split(s, a, /[ \t]+/); split(a[3], h, ":")
        y = strftime("%Y", now); for (i = 1; i <= 12; i++) if (M[i] == a[1]) { t = mktime(y " " i " " a[2] " " h[1] " " h[2] " " h[3]); if (t > now + 86400) t = mktime((y - 1) " " i " " a[2] " " h[1] " " h[2] " " h[3]); return t }
        return 0 }
    /\*Blocked in csf\* for [0-9]+ secs/ && match($0, /(by|from) [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+ \(/) {
        ip = substr($0, RSTART, RLENGTH - 2); sub(/^(by|from) /, "", ip); t = lt($0)
        match($0, /for [0-9]+ secs/); d = substr($0, RSTART + 4, RLENGTH - 9) + 0
        n = ++N[ip]; S[ip, n] = t; E[ip, n] = t + d; next }
    /Incoming IP [0-9.]+ temporary block removed/ { ip = $0; sub(/.*Incoming IP /, "", ip); sub(/ .*/, "", ip); t = lt($0)
        for (n = N[ip]; n >= 1; n--) if (S[ip, n] <= t) { if (E[ip, n] > t) E[ip, n] = t; break } }
    END { for (k in S) { split(k, x, SUBSEP); print x[1] "|" S[k] "|" E[k] "|tekil geçici ban (lfd)|" } }' >> "$W/bans"
# 2c) şu anki csf.tempban (eklentinin geçici blok banları dahil: aralıklar, portlu geçici banlar)
awk -F'|' '$2 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/ { k = ($2 ~ /\//) ? "geçici blok banı" : "tekil geçici ban (lfd)"; print $2 "|" $1 "|" ($1 + $5) "|" k "|" $3 }' "$CSF_VAR/csf.tempban" 2>/dev/null >> "$W/bans"

# 3) kümeler (zamansız): sağlayıcı/ülke banları (cc_*) ve kiralık sunucu listesi (ag_cloud; nomatch muaf); Imunify gri listesi (yalnız not)
# "küme lo hi" (kümeye ve başlangıca göre sıralı) + "küme|tür|portlar" tanımları; kiralık listenin nomatch girdileri ayrı küme
adim "zamanlı ban: $(grep -c . "$W/bans")"
adim "kümeler okunuyor (sağlayıcı/ülke, kiralık liste, Imunify gri listesi)"
CPT=$(sed -n 's/^tcp=//p' /var/lib/csf_autogroup/cloud/ports 2>/dev/null); [ -n "$CPT" ] || CPT="80,443"
ipset save 2>/dev/null | grep -E '^add (cc_|ag_cloud |[^ ]*graylist )' > "$W/ipset"     # yalnız gereken kümeler, bir kez
awk -v ccd="$CCD" -v ccp="$CCP" -v ccpt="$CCPT" -v cpt="$CPT" -v df="$W/setdef" '
    function out(k, c,  s, p, b, lo) { split(c, s, "/"); split(s[1], p, "."); b = (s[2] == "" ? 32 : s[2] + 0); lo = ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4]
        printf "%s %.0f %.0f\n", k, lo, lo + 2 ^ (32 - b) - 1 }
    $1 == "add" && $2 ~ /^cc_/ { c = toupper(substr($2, 4))
        if (index(ccd, "," c ",")) { if (!D[$2]++) print $2 "|sağlayıcı / ülke banı (her şey): " c "|" > df; out($2, $3) }
        else if (index(ccp, "," c ",")) { if (!D[$2]++) print $2 "|sağlayıcı / ülke banı (port listesi): " c "|" substr(ccpt, 2, length(ccpt) - 2) > df; out($2, $3) } }
    $1 == "add" && $2 == "ag_cloud" { k = ($4 == "nomatch") ? "ag_cloud_nomatch" : "ag_cloud"
        if (!D[k]++) print k "|" (k == "ag_cloud" ? "kiralık sunucu listesi" : "muaf") "|" (k == "ag_cloud" ? cpt : "") > df; out(k, $3) }' "$W/ipset" | sort -k1,1 -k2,2n > "$W/sets"
awk '$2 ~ /graylist$/ { print $3 }' "$W/ipset" > "$W/gray"
adim "küme aralığı: $(grep -c . "$W/sets") · gri listede: $(grep -c . "$W/gray")"

# 4) web günlükleri: son H saatte değişmiş dosyalar, her istek → ban anında mıydı?
DIR=""; for d in ${DOMLOGS:-} /var/log/apache2/domlogs /usr/local/apache/domlogs /etc/apache2/logs/domlogs; do [ -d "$d" ] && { DIR="$d"; break; }; done
[ -n "$DIR" ] || { echo "Web günlükleri bulunamadı (domlogs)."; exit 1; }
find -L "$DIR" -type f -mmin -$(( H * 60 )) ! -name '*bytes_log*' ! -name '*.offset*' ! -name '*.gz' 2>/dev/null | sort -u > "$W/files"
adim "web günlükleri taranıyor: $(grep -c . "$W/files") dosya, $(tr '\n' '\0' < "$W/files" | xargs -0 -r stat -L -c %s 2>/dev/null | awk '{ t += $1 } END { printf "%.0f MB", t / 1048576 }')"

awk -v since="$SINCE" -v skey="$SKEY" -v bf="$W/bans" -v sf="$W/sets" -v df="$W/setdef" -v af="$W/allow" -v gf="$W/gray" -v lf="$W/files" '
    function v4(s,  p) { split(s, p, "."); return ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4] }
    function rg(c, r,  s, b) { split(c, s, "/"); b = (s[2] == "" ? 32 : s[2] + 0); r[1] = v4(s[1]); r[2] = r[1] + 2 ^ (32 - b) - 1 }
    function inport(port, list,  n, a, i, x) { if (list == "") return 1; gsub(/_/, ":", list); n = split(list, a, ","); for (i = 1; i <= n; i++) { split(a[i], x, ":"); if (x[2] == "") x[2] = x[1]; if (port >= x[1] + 0 && port <= x[2] + 0) return 1 }; return 0 }
    function bs(k, v,  a, z, c, j) {     # küme k (sıralı, önek-en-büyük bitişli) v adresini kapsıyor mu
        a = 1; z = SN[k]; j = 0; while (a <= z) { c = int((a + z) / 2); if (SL[k, c] <= v) { j = c; a = c + 1 } else z = c - 1 }
        return j && SM[k, j] >= v }
    BEGIN {
        while ((getline l < af) > 0) { split(l, x, " "); lo = x[1] + 0; hi = x[2] + 0          # izin aralıkları (sıralı) → birleşik
            if (an && lo <= AH[an] + 1) { if (hi > AH[an]) AH[an] = hi } else { an++; AL[an] = lo; AH[an] = hi } }
        while ((getline l < bf) > 0) { split(l, x, "|"); bn++; BC[bn] = x[1]; BS[bn] = x[2] + 0; BE[bn] = x[3] + 0; BK[bn] = x[4]; BP[bn] = x[5]
            if (x[1] ~ /\//) { rg(x[1], r); BLO[bn] = r[1]; BHI[bn] = r[2]; o8 = int(r[1] / 16777216); h8 = int(r[2] / 16777216)
                for (j = o8; j <= h8; j++) OCT[j] = OCT[j] " " bn } else EXB[x[1]] = EXB[x[1]] " " bn }
        while ((getline l < sf) > 0) { split(l, x, " "); k = x[1]; n = ++SN[k]; SL[k, n] = x[2] + 0; h = x[3] + 0
            SM[k, n] = (n > 1 && SM[k, n - 1] > h) ? SM[k, n - 1] : h }
        while ((getline l < df) > 0) { split(l, x, "|"); KN[++kn] = x[1]; KK[x[1]] = x[2]; KP[x[1]] = x[3] }
        while ((getline l < gf) > 0) GRAY[l] = 1
        while ((getline l < lf) > 0) if (l != "") ARGV[ARGC++] = l
        split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", MN, " "); for (i = 1; i <= 12; i++) MI[MN[i]] = i }
    function allowed(ip,  v, a, z, c, j) { v = v4(ip); a = 1; z = an; j = 0
        while (a <= z) { c = int((a + z) / 2); if (AL[c] <= v) { j = c; a = c + 1 } else z = c - 1 }
        return j && AH[j] >= v }
    function hits(ip,  v, i, o, k, m, cc) {     # bu IP için eşleşen banlar: numara (zamanlı) ya da "s:küme" (zamansız), IP başına bir kez
        v = v4(ip); o = EXB[ip]; m = split(OCT[int(v / 16777216)], cc, " ")
        for (i = 1; i <= m; i++) { k = cc[i] + 0; if (v >= BLO[k] && v <= BHI[k]) o = o " " k }
        if (SN["ag_cloud_nomatch"] && bs("ag_cloud_nomatch", v)) NOM[ip] = 1
        for (i = 1; i <= kn; i++) { k = KN[i]; if (k == "ag_cloud_nomatch") continue; if (k == "ag_cloud" && NOM[ip]) continue; if (bs(k, v)) o = o " s:" k }
        return o }
    { if (substr($4, 1, 1) != "[") next
      split(substr($4, 2), a, /[\/:]/); tk = a[3] sprintf("%02d", MI[a[2]]) a[1] a[4] a[5] a[6]; if (tk < skey) next     # pencere dışı: hiçbir kontrol yok
      ip = $1; if (ip !~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/) next
      LINES++
      if (!(ip in AW)) AW[ip] = allowed(ip); if (AW[ip]) next
      if (!(ip in HT)) HT[ip] = hits(ip); if (HT[ip] == "") next
      ts = mktime(a[3] " " MI[a[2]] " " a[1] " " a[4] " " a[5] " " a[6])
      port = (FILENAME ~ /-ssl_log$/) ? 443 : 80
      site = FILENAME; sub(/.*\//, "", site); sub(/-ssl_log$/, "", site)
      q = index($0, "\""); rq = substr($0, q + 1); e = index(rq, "\""); rq = substr(rq, 1, e - 1); rest = substr($0, q + e + 2); split(rest, f, " ")
      nm = split(HT[ip], hh, " ")
      for (i = 1; i <= nm; i++) { h = hh[i]; if (h == "") continue
          if (h ~ /^s:/) { k = substr(h, 3); if (!inport(port, KP[k])) continue; lay = KK[k]; st = 0; det = "şu an kümede" }
          else { k = h + 0; if (ts < BS[k] + 5 || ts >= BE[k]) continue; if (!inport(port, BP[k])) continue; lay = BK[k]; st = BS[k]; det = BC[k] }
          LN[lay]++; LI[lay, ip]++; if (!((lay, ip) in LSEEN)) { LSEEN[lay, ip] = 1; LU[lay]++ }
          if (!(lay in LF) || ts < LF[lay]) LF[lay] = ts; if (ts > LL[lay]) LL[lay] = ts
          if (!((lay, ip) in EX)) EX[lay, ip] = strftime("%d.%m %H:%M:%S", ts) " " site " " f[1] " " substr(rq, 1, 60) (st ? " · ban " strftime("%d.%m %H:%M", st) : "") " · " det
          TOT++; TIP[ip] = 1
          break } }                           # bir istek tek katmanda sayılır (ilk eşleşen)
    END {
        printf "\npencere içindeki istek: %d\n\n", LINES
        if (!TOT) { print "Ban yürürlükteyken siteye ulaşan istek yok."; exit }
        nt = 0; for (i in TIP) nt++
        printf "Ban yürürlükteyken siteye ulaşan istek: %d (%d IP)\n\n", TOT, nt
        for (lay in LN) { printf "■ %s — %d istek, %d IP (ilk %s, son %s)\n", lay, LN[lay], LU[lay], strftime("%d.%m %H:%M", LF[lay]), strftime("%d.%m %H:%M", LL[lay])
            c = 0; for (k in LI) { split(k, x, SUBSEP); if (x[1] != lay) continue; T[x[2]] = LI[k] }
            while (c < 6) { b = ""; bv = 0; for (ip in T) if (T[ip] > bv) { bv = T[ip]; b = ip }; if (b == "") break
                printf "    %-15s %5d istek%s · %s\n", b, bv, (b in GRAY ? " · Imunify gri listesinde" : ""), EX[lay, b]; delete T[b]; c++ }
            for (ip in T) delete T[ip]; print "" } }'

# 5) atlatma yolları: CSF'ten (LOCALINPUT) önce adres çeviren ya da kabul eden kurallar
echo; adim "bitti"
echo "CSF'ten önce çalışan çeviri/kabul kuralları (CSF banlarını atlatabilir):"
iptables -t nat -S PREROUTING 2>/dev/null | grep -E 'DNAT|REDIRECT|-j [A-Za-z_]+' | grep -v '^-P' | sed 's/^/  nat  /'
iptables -t nat -S 2>/dev/null | grep -E -- '-j (DNAT|REDIRECT)' | grep -vE 'remote_proxy' | awk '{ print "  nat  " $0 }' | head -n 20
iptables -S INPUT 2>/dev/null | awk '/-j LOCALINPUT/ { exit } /^-A/ { print "  filter  " $0 }'
iptables -S 2>/dev/null | grep -- '-j ACCEPT' | grep -E 'INPUT_imunify360 ' | sed 's/^/  filter  /' | head -n 20
echo; echo "Rapor: $OUT"
