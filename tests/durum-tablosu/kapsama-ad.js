// Panelin kapsama çizimi (1.15.113, CSF blok listesi): ag.js gerçek koduyla (render.js gibi DOM taklidiyle); sonuç cümlesi, Etkisini ölç
// durumu, ban altında ihlal notu ve Terimler blok listesini adıyla verir. calistir.sh çağırır: node kapsama-ad.js <ag.js>
const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const tail = src.lastIndexOf('})();');
src = src.slice(0, tail) + 'globalThis.__AG = { set: function (s, l) { S = s; LANG = l || "tr"; }, verdict: verdict, impState: impState, covName: covName, ubNote: ubNote, terms: TERMS, insideHtml: insideHtml, abuseLine: abuseLine, abuseCard: abuseCard, abuseBlkHtml: abuseBlkHtml, abuseBlkSum: abuseBlkSum, abuseHtml: abuseHtml, setCfg: function (c) { CFG = c; } };\n' + src.slice(tail);
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
    ok(L + ' AbuseIPDB satırı: puan, bildirim, kişi, kullanım türü; ham tarih ya da boş alan yok', /100\/100/.test(al) && /426/.test(al) && /231/.test(al) && /Data Center\/Web Hosting\/Transit/.test(al) && !/undefined|\d{4}-\d\d-\d\d|ab_|\{\d\}/.test(al) && /son bildirim|last report/i.test(al), al);   // {1}: canlıda "Son kayıt: … · {1}" (ab_last iki kez tanımlıydı)
    // IP kartının bölümü (1.15.116): puan renkli rozet (100 → kırmızı), bildirimler yanında, ayrıntı altında; ikinci AbuseIPDB bağlantısı yok
    const ah = AG.abuseHtml(d.abuse);
    ok(L + ' AbuseIPDB IP kartı: puan kırmızı rozet, bildirim satırı, ayrıntı alt satırda, bağlantı yok', /ag-pill-bad[^>]*>[^<]*100\/100/.test(ah) && /426/.test(ah) && /ag-muted[^>]*>[^<]*Data Center/.test(ah) && !/<a |href=|\{\d\}|undefined/.test(ah), ah);
    AG.setCfg({ abuse: { set: true, tail: 'WXYZ', today: 1, btoday: 2 } });
    const ac = AG.abuseCard(function (i, ti, h, inner) { return '<section>' + inner + '</section>'; });
    // 1.15.115: alan parola türünde DEĞİL (parola yöneticisi WHM arama kutusunu dolduruyordu); yazılan anahtar CSS ile gizli (.ag-secret)
    ok(L + ' AbuseIPDB ayar kartı: anahtar alanı parola türünde değil, gizli; yalnız son 4 karakter; bugünkü IP ve blok sorgusu', /type="text" id="ag-abkey"[^>]*ag-secret[^>]*autocomplete="off"/.test(ac) && !/type="password"/.test(ac) && /…WXYZ/.test(ac) && !/TESTANAHTAR/.test(ac) && /\b1\b[^<]*\b2\b/.test(ac), ac.slice(0, 300));
  }
  if (has(5)) {   // AbuseIPDB aralık kartı: motorun --inside çıktısı (blok sorgusu önbellekte; taklit uç belgedeki alanlarla)
    const d = JSON.parse(fs.readFileSync(process.argv[5], 'utf8')), h = AG.abuseBlkHtml(d, 24);
    const ips = (h.match(/data-ip="[0-9.]+"/g) || []).join(' ');
    ok(L + ' AbuseIPDB aralık: özet (3 adres, en yüksek 100/100), tablo puana göre, IP kartına bağlı; ham tarih / boş alan yok', /\b3\b/.test(AG.abuseBlkSum(d.abuse)) && /100\/100/.test(h) && /<table class="ag-im-t ag-ab-t">/.test(h) && /^data-ip="158\.101\.136\.233"/.test(ips) && (h.match(/<tr>/g) || []).length === 4 && !/undefined|NaN|\d{4}-\d\d-\d\d|ab_|\{\d\}/.test(h), h.slice(0, 300) + ' ' + ips);
    const q = AG.abuseBlkHtml({ abk: true, abt: 5 }, 24), w = AG.abuseBlkHtml({ abk: true, abt: 5 }, 16);
    ok(L + ' AbuseIPDB aralık: önbellekte yoksa düğme (bugünkü sayı), /24\'ten genişte düğme yok, açıklama; anahtarsızda hiçbir şey', /data-dr="abq"/.test(q) && /\b5\b/.test(q) && !/data-dr="abq"/.test(w) && /\/24/.test(w) && AG.abuseBlkHtml({ abuse: d.abuse }, 24) === '', q.slice(0, 200) + ' | ' + w);
    const e = AG.abuseBlkSum({ err: 'x', code: 402 }), z = AG.abuseBlkSum({ n: 0, mx: 0, ips: [] });
    ok(L + ' AbuseIPDB aralık: 402 planın sınırı metniyle, bildirimsiz aralık kendi cümlesiyle', /\/24/.test(e) && !/HTTP/.test(e) && z && !/ab_|undefined|\{\d\}/.test(z + e), e + ' | ' + z);
  }
  ok(L + ' Terimler: tek AbuseIPDB maddesi, aralık sorgusunu ve günlük 100 blok sorgusunu anar', AG.terms[L].filter(x => x[0] === 'AbuseIPDB').length === 1 && AG.terms[L].some(x => x[0] === 'AbuseIPDB' && /\/24/.test(x[1]) && /\b100\b/.test(x[1])), AG.terms[L].filter(x => x[0] === 'AbuseIPDB').map(x => x[1].slice(0, 60)).join(' | '));
  ok(L + ' Terimler: blok listesi maddesi', AG.terms[L].some(x => /^(Blok listesi|Blocklist)$/.test(x[0])), '');
  ok(L + ' Terimler: AbuseIPDB maddesi (anahtar, saklama süresi, günlük sınır)', AG.terms[L].some(x => x[0] === 'AbuseIPDB' && /1[.,]000/.test(x[1])), '');
}
process.exit(F ? 1 : 0);
