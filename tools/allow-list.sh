#!/bin/bash
# CSF'in izin listesi — kiralık liste (cloud-ban.sh) ve ban koruması (ban-guard.sh) için ortak tanım. İkisinin kuralı da
# mangle PREROUTING'te, CSF'in izin zincirinden ÖNCE çalışır; CSF'in içeri aldığı adres orada da geçmeli.
#
#   F ADRES                 bütün portlara izin (csf.allow düz satırı, GLOBAL_ALLOW, DYNDNS, portsuz geçici izin, izinli servisler)
#   P tcp|udp ADRES PORT    yalnız o porta izin (gelişmiş satır tcp|in|d=22|s=…, portlu geçici izin); PORT "a:b" aralık
#                           ya da "all" (gelişmiş satırda d= yoksa o protokolün bütün portları)
#
# Kaynaklar CSF'in yüklediklerinin aynısı (csf.pl, CSF 16.33): csf.allow ve Include ettikleri (5 düzey), csf.gallow,
# csf.tempdyn, csf.tempgdyn, süresi dolmamış csf.tempallow satırları; ayrıca eklentinin izinli servis dosyası.
# Dışarı giden (out) ve kullanıcıya bağlı (u=/g=) satırlar gelen bağlantıyı ilgilendirmez; /8'den geniş kaynak izin değil
# port kuralıdır, alınmaz. Eklentinin "exception for" satırları da burada tek portluk izindir: banlı aralığın açık bırakılan
# servisleri yalnız o portlarda geçer.
ag_allow_includes() {   # DOSYA [DERİNLİK] → dosya ve Include ettikleri
    [ -r "$1" ] || return 0
    printf '%s\n' "$1"
    [ "${2:-0}" -lt 5 ] || return 0
    local f
    while IFS= read -r f; do ag_allow_includes "$f" $(( ${2:-0} + 1 )); done < <(awk '/^[[:space:]]*Include[[:space:]]/ { print $2 }' "$1")
}
ag_allow_files() {
    printf '%s\n' "$CSF_DIR/csf_autogroup.services.allow" "$CSF_VAR/csf.gallow" "$CSF_VAR/csf.tempdyn" "$CSF_VAR/csf.tempgdyn" "$CSF_VAR/csf.tempallow"
    ag_allow_includes "$CSF_DIR/csf.allow"
}
ag_allow_entries() {
    local f fs=()
    while IFS= read -r f; do [ -r "$f" ] && fs+=("$f"); done < <(ag_allow_files)
    [ ${#fs[@]} -gt 0 ] || return 0
    awk -v now="$(date +%s)" '
        function net(a,  n, p) {
            if (a !~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/) return ""
            n = split(a, p, "/"); if (n == 2 && p[2] + 0 < 8) return ""
            return a }
        function ports(pr, a, d,  n, x, i) {
            n = split(d, x, ",")
            for (i = 1; i <= n; i++) if (x[i] ~ /^[0-9]+([_:][0-9]+)?$/) { gsub(/_/, ":", x[i]); print "P", pr, a, x[i] } }
        FILENAME ~ /csf\.tempallow$/ {          # zaman|ip|port|yön|süre|not (port: "22,53;udp"; boşsa bütün portlar)
            n = split($0, t, "|"); if (n < 5 || t[4] !~ /in/ || now - t[1] >= t[5] + 0) next
            a = net(t[2]); if (a == "") next
            if (t[3] == "") { print "F", a; next }
            m = split(t[3], q, ","); for (i = 1; i <= m; i++) { split(q[i], r, ";"); ports(r[2] == "" ? "tcp" : r[2], a, r[1]) }
            next }
        { sub(/#.*/, ""); gsub(/^[ \t]+|[ \t]+$/, ""); if ($0 == "" || $1 == "Include") next
          if (index($1, "|") == 0) { a = net($1); if (a != "") print "F", a; next }
          n = split($1, f, "|"); pr = "tcp"; dir = "in"; s = ""; d = ""; u = 0
          for (i = 1; i <= n; i++) {
              if (f[i] == "tcp" || f[i] == "udp") pr = f[i]
              else if (f[i] == "in" || f[i] == "out") dir = f[i]
              else if (f[i] ~ /^s=/) s = substr(f[i], 3)
              else if (f[i] ~ /^d=/) d = substr(f[i], 3)
              else if (f[i] ~ /^[ug]=/) u = 1 }
          if (u || dir != "in") next
          a = net(s); if (a == "") next
          if (d == "") print "P", pr, a, "all"; else ports(pr, a, d) }' "${fs[@]}" | sort -u
}
ag_port_hit() {        # PORT ("a" ya da "a:b") LİSTE ("x,y:z,…") → 0: kesişiyor
    local lo="${1%%:*}" hi="${1##*:}" x a b
    for x in ${2//,/ }; do
        x="${x//_/:}"; a="${x%%:*}"; b="${x##*:}"
        [[ "$a" =~ ^[0-9]+$ && "$b" =~ ^[0-9]+$ && "$lo" =~ ^[0-9]+$ && "$hi" =~ ^[0-9]+$ ]] || continue
        (( lo <= b && hi >= a )) && return 0
    done
    return 1
}
hits_pos() {            # mangle PREROUTING'te zincirin ekleneceği sıra: banlı blok sayacı (block-hits.sh) en başta kalır
    iptables -t mangle -S PREROUTING 2>/dev/null | grep -- '^-A PREROUTING ' | head -n 1 | grep -q -- '--match-set ag_hits src$' && echo 2 || echo 1
}
ag_allow_sum() {        # izin kaynaklarının imzası (değişince kurallar yeniden kurulur)
    local f
    while IFS= read -r f; do [ -r "$f" ] && cat "$f"; done < <(ag_allow_files) | cksum | cut -d' ' -f1
}
