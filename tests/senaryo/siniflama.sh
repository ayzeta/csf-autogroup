#!/bin/bash
# Saldırı türü sınıflaması: motor (AWK_CLS) ve panel (svcOfReason) aynı notlara aynı servisi vermeli.
#   bash tests/senaryo/siniflama.sh
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
wp() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
AWK_CLS=$(awk "/^AWK_CLS='/{f=1} f{print} f && /^}'\$/{exit}" "$REPO/csf_autogroup.sh" | sed "1s/^AWK_CLS='//; \$s/'\$//")
# not | beklenen servis
CASES=(
  "lfd: (mod_security) mod_security (id:2008) triggered by 1.2.3.4 (US/United States/mail.smtp.example.com): 10 in the last 3600 secs|web"
  "ModSecurity 2008: cPanel login brute force spam|web"
  "lfd: (sshd) Failed SSH login from 1.2.3.4 (DE/Germany/dns1.example.net): 5 in the last 3600 secs|ssh"
  "lfd: (smtpauth) Failed SMTP AUTH login from 1.2.3.4 (FR/France/web.example.fr): 5 in the last 3600 secs|sync"
  "lfd: (cpanel) Failed cPanel login from 1.2.3.4 (TR/Turkey/-): 5 in the last 3600 secs|cp"
  "lfd: (PERMBLOCK) 1.2.3.4 (FR/France/-) has had more than 3 temp blocks in the last 259200 secs|repeat"
  "lfd: (pop3d) Failed POP3 login from 1.2.3.4 (IN/India/http.example.in): 5 in the last 3600 secs|sync"
  "lfd: *Port Scan* detected from 1.2.3.4 (CN/China/-). 11 hits in the last 39 seconds|scan"
)
F=0
for c in "${CASES[@]}"; do
  note="${c%|*}"; want="${c##*|}"
  m=$(awk -v r="$note" "$AWK_CLS"' BEGIN { print cls(r) }')
  p=$(node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');const a=s.indexOf('function svcOfReason(r) {');const b=s.indexOf('\n  }',a);
    const f=new Function('return '+s.slice(a,b+4))(); console.log(f(process.argv[2]));" "$(wp "$REPO/whm/assets/ag.js")" "$note")
  if [ "$m" = "$want" ] && [ "$p" = "$want" ]; then echo "  ✓ $want ← ${note:0:70}"; else F=$((F + 1)); echo "  ✗ motor=$m panel=$p beklenen=$want ← ${note:0:70}"; fi
done
echo "Sınıflama: ${#CASES[@]} not, $F beklenmeyen"; [ "$F" -eq 0 ]
