// Sözlük kapsamı: panelde rozet olarak görünen her durum etiketinin Terimler sözlüğünde (TERMS) bir maddesi olmalı.
// Etiket, madde adında geçiyorsa (büyük/küçük harf duyarsız; "Kalıcı / geçici" gibi birleşik maddeler dahil) kapsanmış sayılır.
// Yeni bir durum rozeti eklendiğinde anahtarı ETIKET listesine ekleyin.
//   node tests/metin/sozluk.js whm/assets/ag.js
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const ETIKET = ['ab_b', 'ab_i', 'ab_y', 'ab_s', 'ab_g', 'po', 'ev_warn16', 'ev_skip_wl', 'kind_perm', 'kind_temp', 'kind_promoted',
  'kind_manual', 'kind_partial', 'dnd_s', 'f_old'];
const enAt = src.indexOf('\n    en: {');
function val(seg, k) {
  const m = new RegExp('(?<![A-Za-z0-9_])' + k + ": '((?:[^'\\\\]|\\\\.)*)'").exec(seg);
  return m ? m[1].replace(/\\'/g, "'") : null;
}
const tm = /var TERMS = (\{ tr: .*\});/.exec(src);
if (!tm) { console.log('  ✗ TERMS bulunamadı'); process.exit(1); }
const TERMS = Function('return ' + tm[1])();
let bad = 0;
for (const [lang, seg] of [['tr', src.slice(0, enAt)], ['en', src.slice(enAt)]]) {
  const terms = TERMS[lang].filter(x => x[0] !== '§').map(x => x[0].toLowerCase());
  for (const k of ETIKET) {
    const v = val(seg, k);
    if (v == null) { console.log(`  ✗ ${lang}: ${k} sözlükte yok (ag.js metni)`); bad++; continue; }
    const l = v.toLowerCase().replace(/ · .*$/, '');
    if (!terms.some(t => t.includes(l))) { console.log(`  ✗ ${lang}: «${v}» (${k}) Terimler sözlüğünde açıklanmıyor`); bad++; }
  }
}
if (bad) { console.log(`Sözlük kapsamı: ${bad} durum etiketi açıklamasız`); process.exit(1); }
console.log(`Sözlük kapsamı: ${ETIKET.length} durum etiketinin hepsi Terimler'de (tr + en)`);
