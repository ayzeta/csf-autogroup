// Yer tutucu ve sınır tutarlılığı:
//  1) ag.js sözlüğünde her anahtarın TR ve EN değeri aynı yer tutucu kümesini ({0}, {1}…) kullanır;
//  2) motorun M_* metinlerinde TR ve EN %s sayısı eşittir (1.15.92'de M_C24_CLOSED ve M_POPEN'in EN sırası çağrıyla tersti; sayı eşit
//     olduğu için bu test sırayı değil sayıyı yakalar, sıra durum tablosunda);
//  3) port listesi metinlerindeki "en çok N" / "at most N" sayısı motorun cfg_check desenindeki tekrar sınırından ({0,N-1}) okunur:
//     ASN_TCP/ASN_UDP/CLOUD_TCP/CLOUD_UDP (M_CFG_PORTS, bad_ports) ve CLOUD_MODES ek portları (M_CFG_CLM, bad_cm). 1.15.92'de metin
//     "en çok 15" diyordu, desen 50 kabul ediyordu.
//   node tests/metin/yer.js whm/assets/ag.js csf_autogroup.sh
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8'), sh = fs.readFileSync(process.argv[3], 'utf8');
const enAt = src.indexOf('\n    en: {'), dEnd = src.indexOf('\n  };', enAt);
const re = /(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*): '((?:[^'\\]|\\.)*)'/g;
function dict(seg) { const o = {}; let m; re.lastIndex = 0; while ((m = re.exec(seg))) if (!(m[1] in o)) o[m[1]] = m[2]; return o; }
const TR = dict(src.slice(src.indexOf('var DICT = {'), enAt)), EN = dict(src.slice(enAt, dEnd));
let bad = 0;
const ph = v => [...new Set((v.match(/\{\d+\}/g) || []))].sort().join(',');
for (const k of Object.keys(TR)) {
  if (!(k in EN)) continue;
  if (ph(TR[k]) !== ph(EN[k])) { bad++; console.log(`  ✗ ${k}: TR yer tutucuları [${ph(TR[k])}] ↔ EN [${ph(EN[k])}]`); }
}
// motor: if [ "$MSG_LANG" = "tr" ] … else (EN) … fi. Aynı blokta iki kez tanımlanan ad sonrakini ezer: 1.15.92'de M_DG_PB hem
// "+%s blok …" hem "Sağlayıcı banı …" idi, özetin sayı parçası başlık metnini basıyordu
const b0 = sh.indexOf('if [ "$MSG_LANG" = "tr" ]; then'), b1 = sh.indexOf('\nelse\n', b0), b2 = sh.indexOf('\nfi\n', b1);
const M = { tr: {}, en: {} };
for (const [lang, seg] of [['tr', sh.slice(b0, b1)], ['en', sh.slice(b1, b2)]])
  for (const m of seg.matchAll(/(M_[A-Z0-9_]+)="((?:[^"\\]|\\.)*)"/g)) {
    if (m[1] in M[lang]) { bad++; console.log(`  ✗ ${lang}: ${m[1]} aynı blokta iki kez tanımlı (sonraki öncekini ezer)`); }
    M[lang][m[1]] = m[2];
  }
for (const k of Object.keys(M.tr)) {
  if (!(k in M.en)) continue;
  const a = (M.tr[k].match(/%s/g) || []).length, b = (M.en[k].match(/%s/g) || []).length;
  if (a !== b) { bad++; console.log(`  ✗ ${k}: TR ${a} ↔ EN ${b} tane %s`); }
}
// sınırlar
const asn = /ASN_TCP\|ASN_UDP\|CLOUD_TCP\|CLOUD_UDP\)\s*\n\s*\[\[ "\$v" =~ \^\(\[0-9\]\{1,5\}\(:\[0-9\]\{1,5\}\)\?\(,\[0-9\]\{1,5\}\(:\[0-9\]\{1,5\}\)\?\)\{0,(\d+)\}/.exec(sh);
const cm = /CLOUD_MODES\)[\s\S]{0,400}?\(,\[0-9\]\{1,5\}\(-\[0-9\]\{1,5\}\)\?\(\/\(tcp\|udp\)\)\?\)\{0,(\d+)\}/.exec(sh);
const cmn = /CLOUD_MODES\)[\s\S]{0,700}?"\$n" -gt (\d+)/.exec(sh);
if (!asn || !cm || !cmn) { bad++; console.log('  ✗ cfg_check port desenleri bulunamadı (test güncellenmeli)'); }
else {
  const nA = +asn[1] + 1, nC = +cm[1] + 1, nL = +cmn[1];
  const want = [['M_CFG_PORTS', M.tr.M_CFG_PORTS, 'en çok ' + nA], ['M_CFG_PORTS', M.en.M_CFG_PORTS, 'at most ' + nA],
    ['bad_ports', TR.bad_ports, 'en çok ' + nA], ['bad_ports', EN.bad_ports, 'at most ' + nA],
    ['M_CFG_CLM', M.tr.M_CFG_CLM, 'en çok ' + nC], ['M_CFG_CLM', M.en.M_CFG_CLM, 'at most ' + nC],
    ['M_CFG_CLM', M.tr.M_CFG_CLM, 'en çok ' + nL + ' liste'], ['M_CFG_CLM', M.en.M_CFG_CLM, 'at most ' + nL + ' lists'],
    ['bad_cm', TR.bad_cm, 'en çok ' + nC], ['bad_cm', EN.bad_cm, 'at most ' + nC]];
  for (const [k, v, w] of want) if (!v || v.indexOf(w) < 0) { bad++; console.log(`  ✗ ${k}: «${w}» yok (motor deseni: ASN/CLOUD portu ${nA}, CLOUD_MODES portu ${nC}, liste ${nL})`); }
  // panelin ASN_TCP/UDP deseni motorla aynı sınırda
  const pj = /\['ASN_TCP', 'ASN_UDP'\]\.forEach\(function \(k\) \{ if \(!\/\^\(\\d\{1,5\}\(:\\d\{1,5\}\)\?\(,\\d\{1,5\}\(:\\d\{1,5\}\)\?\)\{0,(\d+)\}/.exec(src);
  if (!pj || +pj[1] + 1 !== nA) { bad++; console.log(`  ✗ ag.js cfgErrors ASN_TCP/UDP sınırı motorla aynı değil (${pj ? +pj[1] + 1 : '?'} ↔ ${nA})`); }
}
if (bad) { console.log(`Yer tutucu / sınır: ${bad} sorun`); process.exit(1); }
console.log('Yer tutucu / sınır: TR ↔ EN yer tutucuları ve port sınırı metinleri motorla aynı');
