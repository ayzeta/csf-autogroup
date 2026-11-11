// Durum × ekran tablosu: ag.js'yi gerçek koduyla yükler (DOM taklidiyle), her senaryonun motor çıktısını
// verir, her ekranın o öğe için sunduğu eylemleri toplar ve kurallara göre denetler.
// calistir.sh çağırır: node render.js <ag.js> <motor çıktıları dizini> [-q]
const fs = require('fs'), path = require('path');
const [, , AGJS, OUT, OPT] = process.argv, QUIET = OPT === '-q';
let src = fs.readFileSync(AGJS, 'utf8');

// test kancaları yalnız bu kopyada: menü öğelerini topla, iç işlevleri dışarı ver
src = src.replace(/function menu\(key, items\) \{/, m => m + ' if (globalThis.__MENU) globalThis.__MENU(key, items);');
const tail = src.lastIndexOf('})();');
src = src.slice(0, tail) + `globalThis.__AG = { set: function (s, l) { S = s; LANG = l || 'tr'; }, review: review, groupRows: groupRows,
  pending: pending, itemState: itemState, itemMenu: itemMenu, drActs: drActs, coverBits: coverBits, UI: UI };\n` + src.slice(tail);

const el = () => new Proxy(function () {}, { get: (t, k) => k === 'length' ? 0 : k === Symbol.toPrimitive ? () => '' : el(), apply: () => el(), set: () => true });
globalThis.window = { AG_BOOT: {}, addEventListener() {}, location: { search: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.document = { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, createElement: el, body: el(), documentElement: el(), hidden: true };
globalThis.location = window.location; globalThis.addEventListener = () => {};
globalThis.localStorage ={ getItem: () => null, setItem() {}, removeItem() {} };
globalThis.navigator = { language: 'tr' };
globalThis.fetch = () => new Promise(() => {});
globalThis.setInterval = () => 0; globalThis.setTimeout = () => 0;
try { new Function(src)(); } catch (e) { console.error('yükleme hatası:', e.message); process.exit(1); }
const AG = globalThis.__AG;
if (!AG) { console.error('ag.js dışa veremedi'); process.exit(1); }

const IP = '151.80.7.9', BLK = '151.80.7.0/24', NET = '151.80.0.0/16', IN = c => String(c).startsWith('151.80');
const BAN = /^(ban16|ban24|banforce|promote)$/;
const scen = fs.readdirSync(OUT).filter(f => f.endsWith('.status.json')).map(f => f.replace('.status.json', ''));
const order = ['none', 'single', 'temp', 'watched', 'b24auto', 'b24full', 'b24part', 'b16full', 'b16part', 'b16p_b24f', 'b16f_other', 'cc', 'wl', 'review16', 'partopen'];
scen.sort((a, b) => order.indexOf(a) - order.indexOf(b));

const strip = h => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
function htmlActs(html) {   // düğme ve menü öğeleri: [act, hedef, etiket]
  const r = [], re = /<button[^>]*data-(?:act|dr)="([^"]+)"([^>]*)>([\s\S]*?)<\/button>/g; let m;
  while ((m = re.exec(html))) { const t = (/data-t="([^"]*)"/.exec(m[2]) || [])[1] || ''; r.push([m[1], t, strip(m[3])]); }
  return r;
}
let fails = 0; const lines = [];
function fail(s, msg) { fails++; lines.push('  ✗ ' + s + ': ' + msg); }

for (const s of scen) {
  const st = JSON.parse(fs.readFileSync(path.join(OUT, s + '.status.json'), 'utf8'));
  const lk = JSON.parse(fs.readFileSync(path.join(OUT, s + '.lookup.json'), 'utf8'));
  AG.set(st, 'tr');
  const menus = {}; globalThis.__MENU = (k, items) => { menus[k] = items; };
  const scr = {};
  // IP kartı
  const mb = AG.coverBits(lk);
  // kartın verisiyle (kendi banı varsa "Banı kaldır"); tek IP düğmelerinin hedefi IP'nin kendisi
  scr['IP kartı ' + IP] = htmlActs(AG.drActs(IP, mb, lk.pfx, '', lk)).map(a => [a[0], a[0] === 'ban16' ? NET : /^(un)?ban1$/.test(a[0]) ? IP : BLK, a[2]]);
  // Dikkat edilecekler
  const rv = AG.review();
  rv.split('<div class="ag-item"').slice(1).forEach(row => {
    const c = (/data-row="([^"]+)"/.exec(row) || [])[1];
    if (IN(c)) scr['Dikkat ' + c] = htmlActs(row).filter(a => a[0] !== 'toggle');
  });
  // Aktif blok banları, İzlenenler (menüler kancadan)
  AG.groupRows(); AG.pending();
  Object.keys(menus).forEach(k => {
    const c = k.slice(3);
    if (!IN(c)) return;
    const name = (k.startsWith('gm:') ? 'Blok banları ' : k.startsWith('pm:') ? 'İzlenenler ' : 'Dikkat menü ') + c;
    scr[name] = menus[k].filter(i => !/toggle|ipcard/.test(i.act)).map(i => [i.act, (/data-[tc]="([^"]*)"/.exec(i.attrs || '') || [])[1] || '', i.label]);
  });
  // Geçmiş menüsü (öğenin şu anki durumuna göre)
  for (const c of [IP, BLK, NET]) {
    const ist = AG.itemState(c);
    scr['Geçmiş ' + c] = AG.itemMenu(c, { type: c === NET ? 'warn16' : c === BLK ? 'add24' : 'manual_ban', ips: [] }, ist)
      .filter(i => !/goto|ipcard/.test(i.act)).map(i => [i.act, (/data-[tc]="([^"]*)"/.exec(i.attrs || '') || [])[1] || '', i.label]);
  }

  lines.push('\n## ' + s + '   (IP kartı kapsama: ' + (mb === 99 ? 'yok' : mb === 0 ? 'ülke/ASN' : '/' + mb) +
    (lk.covers || []).filter(c => c.kind === 'port').map(c => ', kısmi ' + c.cidr).join('') + (lk.temp ? ', geçici' : '') + (lk.deny ? ', tekil' : '') + ')');
  Object.keys(scr).forEach(k => lines.push('  ' + k.padEnd(34) + (scr[k].map(a => a[2] + ' [' + a[0] + ']').join(' · ') || '—')));

  // ── kurallar ──
  const all = Object.entries(scr);
  const bans = all.flatMap(([k, a]) => a.filter(x => BAN.test(x[0])).map(x => [k, x]));
  // K1: IP'yi tamamen kapsayan /16 ya da daha geniş ban varken hiçbir ekran bu ağ içinde ban önermez
  if (mb <= 16) bans.forEach(([k, x]) => fail(s, `${k}: "${x[2]}" — ağ zaten tamamen kapalı (/${mb})`));
  // K2: blok tamamen banlıyken (kendi banı ya da geniş tam ban) blok için ban önerilmez
  if (mb <= 24) bans.filter(([k, x]) => x[0] === 'ban24' || x[0] === 'promote').forEach(([k, x]) => fail(s, `${k}: "${x[2]}" — blok zaten tamamen kapalı`));
  // K3: aynı aralığın kısmi banı varken düğme "Banı değiştir" demeli
  (lk.covers || []).filter(c => c.kind === 'port' && c.own).forEach(c => {
    const want = c.cidr.endsWith('/16') ? 'ban16' : 'ban24';
    bans.filter(([k, x]) => x[0] === want).forEach(([k, x]) => { if (!/değiştir/i.test(x[2])) fail(s, `${k}: "${x[2]}" — ${c.cidr} kısmi banlı, etiket değiştirmeyi söylemeli`); });
  });
  // K5: kısmi banı yetmeyen aralık (part_open) satırının eylemi her ekranda "Banı değiştir": Geçmiş menüsü de Kontrol edilecekler
  // satırı gibi (1.15.71'e kadar Geçmiş "Yine de banla" sunuyordu)
  if ((st.review || []).some(r => r.cidr === BLK && r.type === 'part_open')) {
    const g = scr['Geçmiş ' + BLK] || [];
    if (g.some(x => x[0] === 'banforce') || !g.some(x => x[0] === 'chg')) fail(s, `Geçmiş ${BLK}: açık servis satırında "Banı değiştir" yok ya da "Yine de banla" var (${g.map(x => x[2]).join(' · ')})`);
  }
  // K4: IP kartı ile Geçmiş'teki aynı IP aynı ban eylemlerini sunar (Geçmiş bir şey sunuyorsa)
  const ka = scr['IP kartı ' + IP].filter(x => BAN.test(x[0])).map(x => x[0]).sort().join(','),
        ha = scr['Geçmiş ' + IP].filter(x => BAN.test(x[0])).map(x => x[0]).sort().join(',');
  if (ka !== ha) fail(s, `IP kartı [${ka || '—'}] ile Geçmiş [${ha || '—'}] farklı ban eylemleri sunuyor (${IP})`);
  // K7: bir liste satırının ⋯ menüsü ile Geçmiş'in aynı öğe için menüsü aynı eylemleri sunar (tek kaynak: acts*). Öğe birden çok
  // listedeyse Geçmiş en önce gelenin eylemlerini sunar (Kontrol edilecekler → aralık banı → izlenen); yalnız o liste karşılaştırılır.
  // Önce Geçmiş şüpheli aralık satırına "Yine de banla" (ilk /24), duyurulan aralık önerisi yoktu; "Kalıcı yap" ayrı koşuldaydı
  const act2 = a => a.map(i => i.act + '|' + ((/data-[tc]="([^"]*)"/.exec(i.attrs || '') || [])[1] || '')).filter(x => !/^(toggle|ipcard|goto)\|/.test(x)).sort().join(', ');
  Object.keys(menus).forEach(k => {
    const kind = k.slice(0, 3), c = kind === 'pm:' ? k.slice(3) + '.0/24' : k.slice(3);
    if (!/^(rm|gm|pm):$/.test(kind) || !IN(c)) return;
    const ist = AG.itemState(c);
    if (!ist || (kind !== 'rm:' && ist.r) || (kind === 'pm:' && ist.g)) return;
    const h = act2(AG.itemMenu(c, { type: 'x', ips: [] }, ist)), l = act2(menus[k]);
    if (h !== l) fail(s, `${c}: liste menüsü [${l || '—'}] ile Geçmiş menüsü [${h || '—'}] farklı`);
  });
  // K6: sunulan ban, motorun banla penceresinde "zaten banlı" diye reddediliyorsa düğme çıkmaza götürür
  const inn = {};
  for (const [k, f] of [['ban24', 'in24'], ['ban16', 'in16']]) {
    try { inn[k] = JSON.parse(fs.readFileSync(path.join(OUT, s + '.' + f + '.json'), 'utf8')); } catch (e) { inn[k] = null; }
  }
  bans.forEach(([k, x]) => {
    const d = inn[x[0]];
    if (d && d.ok && d.cover && !d.own_full) fail(s, `${k}: "${x[2]}" — pencere reddeder (zaten banlı: ${d.cover})`);
  });
  lines.push('  ' + 'Banla penceresi'.padEnd(34) + ['ban24', 'ban16'].map(k => k + ': ' + (!inn[k] ? '?' : inn[k].cover ? 'zaten banlı ' + inn[k].cover + (inn[k].own_full ? ' (kendi, değiştirilebilir)' : '') : 'açılır')).join(' · '));
  // K5: aynı hedef için ekranlar arasında farklı etiket olmamalı
  const lab = {};
  bans.forEach(([k, x]) => { const key = x[0] + '|' + x[1]; (lab[key] = lab[key] || new Set()).add(x[2]); });
  Object.entries(lab).forEach(([key, set]) => { if (set.size > 1 && !key.startsWith('banforce')) fail(s, `${key}: farklı etiketler ${[...set].join(' / ')}`); });
}
// K8: üst seviye banları (blok, duyurulan aralık, ağ) IP kartında ve liste menülerinde aynı karardan (lvOffer). Satırın menüsü, IP
// kartının sunduğu seviyelerden satırın kendisinden geniş olanları sunar. Duyurulan aralık /20 olarak hem IP sorgusuna hem motorun sahip
// haritasına eklenir (taklit DNS /16 veriyor; /20 olmadan kural aralığı görmezdi). Önce menüde duyurulan aralık hiç yoktu (1.15.89'a kadar)
const PFX = '151.80.0.0/20';
for (const s of scen) {
  const st = JSON.parse(fs.readFileSync(path.join(OUT, s + '.status.json'), 'utf8'));
  const lk = JSON.parse(fs.readFileSync(path.join(OUT, s + '.lookup.json'), 'utf8'));
  lk.pfx = PFX; st.owners = st.owners && !Array.isArray(st.owners) ? st.owners : {};
  Object.keys(st.owners).forEach(k => { if (IN(k) && Array.isArray(st.owners[k])) st.owners[k][3] = PFX; });
  if (!st.owners['151.80.7']) st.owners['151.80.7'] = ['16276', 'FR', 'OVH, FR', PFX];
  AG.set(st, 'tr');
  const menus = {}; globalThis.__MENU = (k, items) => { menus[k] = items; };
  AG.review(); AG.groupRows(); AG.pending();
  const card = htmlActs(AG.drActs(IP, AG.coverBits(lk), lk.pfx, '', lk)).filter(a => /^ban(24|16|pfx)$/.test(a[0]))
    .map(a => ({ k: a[0], b: a[0] === 'ban24' ? 24 : a[0] === 'ban16' ? 16 : 20 }));
  Object.keys(menus).forEach(k => {
    const kind = k.slice(0, 3), c = kind === 'pm:' ? k.slice(3) + '.0/24' : k.slice(3);
    if (!/^(gm|pm):$/.test(kind) || !IN(c) || !(c === IP + '/32' || c === IP || c === BLK)) return;
    const cb = c === BLK ? 24 : 32;
    const want = card.filter(x => x.b < cb).map(x => x.k).sort().join(','), got = menus[k].map(i => i.act).filter(a => /^ban(24|16|pfx)$/.test(a)).sort().join(',');
    if (want !== got) fail(s, `K8 ${c}: liste menüsü [${got || '—'}] ≠ IP kartının üst seviyeleri [${want || '—'}] (duyurulan aralık ${PFX})`);
  });
}
console.log((QUIET ? lines.filter(l => l.startsWith('  ✗')) : lines).join('\n'));
console.log('\n' + (fails ? fails + ' kural ihlali' : 'Bütün kurallar geçti'));
process.exit(fails ? 1 : 0);
