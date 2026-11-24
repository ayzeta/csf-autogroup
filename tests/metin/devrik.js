// Türkçe cümle yüklemle biter: "… X olursa daha önce.", "… bağlantılar için." gibi yüklemsiz biten cümle yasak (kullanıcı 2026-11-24:
// "En geç 25 Kas tarihinde listeden kendiliğinden düşer; … daha önce." okunmuyordu). Panel sözlüğünün TR değerleri ve motorun TR M_*
// metinleri taranır; her cümlenin son sözcüğüne bakılır (4 sözcükten kısa etiketler — "Her şey, şunlar hariç" — taranmaz).
//   node tests/metin/devrik.js whm/assets/ag.js csf_autogroup.sh
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8'), sh = fs.readFileSync(process.argv[3], 'utf8');
const enAt = src.indexOf('\n    en: {');
const re = /(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*): '((?:[^'\\]|\\.)*)'/g;
const T = [];
let m; const seg = src.slice(src.indexOf('var DICT = {'), enAt);
while ((m = re.exec(seg))) T.push([m[1], m[2]]);
const b0 = sh.indexOf('if [ "$MSG_LANG" = "tr" ]; then'), b1 = sh.indexOf('\nelse\n', b0);
for (const x of sh.slice(b0, b1).matchAll(/(M_[A-Z0-9_]+)="((?:[^"\\]|\\.)*)"/g)) T.push([x[1], x[2]]);
// yüklemsiz son sözcükler: zaman / koşul / amaç bağlaçları ve edatlar ("değil", "dahil" yüklem olabilir: taranmaz)
const SON = /(?:^|\s)(daha önce|daha erken|daha geç|önce|için|ile|gibi|ise|yoksa)$/;
let bad = 0;
for (const [k, v] of T) {
  for (const c of v.replace(/\\n/g, ' ').split(/(?<=[.!?])\s+/)) {
    const c2 = c.trim().replace(/[.!?…:;]+$/, '').replace(/\)+$/, '').trim();
    if (c2.split(/\s+/).length >= 4 && SON.test(c2)) { bad++; console.log(`  ✗ ${k}: yüklemsiz biten cümle → ${c.trim()}`); }
  }
}
console.log(bad ? `devrik: ${bad} cümle` : 'devrik: yüklemsiz biten Türkçe cümle yok');
process.exit(bad ? 1 : 0);
