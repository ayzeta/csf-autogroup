// K7 bütün köklerde: her liste satırının ⋯ menüsü (Kontrol edilecekler, Aktif aralık banları, İzlenenler) ile Geçmiş'in aynı öğe
// için menüsü (itemMenu) aynı eylemleri sunar. Veri motorun gerçek durum çıktısı (durum tablosunun bütün senaryo kökleri): şüpheli
// aralık, duyurulan aralık önerisi, izinli servis kaydı, izinli / sunucu IP'si ihlali, kısmi banı yetmeyen aralık.
// Önce Geçmiş şüpheli aralık satırına "Yine de banla" (ilk /24) veriyordu, liste "Duyurulan aralığı banla" (1.15.84'te tek kaynak).
// calistir.sh çağırır: node menu-esit.js <ag.js> <durum json dizini>
const fs = require('fs'), path = require('path');
const [, , AGJS, DIR] = process.argv;
let src = fs.readFileSync(AGJS, 'utf8');
src = src.replace(/function menu\(key, items\) \{/, m => m + ' if (globalThis.__MENU) globalThis.__MENU(key, items);');
const tail = src.lastIndexOf('})();');
src = src.slice(0, tail) + `globalThis.__AG = { set: function (s, l) { S = s; LANG = l || 'tr'; }, review: review, groupRows: groupRows,
  pending: pending, itemState: itemState, itemMenu: itemMenu, UI: UI };\n` + src.slice(tail);
const el = () => new Proxy(function () {}, { get: (t, k) => k === 'length' ? 0 : k === Symbol.toPrimitive ? () => '' : el(), apply: () => el(), set: () => true });
globalThis.window = { AG_BOOT: {}, addEventListener() {}, location: { search: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.document = { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, createElement: el, body: el(), documentElement: el(), hidden: true };
globalThis.location = window.location; globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.navigator = { language: 'tr' };
globalThis.fetch = () => new Promise(() => {});
globalThis.setInterval = () => 0; globalThis.setTimeout = () => 0;
try { new Function(src)(); } catch (e) { console.error('yükleme hatası:', e.message); process.exit(1); }
const AG = globalThis.__AG;
const act2 = a => a.map(i => i.act + '|' + ((/data-[tc]="([^"]*)"/.exec(i.attrs || '') || [])[1] || '')).filter(x => !/^(toggle|ipcard|goto)\|/.test(x)).sort().join(', ');
let fails = 0, rows = 0, kinds = {};
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort()) {
  let st; try { st = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { continue; }
  if (!st || !st.review) continue;
  AG.set(st, 'tr');
  AG.UI.lim = { rv: 1e6 }; AG.UI.gp = 0; AG.UI.pp = 0;
  const menus = {}; globalThis.__MENU = (k, items) => { menus[k] = items; };
  try { AG.review(); AG.groupRows(); AG.pending(); } catch (e) { console.log('  ✗ ' + f + ': çizim hatası ' + e.message); fails++; continue; }
  Object.keys(menus).forEach(k => {
    const kind = k.slice(0, 3), c = kind === 'pm:' ? k.slice(3) + '.0/24' : k.slice(3);
    if (!/^(rm|gm|pm):$/.test(kind)) return;
    const ist = AG.itemState(c);
    // öğe birden çok listedeyse de (banı var + Kontrol edilecekler satırı var) her listenin menüsü Geçmiş'inkiyle aynı olmalı: eylemler
    // birleşimdir (objActs, 1.15.104). Önce bu satırlar denetim dışıydı ("Geçmiş ilk listenin eylemlerini sunar") ve gerçek CSF
    // denemesinde kısmi banlı aralığın iki menüsü farklı çıktı
    if (!ist) return;
    rows++;
    const r = kind === 'rm:' ? (st.review || []).filter(x => x.cidr === c)[0] : null;
    const ty = kind === 'rm:' ? (r ? r.type : '?') + (r && /services\.allow/.test(r.wl || '') ? '+svc' : '') : kind.slice(0, 2);
    kinds[ty] = (kinds[ty] || 0) + 1;
    const h = act2(AG.itemMenu(c, { type: 'x', ips: [] }, ist)), l = act2(menus[k]);
    if (h !== l) { fails++; console.log(`  ✗ ${f.replace('.json', '')} ${c} (${ty}): liste [${l || '—'}] ≠ Geçmiş [${h || '—'}]`); }
  });
}
console.log(`K7 menü eşitliği: ${rows} satır (${Object.entries(kinds).map(([k, n]) => k + ' ' + n).join(', ')}) — ${fails ? fails + ' ihlal' : 'hepsi aynı'}`);
process.exit(fails ? 1 : 0);
