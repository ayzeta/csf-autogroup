// Panelin kapsama çizimi (1.15.113, CSF blok listesi): ag.js gerçek koduyla (render.js gibi DOM taklidiyle); sonuç cümlesi, Etkisini ölç
// durumu, ban altında ihlal notu ve Terimler blok listesini adıyla verir. calistir.sh çağırır: node kapsama-ad.js <ag.js>
const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const tail = src.lastIndexOf('})();');
src = src.slice(0, tail) + 'globalThis.__AG = { set: function (s, l) { S = s; LANG = l || "tr"; }, verdict: verdict, impState: impState, covName: covName, ubNote: ubNote, terms: TERMS, insideHtml: insideHtml, abuseLine: abuseLine, abuseCard: abuseCard, setCfg: function (c) { CFG = c; } };\n' + src.slice(tail);
const el = () => new Proxy(function () {}, { get: (t, k) => k === 'length' ? 0 : k === Symbol.toPrimitive ? () => '' : el(), apply: () => el(), set: () => true });
globalThis.window = { AG_BOOT: {}, addEventListener() {}, location: { search: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.document = { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, createElement: el, body: el(), documentElement: el(), hidden: true };
globalThis.location = window.location; globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.navigator = { language: 'tr' };
globalThis.fetch = () => new Promise(() => {});
globalThis.setInterval = () => 0; globalThis.setTimeout = () => 0;
new Function(src)();
const AG = globalThis.__AG;
let F = 0; const ok = (ad, kosul, deger) => { if (kosul) console.log('  ✓ ' + ad); else { F++; console.log('  ✗ ' + ad + ' → ' + deger); } };
for (const L of ['tr', 'en']) {
  AG.set({ config: {} }, L);
  const v = AG.verdict({ covers: [{ kind: 'bkl', what: 'SPAMDROP' }] }, 99);
  ok(L + ' sonuç cümlesi: blok listesiyle tam banlı', /SPAMDROP/.test(v) && /verdict bad/.test(v), v);
  const s = AG.impState('bkl:SPAMDROP');
  ok(L + ' Etkisini ölç durumu: blok listesi adıyla, kalıcı renk', /SPAMDROP/.test(s) && /perm/.test(s), s);
  const n = AG.ubNote({ type: 'under_ban', ck: 'bk', cn: 'SPAMDROP', cm: 'all', tcp: '', udp: '', since: 1, n: 1 });
  ok(L + ' ban altında ihlal notu: kapsamanın adı', /SPAMDROP/.test(n.join(' ')) && !/undefined|ub_k_/.test(n.join(' ')), n.join(' | '));
  const has = i => process.argv[i] && fs.existsSync(process.argv[i]) && fs.statSync(process.argv[i]).size > 0;
  if (has(3)) {   // motorun gerçek --inside çıktısı (calistir.sh, blok listeli kök)
    const ih = AG.insideHtml(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), 24, '151.80.7.0/24');
    ok(L + ' ban penceresi: aralığın tamamı blok listesindeyse bilgi kutusu, ban engellenmez', /ag-infobox[^>]*>[^<]*SPAMDROP/.test(ih) && !/ag-warnbox/.test(ih), ih.slice(0, 200));
  }
  if (has(4)) {   // AbuseIPDB: motorun gerçek lookup çıktısı (taklit uç, gerçek API cevabıyla)
    const d = JSON.parse(fs.readFileSync(process.argv[4], 'utf8')), al = AG.abuseLine(d.abuse);
    ok(L + ' AbuseIPDB satırı: puan, bildirim, kişi, kullanım türü; ham tarih ya da boş alan yok', /100\/100/.test(al) && /426/.test(al) && /231/.test(al) && /Data Center\/Web Hosting\/Transit/.test(al) && !/undefined|\d{4}-\d\d-\d\d|ab_/.test(al), al);
    AG.setCfg({ abuse: { set: true, tail: 'WXYZ', today: 1 } });
    const ac = AG.abuseCard();
    ok(L + ' AbuseIPDB ayar kartı: anahtar alanı şifre türünde, yalnız son 4 karakter', /type="password" id="ag-abkey"/.test(ac) && /…WXYZ/.test(ac) && !/TESTANAHTAR/.test(ac), ac.slice(0, 160));
  }
  ok(L + ' Terimler: blok listesi maddesi', AG.terms[L].some(x => /^(Blok listesi|Blocklist)$/.test(x[0])), '');
  ok(L + ' Terimler: AbuseIPDB maddesi (anahtar, saklama süresi, günlük sınır)', AG.terms[L].some(x => x[0] === 'AbuseIPDB' && /1[.,]000/.test(x[1])), '');
}
process.exit(F ? 1 : 0);
