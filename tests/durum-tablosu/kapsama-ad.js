// Panelin kapsama çizimi (1.15.113, CSF blok listesi): ag.js gerçek koduyla (render.js gibi DOM taklidiyle); sonuç cümlesi, Etkisini ölç
// durumu, ban altında ihlal notu ve Terimler blok listesini adıyla verir. calistir.sh çağırır: node kapsama-ad.js <ag.js>
const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const tail = src.lastIndexOf('})();');
src = src.slice(0, tail) + 'globalThis.__AG = { set: function (s, l) { S = s; LANG = l || "tr"; }, verdict: verdict, impState: impState, covName: covName, ubNote: ubNote, terms: TERMS, insideHtml: insideHtml, abuseLine: abuseLine, abuseCard: abuseCard, abuseBlkHtml: abuseBlkHtml, abuseBlkSum: abuseBlkSum, abuseHtml: abuseHtml, impactHtml: impactHtml, setCfg: function (c) { CFG = c; } };\n' + src.slice(tail);
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
  // hüküm tek durum kaydından (1.15.136: motorun obj_state'i; covers yalnız açıklama ayrıntısı)
  const v = AG.verdict({ covers: [{ kind: 'bkl', what: 'SPAMDROP' }], st: { e: 'ban', k: [{ t: 'bk', a: 'SPAMDROP', m: 'all', end: 0 }] } }, 99);
  ok(L + ' sonuç cümlesi: blok listesiyle tam banlı', /SPAMDROP/.test(v) && /verdict bad/.test(v), v);
  const s = AG.impState('bkl:SPAMDROP');
  ok(L + ' Etkisini ölç durumu: blok listesi adıyla, kalıcı renk', /SPAMDROP/.test(s) && /perm/.test(s), s);
  const n = AG.ubNote({ type: 'under_ban', ck: 'bk', cn: 'SPAMDROP', cm: 'all', tcp: '', udp: '', since: 1, n: 1 });
  ok(L + ' ban altında ihlal notu: kapsamanın adı', /SPAMDROP/.test(n.join(' ')) && !/undefined|ub_k_/.test(n.join(' ')), n.join(' | '));
  const has = i => process.argv[i] && fs.existsSync(process.argv[i]) && fs.statSync(process.argv[i]).size > 0;
  // Etkisini ölç: başlığında sayı olan her açılır bölümün gövdesinde o sayının dökümü (liste ya da tablo) var. "İzinli servislerin
  // aldığı cevaplar" başlıkta "48 başarılı · 4 yönlendirildi" deyip gövdede yalnız açıklama gösteriyordu (kullanıcının telefon ekranı, 1.15.124)
  {
    AG.setCfg({ values: { SVC_ALLOW: '1', SVC_SOURCES: 'google' }, defaults: {} });
    const im = AG.impactHtml({ ok: true, total: 60, areq: 52, aips: 3, acodes: { '200': 48, '301': 4 }, asvc: { 'google-common': 40, 'google-special': 12 },
      open: { req: 8, ips: 2, ok: 0, codes: { '404': 8 }, top: [['198.51.100.7', 8, 0, 'GET /x', '']] }, afails: [], fails: [], posts: [], bots: [], sites: [] }, 'AS64500', true, 'TEST-AS', true);
    const bos = [], re = /<details class="ag-im-more"><summary><span class="ag-im-mt">([^<]*)<\/span><span class="ag-im-ms">([^<]*)<\/span><\/summary><div class="ag-im-mb">([\s\S]*?)<\/div><\/details>/g;
    let m; while ((m = re.exec(im))) { if (/[1-9]/.test(m[2]) && !/<ul|<table/.test(m[3])) bos.push(m[1] + ' (' + m[2] + ')'); }
    const ac = (im.match(/<summary><span class="ag-im-mt">[^<]*<\/span><span class="ag-im-ms">[^<]*48[\s\S]*?<\/details>/) || [''])[0];
    // açık liste (1.15.126): sızıntı denetimi liste diliyle — "liste işliyor", ban sözcüğü ve "şu an açık" yok
    const now = Math.floor(Date.now() / 1000);
    const il = AG.impactHtml({ ok: true, total: 2, areq: 0, ban: 'list', after: { web: 1, since: now - 7200, req: 0, ips: 0, ok: 0, last: '', late: 0, ex: [] },
      open: { req: 2, ips: 1, ok: 0, codes: { '403': 2 }, top: [] }, fails: [], posts: [], bots: [], sites: [] }, 'bk:SPAMDROP', true, 'SPAMDROP', true).replace(/<[^>]+>/g, ' ');
    ok(L + ' Etkisini ölç açık listede: sızıntı sonucu liste diliyle (liste işliyor; ban / şu an açık yok)', /liste işliyor|the list works/.test(il) && !/[Bb]an |şu an açık|open now/.test(il), il.replace(/\s+/g, ' ').slice(0, 260));
    ok(L + ' Etkisini ölç: sayılı her açılır bölümün gövdesinde dökümü var; izinli servis cevapları kod ve servis başına', bos.length === 0 && /HTTP 200[\s\S]*<b>48<\/b>/.test(ac) && /HTTP 301/.test(ac) && /<b>52<\/b>/.test(ac), bos.join(' | ') || ac.slice(0, 300));
  }
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
    const AV = { ABUSE_ON: '1', ABUSE_CACHE_H: '24', ABUSE_IP_MAX: '1000', ABUSE_BLK_MAX: '100', ABUSE_MAX_AGE: '90' };
    const crd = function (i, ti, h, inner) { return '<section>' + inner + '</section>'; };
    AG.setCfg({ abuse: { set: false }, values: AV, defaults: AV });
    const a0 = AG.abuseCard(crd);
    // 1.15.115: alan parola türünde DEĞİL (parola yöneticisi WHM arama kutusunu dolduruyordu); yazılan anahtar CSS ile gizli (.ag-secret)
    ok(L + ' AbuseIPDB ayar kartı (anahtar yok): yazılabilir alan parola türünde değil, gizli; ayar alanları yok', /type="text" id="ag-abkey"[^>]*ag-secret[^>]*autocomplete="off"/.test(a0) && !/type="password"/.test(a0) && !/readonly/.test(a0) && !/ABUSE_CACHE_H/.test(a0), a0.slice(0, 300));
    AG.setCfg({ abuse: { set: true, tail: 'WXYZ', today: 1, btoday: 2 }, values: AV, defaults: AV });
    const ac = AG.abuseCard(crd);
    // 1.15.122: kayıtlı anahtar kutunun içinde maskeli (son 4 karakter), salt okunur; Değiştir / Anahtarı kaldır; beş ayar alanı
    ok(L + ' AbuseIPDB ayar kartı (anahtar var): kutuda maskeli anahtar (yalnız son 4), salt okunur, Değiştir; bugünkü sorgular; açma / kapama ve dört ayar', /id="ag-abkey"[^>]*readonly[^>]*value="•+WXYZ"/.test(ac) && !/ag-secret/.test(ac) && !/TESTANAHTAR/.test(ac) && /data-act="abuseedit" data-v="1"/.test(ac) && /data-act="abuseclr"/.test(ac) && /\b1\b[^<]*\b2\b/.test(ac) && /data-k="ABUSE_ON"/.test(ac) && ['ABUSE_CACHE_H', 'ABUSE_IP_MAX', 'ABUSE_BLK_MAX', 'ABUSE_MAX_AGE'].every(k => ac.indexOf('data-cfg="' + k + '"') >= 0) && !/undefined|k_ABUSE|h_ABUSE/.test(ac), ac.slice(0, 400));
    const lim = AG.abuseLine({ lim: 1000, n: 1000, t: 1 });
    ok(L + ' AbuseIPDB: günlük sınır satırı (sayı ve sınır, ayarın yeri)', /1\.000\/1\.000|1,000\/1,000/.test(lim) && /Ayarlar|Settings/.test(lim) && !/undefined|\{\d\}/.test(lim), lim);
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
