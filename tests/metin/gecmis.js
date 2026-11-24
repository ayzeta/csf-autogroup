// Ayar geçmişi ham anahtar göstermez: motorun "ev config" ile yazdığı her sabit anahtarın ("key":"X") panelde adı olmalı (cfgLabel:
// eşleme, k_X ya da old_X metni, ya da CSF_BLOCKLIST: gibi önek kuralı). 1.15.114'te ABUSEIPDB_KEY ham adıyla görünüyordu.
//   node tests/metin/gecmis.js whm/assets/ag.js csf_autogroup.sh
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8'), sh = fs.readFileSync(process.argv[3], 'utf8');
const keys = new Set();
for (const m of sh.matchAll(/\\"key\\":\\"([A-Z][A-Z0-9_]*)(:?)/g)) keys.add(m[1] + m[2]);
const lab = src.slice(src.indexOf('function cfgLabel('), src.indexOf('function cfgShow('));
let bad = 0;
for (const k of keys) {
  const pre = k.endsWith(':');
  const ok = pre ? lab.includes("/^" + k + "/") : (new RegExp('[{ ,]' + k + ': ').test(lab) || new RegExp('(?<![A-Za-z0-9_])(k|old)_' + k + ": '").test(src));
  if (!ok) { bad++; console.log(`  ✗ ${k}: ayar geçmişinde ham adla görünür (cfgLabel'de karşılığı yok)`); }
}
console.log(bad ? `gecmis: ${bad} anahtar` : `gecmis: ayar geçmişinin ${keys.size} sabit anahtarının adı var`);
process.exit(bad ? 1 : 0);
