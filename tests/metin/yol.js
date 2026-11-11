// Ayar yolu: metinlerdeki "Ayarlar → Bölüm → Grup" / "Settings → Section → Group" zincirleri ayar ekranında gerçekten var mı.
// Bölüm adları settingsSections()'ın label'larından, alt adlar kart başlıklarından (gc('ikon', 'g_…')) ve alan etiketlerinden
// (k_*, st_*) okunur; elle liste yok. 1.15.92'de mail "Ayarlar → Saklama" ve "Ayarlar → Zamanlama" diyordu (ikisi de yoktu).
//   node tests/metin/yol.js whm/assets/ag.js csf_autogroup.sh
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8'), sh = fs.readFileSync(process.argv[3], 'utf8');
const enAt = src.indexOf('\n    en: {'), dEnd = src.indexOf('\n  };', enAt);
const re = /(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*): '((?:[^'\\]|\\.)*)'/g;
function dict(seg) { const o = {}; let m; re.lastIndex = 0; while ((m = re.exec(seg))) if (!(m[1] in o)) o[m[1]] = m[2].replace(/\\'/g, "'"); return o; }
const D = { tr: dict(src.slice(src.indexOf('var DICT = {'), enAt)), en: dict(src.slice(enAt, dEnd)) };
const fn = src.slice(src.indexOf('function settingsSections()'), src.indexOf('function settingsSections()') + 2000);
const secKeys = [...fn.matchAll(/label: t\('([a-z_]+)'\)/g)].map(m => m[1]);
const grpKeys = [...new Set([...src.matchAll(/gc\('[a-z]+', '([a-z_]+)'/g)].map(m => m[1]))];
let bad = 0;
const texts = [];
for (const L of ['tr', 'en']) for (const [k, v] of Object.entries(D[L])) texts.push([L, 'ag.js ' + k, v]);
const tm = /var TERMS = (\{ tr: .*\});/.exec(src);
if (tm) { const T = Function('return ' + tm[1])(); for (const L of ['tr', 'en']) for (const x of T[L]) texts.push([L, 'Terimler ' + x[0], x[1]]); }
// motor metinleri: önce TR bloğu, sonra EN (MSG_LANG'e göre iki blok); EN bloğu ilk M_ tekrarından sonra başlar
const seen = new Set(); let lang = 'tr';
for (const m of sh.matchAll(/(M_[A-Z0-9_]+)="((?:[^"\\]|\\.)*)"/g)) { if (seen.has(m[1]) && lang === 'tr') { lang = 'en'; seen.clear(); } seen.add(m[1]); texts.push([lang, m[1], m[2]]); }
for (const [L, where, v] of texts) {
  const head = L === 'tr' ? 'Ayarlar' : 'Settings';
  const secs = secKeys.map(k => D[L][k]).filter(Boolean);
  const subs = new Set([...secs, ...grpKeys.map(k => D[L][k]).filter(Boolean),
    ...Object.entries(D[L]).filter(([k]) => /^(k_|st_)/.test(k)).map(([, x]) => x)]);
  for (const m of v.matchAll(new RegExp(head + '((?: → [^→()\'".,;:]+)+)', 'g'))) {
    const parts = m[1].split(' → ').slice(1).map(x => x.trim());
    // ilk parça bir bölüm adıyla başlamalı, sonrakiler bölüm / kart / alan adıyla
    const ok = parts.every((p, i) => (i === 0 ? secs : [...subs]).some(s => p === s || p.startsWith(s + ' ')));
    if (!ok) { bad++; console.log(`  ✗ ${L} ${where}: «${head}${m[1]}» ayar ekranında yok`); }
  }
}
if (bad) { console.log(`Ayar yolları: ${bad} yol ayar ekranında yok`); process.exit(1); }
console.log('Ayar yolları: metinlerdeki her "Ayarlar → …" yolu ayar ekranında var');
