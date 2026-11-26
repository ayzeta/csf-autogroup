#!/bin/bash
# Liste indirme kitaplığı — TEK KAYNAK (1.15.134). Kiralık listeler (cloud-ban.sh) ve izinli servisler (services-allow.sh) bu
# dosyayı okur. Önce ikisinde ayrı kopyalar vardı: services-allow.sh işlevleri cloud-ban.sh'ın metninden awk ile kesip eval
# ediyordu, IPv4 ayıklayıcı iki ayrı sınırla iki kez yazılmıştı ve "liste gerçekten küçüldü" kuralı yalnız izinli serviste vardı
# (gerçekten küçülen bir kiralık liste hiç güncellenmiyor, her turda "beklenenden az" hatası veriyordu).
# Kullanan araç önce UA (ve isterse BUA: tam tarayıcı kimliği) tanımlar.

# IPv4 adres ve aralıkları; EN GENİŞ ÖNEK'ten geniş aralık ve geçersiz sekizli alınmaz (bozuk bir liste her şeyi açmasın / kapatmasın)
ipv4_list() {     # [EN GENİŞ ÖNEK, varsayılan 16] — kiralık listeler 10, izinli servisler 16 (Microsoft 365 12)
    local mn="${1:-16}"
    grep -oE '(^|[^0-9.])[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?' | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?' |
        awk -F'[./]' -v mn="$mn" '{ ok = 1; for (i = 1; i <= 4; i++) if ($i > 255) ok = 0; if (NF == 5 && ($5 < mn || $5 > 32)) ok = 0; if (ok) print }' | sort -u
}
link_re() {      # DESEN (harf, rakam, . _ ~ / : - ve * her şey) → REPLY = bağlantıyı bulan genişletilmiş düzenli ifade: https:// ile başlar, desendeki
    # metin harfi harfine aranır, * tırnak, boşluk ve köşeli ayraç dışında her şey
    local d="$1" r="" c i
    [[ "$d" =~ ^[A-Za-z0-9._~/*:-]+$ ]] || { REPLY='^$'; return 1; }
    for (( i = 0; i < ${#d}; i++ )); do c="${d:i:1}"
        case "$c" in '*') r+="[^\"'<>[:space:]]*" ;; [A-Za-z0-9]) r+="$c" ;; *) r+="[$c]" ;; esac
    done
    REPLY="https://([^\"'<>[:space:]]*)?$r"
}
page_link() {    # SAYFA DESEN → REPLY = sayfada desene uyan ilk bağlantı. Sayfadaki mutlak https adresleri ve href / src değerleri
    # okunur; göreli bağlantı ("/yol", "//alan/yol") sayfanın alanıyla tamamlanır (Cloudflare'ın ips sayfası "/ips-v4/#" yazıyor,
    # Microsoft'unki mutlak adres; ikisi de ölçüldü 2026-11-05). Kiralık listeler ve izinli servisler ortak kullanır.
    local re o pg ua="${BUA:-$UA}"
    link_re "$2" || return 1; re="$REPLY"; o=$(printf '%s' "$1" | grep -oE '^https://[^/]+')
    pg=$(curl -fsSL --max-time 30 -A "$ua" -H 'Accept: text/html,application/xhtml+xml' -H 'Accept-Language: en-US,en;q=0.9' "$1" 2>/dev/null) || return 1
    REPLY=$( { printf '%s\n' "$pg" | grep -oE 'https://[^"'\''<>[:space:]]+'
               printf '%s\n' "$pg" | grep -oE '(href|src)=["'\''][^"'\''<>[:space:]]+' | sed -E 's/^(href|src)=.//' |
                   awk -v o="$o" '/^\/\// { print "https:" $0; next } /^\// { print o $0 }'
             } | grep -oE "$re" | head -n 1)
    [[ "$REPLY" == https://* ]]
}
fetch_to() {     # DOSYA ADRES SÜRE UA → 0 = liste TAMAMEN indi (DOSYA'da); değilse FETCH_ERR sebebi, DOSYA boş. Kiralık listeler ve
    # izinli servisler ortak kullanır (services-allow.sh bu işlevi buradan alır). Önce "curl | ayrıştırıcı" boru hattıydı: curl'ün çıkış
    # kodu görülmüyordu, süre aşımında ya da bağlantı koptuğunda o ana kadar gelen parça ayrıştırılıp — önceki listenin yarısından
    # büyükse — eksik liste olarak kabul ediliyordu. Şimdi: curl sıfırdan farklı çıkarsa (HTTP hatası, süre aşımı, eksik aktarım,
    # bağlantı kopması) indirme yok sayılır; içerik JSON ise baştan sona ayrıştırılabilmeli (yarım JSON ayrıştırılamaz).
    # FETCH_CODE: durum dosyasının hata alanına giden kısa kod (panel, bildirim ve günlük sebebi buradan söyler; yalnız [a-z0-9:]).
    # HTTP kodu -w ile: -f hatasında da yazılır (ölçüldü curl 7.76: 403 → rc 22 kod 403; süre aşımı 28 / DNS 6 → kod 000)
    local f="$1" rc code
    FETCH_ERR=""; FETCH_CODE=""
    code=$(curl -fsSL --max-time "$3" -A "$4" -o "$f" -w '%{http_code}' "$2" 2>/dev/null); rc=$?
    if [ "$rc" != 0 ]; then
        code="${code//[^0-9]/}"
        case "$rc" in
            22) FETCH_ERR="HTTP ${code:-hatası}"; FETCH_CODE="http:${code:-0}" ;;
            28) FETCH_ERR="süre aşımı (${3} sn)"; FETCH_CODE="timeout:$3" ;;
            18) FETCH_ERR="eksik aktarım"; FETCH_CODE="partial" ;;
            6)  FETCH_ERR="adres çözülemedi (DNS)"; FETCH_CODE="dns" ;;
            7)  FETCH_ERR="bağlanılamadı"; FETCH_CODE="conn" ;;
            35|51|58|59|60|77|80|83|90|91) FETCH_ERR="TLS / sertifika hatası (curl $rc)"; FETCH_CODE="tls:$rc" ;;
            *)  FETCH_ERR="curl çıkış kodu $rc"; FETCH_CODE="curl:$rc" ;;
        esac
        : > "$f"; return 1
    fi
    if [ "$(head -c 4096 "$f" | tr -d ' \t\r\n' | head -c 1)" = "{" ] || [ "$(head -c 4096 "$f" | tr -d ' \t\r\n' | head -c 1)" = "[" ]; then
        perl -MJSON::PP -e 'local $/; my $s = <STDIN>; JSON::PP->new->decode($s); exit 0' < "$f" 2>/dev/null ||
            { FETCH_ERR="yarım ya da bozuk JSON"; FETCH_CODE="badjson"; : > "$f"; return 1; }
    fi
    return 0
}
# Yeni liste kabul edilsin mi: boş liste ve öncekinin yarısından küçük liste kabul edilmez (yarıda kalmış ya da bozuk indirme
# önceki iyi listeyi silmesin); ama aynı küçük sayı ÜST ÜSTE 3 KEZ gelirse kaynak gerçekten küçülmüştür, kabul edilir.
# DİZİN AD YENİ ÖNCEKİ [YAZMA: 1 = sayaç dosyasına yaz] → 0 kabul, 1 ret (FETCH_CODE boşsa sebebi "empty" / "noflt" / "shrink:Y:Ö"
# çağıran koyar). Sayaç DİZİN/AD.shrink ("sayı|kaç kez").
list_accept() {
    local d="$1" nm="$2" n="$3" prev="$4" wr="${5:-1}" shr sc sn
    shr="$d/$nm.shrink"
    if [ "$n" -gt 0 ] && [ "$prev" -gt 0 ] && [ "$n" -lt $(( prev / 2 )) ]; then
        sc=$(cut -d'|' -f2 "$shr" 2>/dev/null); sn=$(cut -d'|' -f1 "$shr" 2>/dev/null)
        if [ "$sn" = "$n" ]; then sc=$(( ${sc:-0} + 1 )); else sc=1; fi
        [ "$wr" = 1 ] && printf '%s|%s\n' "$n" "$sc" > "$shr"
        [ "$sc" -ge 3 ] && return 0
        return 1
    fi
    rm -f "$shr" 2>/dev/null
    [ "$n" -gt 0 ]
}
