// Metinde hitap ve iyelik dili yok (kullanıcı kararı 2026-11-25: "sizin bizim dilini hiç sevmem"; iyelik de koşul fiilleri de):
// "sizin izinleriniz", "listeleriniz", "banlarsanız", "isterseniz", "ekleyin", "your", "you", "our" yerine nesnenin adı ve düz
// anlatım ("elle verilen izinler", "banlanırsa", "Ekle"). Panel sözlüğünün TR / EN değerleri, Terimler (TERMS) ve motorun M_*
// metinleri taranır.
//   node tests/metin/siz.js whm/assets/ag.js csf_autogroup.sh
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8'), sh = fs.readFileSync(process.argv[3], 'utf8');
const T = [];   // [dil, anahtar, metin]
const enAt = src.indexOf('\n    en: {');
const re = /(?<![A-Za-z0-9_])([A-Za-z][A-Za-z0-9_]*): '((?:[^'\\]|\\.)*)'/g;
let m;
const d0 = src.indexOf('var DICT = {');
let seg = src.slice(d0, enAt); while ((m = re.exec(seg))) T.push(['tr', m[1], m[2]]);
re.lastIndex = 0; seg = src.slice(enAt, src.indexOf('\n  };', enAt)); while ((m = re.exec(seg))) T.push(['en', m[1], m[2]]);
const tm = /var TERMS = (\{ tr: .*\});/.exec(src);
if (tm) { const TS = Function('return ' + tm[1])(); for (const l of ['tr', 'en']) TS[l].forEach((x, i) => T.push([l, 'TERMS.' + l + '[' + i + ']', x.join(' — ')])); }
const b0 = sh.indexOf('if [ "$MSG_LANG" = "tr" ]; then'), b1 = sh.indexOf('\nelse\n', b0), b2 = sh.indexOf('\nfi\n', b1);
for (const x of sh.slice(b0, b1).matchAll(/(M_[A-Z0-9_]+)="((?:[^"\\]|\\.)*)"/g)) T.push(['tr', x[1], x[2]]);
for (const x of sh.slice(b1, b2).matchAll(/(M_[A-Z0-9_]+)="((?:[^"\\]|\\.)*)"/g)) T.push(['en', x[1], x[2]]);
// Türkçe: siz / biz zamiri, -(n)ız/-iz iyelik ve kişi ekleri, koşul -sanız/-seniz, çoğul emir -(y)ın/-in
const TRW = /^(siz|size|sizi|sizin|sizde|sizden|biz|bize|bizi|bizim|bizde|bizden)$/i;
// (yönelme -(n)ıza / -(n)ize: "sitelerinize", "izinlerinize" 1.15.138'e kadar kaçıyordu — kalıpta yalnız -a vardı, -e yoktu)
const TRS = /(?:[ıiuü]n[ıiuü]z|[ıiuü]m[ıiuü]z|s[ae]n[ıi]z|s[ıi]n[ıi]z|n[ıiuü]z[ıiuüae]?n?|n[ıiuü]zd[ae]n?|n[ıiuü]z[ıiuü]n|y[ıiuü]n|y[ıiuü]n[ıi]z)$/i;
const TRX = /^(yalnız|yalnızca|deniz|kalın|ayın|ayın|koyun|boyun|oyun|toyun|kıyın|uyun|sayın|yayın|yayınlanan|yıldız|beyin|kolayın|olayın|süreyin|şeyin|çeyin|evin|sorun|sorunun|sorunlar|ağın|bloğun|ipin|türün|günün|ayının|kendisinin|hesabın|adın|yerin|biçimin|ülkenin|listenin|banın|sunucunun|oranın|kuralın|tümün|bütün|bütünün|IP'nin|ilkin|ikinin|hepsinin|izin|izinsiz|için|kimin|neyin|hangisinin|derin|serin|dakikanın|sayının|kayın|satırın|anın|tarihin|zamanın|adresin|aralığın|kaynağın|portun|servisin|metnin|maddenin|kapsamın|kaydın|sağlayıcının|bölümün|kartın|seçimin|denetimin|durumun|ölçümün|turun|grubun|ayarın|değerin|sayfanın|alanın|kutunun|düğmenin|menünün|eklentinin|motorun|lfd'nin|CSF'in|panelin|günlüğün|dosyanın|blokların|listelerin|oyunun)$/i;
// ünsüzden sonra gelen çoğul emir (-in / -ın / -un / -ün) tamlama ekinden ayrılamaz: sık kullanılanlar adıyla
const TRI = /^(edin|kaydedin|artırın|bakın|seçin|girin|yazın|kaldırın|açın|kapatın|kullanın|çalıştırın|yapın|verin|alın|silin|gidin|düzeltin|kurun|bırakın|gönderin|indirin|okuyun|unutmayın|olun|tutun|ölçün|sınayın|gelin|dönün|geçin|çıkın|koşun|izleyin)$/i;
// İngilizce: you / your / we / our
const ENW = /^(you|your|yours|yourself|you're|you've|you'll|we|we're|we've|our|ours)$/i;
let bad = 0; const out = [];
for (const [l, k, v] of T) {
  const words = v.replace(/\{\d+\}/g, ' ').replace(/<[^>]*>/g, ' ').split(/[^A-Za-zÇĞİÖŞÜçğıöşüâîû'’]+/).map(w => w.replace(/^['’]+|['’]+$/g, '')).filter(Boolean);
  const hit = [];
  for (const w0 of words) {
    if (l === 'en') { if (ENW.test(w0)) hit.push(w0); continue; }
    const w = w0.replace(/['’].*$/, '');   // kesme işaretinden sonrası ek (IP'niz → IP + niz): ekin kendisi taranır
    const ek = w0.includes("'") || w0.includes('’') ? w0.replace(/^[^'’]*['’]/, '') : '';
    if (TRW.test(w) || (ek && /^(n[ıiuü]z|[ıiuü]n[ıiuü]z|s[ae]n[ıi]z)/i.test(ek))) { hit.push(w0); continue; }
    if (TRI.test(w) || (w.length > 5 && TRS.test(w) && !TRX.test(w))) hit.push(w0);
  }
  if (hit.length) { bad++; out.push(`  ✗ ${l} ${k}: ${hit.join(', ')} — ${(process.env.SIZ_TAM ? v : v.slice(0, 110))}`); }
}
if (process.env.SIZ_TUM) console.log(out.join('\n')); else console.log(out.slice(0, 60).join('\n'));
console.log(bad ? `siz dili: ${bad} metin` : 'siz dili: hitap / iyelik dili yok');
process.exit(bad ? 1 : 0);
