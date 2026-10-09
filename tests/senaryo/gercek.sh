#!/bin/bash
# Senaryo matrisini gerçek CSF/lfd ile çalıştırır: depoyu test sanal makinesine (WSL2, AlmaLinux, CSF kurulu) kopyalar ve
# orada GERCEK=1 ile tests/senaryo/calistir.sh'i root olarak çalıştırır. Yalnız geliştirme makinesinde; sunucuya dokunmaz.
#
#   bash tests/senaryo/gercek.sh                 (dağıtım adı: WSL_DISTRO, varsayılan AlmaLinux-9)
#
# Sanal makinenin CSF dosyaları (csf.deny, csf.allow, csf.conf…) test başında yedeklenir, her senaryoda ve sonda geri konur.
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
DIST="${WSL_DISTRO:-AlmaLinux-9}"
command -v wsl.exe >/dev/null 2>&1 || { echo "wsl.exe yok (yalnız Windows geliştirme makinesinde)"; exit 2; }
STAGE="$(cygpath -u "$USERPROFILE" 2>/dev/null || echo "$HOME")/csfag-senaryo.tgz"
tar czf "$STAGE" -C "$REPO" --exclude=.git --exclude=csf-kopya.tgz csf_autogroup.sh tools tests || exit 2
WIN="$(cygpath -w "$STAGE")"; LIN="/mnt/$(printf '%s' "${WIN:0:1}" | tr '[:upper:]' '[:lower:]')$(printf '%s' "${WIN:2}" | tr '\\' '/')"
MSYS_NO_PATHCONV=1 wsl.exe -d "$DIST" -u root --cd / -- bash -c "rm -rf /root/csfag-senaryo && mkdir -p /root/csfag-senaryo && tar xzf '$LIN' -C /root/csfag-senaryo && GERCEK=1 bash /root/csfag-senaryo/tests/senaryo/calistir.sh"
