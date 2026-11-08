// Aralık kartının port satırı metni (portGroupLine): ag.js'yi gerçek koduyla yükler (render.js'teki DOM taklidi) ve
// --inside çıktısından gruplanan satırları denetler. calistir.sh çağırır: node portline.js <ag.js> < inport.json
// Kurallar: portlar bir kez yazılır (adı çıkmayan port "port N" diye yazıldıysa ham liste ayrıca parantezde yinelenmez);
// her port bir servis adına girdiyse ham liste parantezde; lfd yorumunda IP ve ülke kalkar, tarih gün olarak.
const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const tail = src.lastIndexOf('})();');
src = src.slice(0, tail) + 'globalThis.__AG = { set: function (s, l) { S = s; LANG = l || \'tr\'; }, portGroups: portGroups, portGroupLine: portGroupLine, portCovGroups: portCovGroups, portWhy: portWhy, verdict: verdict };\n' + src.slice(tail);
const el = () => new Proxy(function () {}, { get: (t, k) => k === 'length' ? 0 : k === Symbol.toPrimitive ? () => '' : el(), apply: () => el(), set: () => true });
globalThis.window = { AG_BOOT: {}, addEventListener() {}, location: { search: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.document = { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, createElement: el, body: el(), documentElement: el(), hidden: true };
globalThis.location = window.location; globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.navigator = { language: 'tr' };
globalThis.fetch = () => new Promise(() => {});
globalThis.setInterval = () => 0; globalThis.setTimeout = () => 0;
try { new Function(src)(); } catch (e) { console.error('yükleme hatası:', e.message); process.exit(1); }
const AG = globalThis.__AG; AG.set({}, 'tr');
const d = JSON.parse(fs.readFileSync(0, 'utf8'));
if (process.argv[3] === 'ip') {   // IP kartı (--lookup): port satırları adres + yön başına bir grup; sonuç kutusunda adres bir kez
  const strip = h => h.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const pc = (d.covers || []).filter(c => c.kind === 'port' && !c.own);
  const G = AG.portCovGroups(d.covers), v = strip(AG.verdict(d, 99)), bad = [];
  if (pc.length < 2) bad.push('test verisi: adresin en az iki port satırı beklenirdi (' + pc.length + ')');
  if (G.length !== 1) bad.push('grup sayısı ' + G.length + ' (beklenen 1)');
  else {
    if (!/^Gelen posta, port 465(, 587)?$/.test(G[0].name)) bad.push('grup adı: ' + G[0].name);
    if (G[0].lines.length !== pc.length) bad.push('ham satır sayısı ' + G[0].lines.length + ' / ' + pc.length);
    const w = AG.portWhy(G[0].cm); if (w.why !== 'lfd: AUTHRELAY limit exceeded' || w.dt !== '26 Haz 2026') bad.push('sebep/tarih: ' + JSON.stringify(w));
  }
  const n = (v.match(/151\.80\.7\.44/g) || []).length;
  if (n !== 1) bad.push('sonuç kutusunda adres ' + n + ' kez: ' + v);
  if (bad.length) { console.error(bad.join('\n') + '\n' + JSON.stringify(d.covers)); process.exit(1); }
  process.exit(0);
}
const txt = AG.portGroups(d).map(g => AG.portGroupLine(g).replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
const bad = [];
const a = txt.find(s => s.startsWith('151.80.7.44 ')), b = txt.find(s => s.startsWith('151.80.7.45 '));
// sunucudaki AUTHRELAY biçimi: 25 Gelen posta, 465/587 E-posta istemcisinin bir kısmı (bütün portları yok) → "port 465, 587"
if (!a || !/^151\.80\.7\.44 · Gelen posta, port 465(, 587)? · lfd: AUTHRELAY limit exceeded · 26 Haz 2026$/.test(a)) bad.push('AUTHRELAY satırı: ' + a);
if (a && /\(25, 465/.test(a)) bad.push('ham liste yinelendi: ' + a);
if (!b || !/^151\.80\.7\.45 · SSH \(22\) · elle "ofis" \\ deneme$/.test(b)) bad.push('SSH satırı (her port adlı → parantezde ham liste): ' + b);
if (bad.length) { console.error(bad.join('\n') + '\n' + JSON.stringify(txt)); process.exit(1); }
