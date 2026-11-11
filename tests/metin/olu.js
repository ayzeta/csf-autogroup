// Ölü metin anahtarı: ag.js sözlüğündeki (DICT) her anahtar kodda kullanılmalı. Kullanılmış sayılır:
//   - adı tırnak içinde geçiyorsa ('anahtar' ya da "anahtar") — ag.js'in sözlük dışı kodu, whm/*.php, tests/ altındaki betikler;
//   - koddaki dinamik bir önekle başlıyorsa: t('ev_' + tür) gibi ('önek_' +) ya da tek başına önek dizgisi ({ pfx: 'cm_' });
//   - koddaki bir sonekle (x + '_h') kullanılmış başka bir anahtardan türüyorsa.
// Önekler ve sonekler koddan çıkarılır, elle liste yok. Ayar açıklamaları (h_AYAR, t('h_' + k)) ayrıca: ayar ekranda alan olarak
// çiziliyorsa (field('AYAR'…), alanlara giden dizi, data-cfg="AYAR", var k = 'AYAR') kullanılmış sayılır; 1.15.92'de çizilmeyen
// sekiz ayarın açıklaması duruyordu (ikisi yanlış sınır söylüyordu).
//   node tests/metin/olu.js whm/assets/ag.js [depo kökü]
const fs = require('fs'), path = require('path');
const jsPath = process.argv[2], root = process.argv[3] || path.resolve(path.dirname(jsPath), '../..');
const src = fs.readFileSync(jsPath, 'utf8');
const i0 = src.indexOf('var DICT = {'), i1 = src.indexOf('\n  };', i0);
if (i0 < 0 || i1 < 0) { console.log('  ✗ DICT bulunamadı'); process.exit(1); }
const dict = src.slice(i0, i1);
const keys = [...new Set([...dict.matchAll(/(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*): ['[]/g)].map(m => m[1]))].filter(k => k !== 'tr' && k !== 'en');
// kod: ag.js'in sözlük dışı kısmı + php + testler (sözlük satırlarının kendisi sayılmaz)
let code = src.slice(0, i0) + src.slice(i1);
const extra = [];
function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== 'cikti' && f.name !== 'node_modules') walk(p); }
    else if (/\.(js|sh|php)$/.test(f.name) && path.resolve(p) !== path.resolve(jsPath) && f.name !== 'olu.js') extra.push(p);
  }
}
for (const d of ['whm', 'tests']) { const p = path.join(root, d); if (fs.existsSync(p)) walk(p); }
for (const p of extra) code += '\n' + fs.readFileSync(p, 'utf8');
const lit = new Set([...code.matchAll(/['"]([A-Za-z][A-Za-z0-9_]*)['"]/g)].map(m => m[1]));
// önek: '…_' + x ya da t('ön' + x) (alt çizgisiz önek yalnız t()/T() içinde: 'p' + n gibi CSS sınıfları sayılmasın)
const pre = new Set([...code.matchAll(/['"]([a-z][a-z0-9_]*_)['"]\s*\+/g), ...code.matchAll(/\b[tT]\(\s*['"]([a-z][a-z0-9_]*)['"]\s*\+/g)].map(m => m[1]));
for (const s of lit) if (/^[a-z][a-z0-9_]*_$/.test(s)) pre.add(s);
const suf = new Set([...code.matchAll(/\+\s*['"](_[a-z0-9_]+)['"]/g)].map(m => m[1]));
// çizilen ayar alanları: field('AYAR'…), data-cfg, var k = 'AYAR' ve field(k…)'ya giden dizilerin bulunduğu satırlar
const drawn = new Set();
for (const m of code.matchAll(/(?:field\(|data-cfg=\\?["']|var k = )'?([A-Z][A-Z0-9_]+)/g)) drawn.add(m[1]);
for (const l of code.split('\n')) if (/\.map\(function \(k\) \{ return field\(k/.test(l)) for (const x of l.matchAll(/'([A-Z][A-Z0-9_]+)'/g)) drawn.add(x[1]);
const used = new Set();
for (const k of keys) {
  if (/^h_[A-Z]/.test(k)) { if (lit.has(k) || drawn.has(k.slice(2))) used.add(k); continue; }
  if (lit.has(k) || [...pre].some(p => k.startsWith(p) && p !== 'h_')) used.add(k);
}
for (let ch = true; ch;) {
  ch = false;
  for (const k of keys) if (!used.has(k)) for (const s of suf) if (k.endsWith(s) && used.has(k.slice(0, -s.length))) { used.add(k); ch = true; break; }
}
// h_ öneki küçük harfli anahtarlarda da geçerli (t('h_' + k) yalnız ayarlar için; öteki h_* doğrudan adıyla kullanılır)
const dead = keys.filter(k => !used.has(k));
if (dead.length) {
  console.log(`  ✗ kullanılmayan panel metni (${dead.length}): ` + dead.join(', '));
  process.exit(1);
}
console.log(`Ölü metin: ${keys.length} sözlük anahtarının hepsi kullanılıyor (önek ${pre.size}, sonek ${suf.size})`);
