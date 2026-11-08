// Aralık kartının port satırları (--inside JSON): "ports" ve aynı sıradaki "portc" (satırın yorumu). Girdi stdin'den.
// Beklenen: lfd'nin AUTHRELAY satırları (sunucudaki gerçek biçim) yorumlarıyla; tırnak ve ters bölü içeren yorum kaçışlı (JSON bozulmaz).
const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const okP = (j.ports || []).join('|') === '151.80.7.44 tcp 25|151.80.7.44 tcp 465|151.80.7.44 tcp 26|151.80.7.44 tcp 587|151.80.7.45 tcp 22';
const c = j.portc || [];
const okC = c.length === 5 && c[0] === 'lfd: 151.80.7.44 (TR/Turkey/-) AUTHRELAY limit exceeded - Fri Jun 26 13:32:31 2026' &&
  c[1] === c[0] && c[2] === c[0] && c[3] === c[0] && c[4] === 'elle "ofis" \\ deneme';
if (!okP || !okC) { console.error(JSON.stringify({ ports: j.ports, portc: j.portc })); process.exit(1); }
