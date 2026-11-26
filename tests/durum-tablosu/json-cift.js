// JSON metninde aynı nesne içinde iki kez geçen anahtar var mı (JSON.parse sonrakini sessizce alır: 1.15.142'nin ilk hâlinde durum
// çıktısına eklenen "now" kayıt nesnesi, aynı adı taşıyan sunucu saatini ezdi, panelin tarih hesabı çöktü).
// Kullanım: … | node json-cift.js   → tekrarlanan her anahtar bir satır ("yol: anahtar"); yoksa boş, çıkış 0
let s = require('fs').readFileSync(0, 'utf8'), i = 0, out = [];
function ws() { while (i < s.length && ' \t\r\n'.includes(s[i])) i++; }
function str() { let o = ''; i++; while (i < s.length && s[i] !== '"') { if (s[i] === '\\') { o += s[i] + s[i + 1]; i += 2; } else o += s[i++]; } i++; return o; }
function val(p) {
  ws(); const c = s[i];
  if (c === '{') { i++; const seen = {}; ws(); if (s[i] === '}') { i++; return; }
    for (;;) { ws(); const k = str(); if (seen[k]) out.push(p + ': ' + k); seen[k] = 1; ws(); i++; val(p + '.' + k); ws(); if (s[i] === ',') { i++; continue; } i++; return; } }
  if (c === '[') { i++; ws(); if (s[i] === ']') { i++; return; } let n = 0; for (;;) { val(p + '[' + (n++) + ']'); ws(); if (s[i] === ',') { i++; continue; } i++; return; } }
  if (c === '"') { str(); return; }
  while (i < s.length && !',}] \t\r\n'.includes(s[i])) i++;
}
val('$');
if (out.length) console.log(out.slice(0, 20).join('\n'));
process.exit(out.length ? 1 : 0);
