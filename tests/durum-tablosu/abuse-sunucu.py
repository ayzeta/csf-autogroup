#!/usr/bin/env python3
# AbuseIPDB check uç taklidi (durum tablosu): cevaplar gerçek API'nin cevapları (2026-11-23, lin.ayzeta.net'te ölçüldü; 158.101.136.233).
#   python3 abuse-sunucu.py PORT_DOSYASI SAYAÇ_DOSYASI GEÇERLİ_ANAHTAR
# Geçerli anahtarla /check?ipAddress=… → 200 ve ölçülen data nesnesi (ipAddress istekteki); başka anahtarla → 401 ve ölçülen hata.
# Her istek SAYAÇ_DOSYASI'na bir satır ("ip anahtar_doğru_mu") yazar: önbelleğin istek göndermediği oradan sınanır.
import http.server, socketserver, sys, urllib.parse

OK = ('{"data":{"ipAddress":"%s","isPublic":true,"ipVersion":4,"isWhitelisted":false,"abuseConfidenceScore":100,"countryCode":"JP",'
      '"usageType":"Data Center\\/Web Hosting\\/Transit","isp":"Oracle Public Cloud","domain":"oracleemaildelivery.com","hostnames":[],'
      '"isTor":false,"totalReports":426,"numDistinctUsers":231,"lastReportedAt":"2026-11-23T17:56:20+00:00"}}')
ERR = ('{\n"errors": [\n{\n"detail": "Authentication failed. Your API key is either missing, incorrect, or revoked. Note: The APIv2 key differs '
       'from the APIv1 key.",\n"status": 401\n}\n]\n}')
PORTF, HITS, KEY = sys.argv[1], sys.argv[2], sys.argv[3]

# /check-block (1.15.116): GERÇEK CEVAPLA ÖLÇÜLMEDİ — alanlar docs.abuseipdb.com "CHECK-BLOCK Endpoint" bölümünden (2026-11-24):
# data{networkAddress, netmask, minAddress, maxAddress, numPossibleHosts, addressSpaceDesc, reportedAddress[{ipAddress, numReports,
# mostRecentReport, abuseConfidenceScore, countryCode}]}. Sıra bilerek puana göre değil (motor sıralar). 198.51.100.0/24 bildirimsiz;
# /24'ten geniş ağ 402 (belge: sınır aşılınca 402; hata gövdesi 401'inkiyle aynı biçimde varsayıldı).
BLK = ('{"data":{"networkAddress":"%s","netmask":"255.255.255.0","minAddress":"%s","maxAddress":"%s","numPossibleHosts":254,'
       '"addressSpaceDesc":"Internet","reportedAddress":[%s]}}')
BRow = '{"ipAddress":"%s","numReports":%d,"mostRecentReport":"%s","abuseConfidenceScore":%d,"countryCode":"JP"}'
E402 = '{"errors":[{"detail":"The network parameter exceeds the size allowed for your plan.","status":402}]}'

def block(net):
    base, bits = net.split("/")
    if int(bits) < 24:
        return 402, E402
    p = base.rsplit(".", 1)[0]
    rows = [] if net.startswith("198.51.100.") else [
        BRow % (p + ".7", 16, "2026-11-20T08:00:00+00:00", 40),
        BRow % (p + ".233", 631, "2026-11-23T17:56:20+00:00", 100),
        BRow % (p + ".9", 17, "2026-11-22T10:00:00+00:00", 40)]
    return 200, BLK % (base, base, p + ".255", ",".join(rows))

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        ip = (q.get("ipAddress") or q.get("network") or [""])[0]
        good = self.headers.get("Key") == KEY and self.headers.get("Accept") == "application/json"
        with open(HITS, "a") as f:
            f.write("%s %s\n" % (ip, "ok" if good else "bad"))
        if good and u.path.endswith("/check-block"):
            code, b = block(ip)
            body = b.encode(); self.send_response(code)
            self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body); return
        body = (OK % ip if good else ERR).encode()
        self.send_response(200 if good else 401)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)

class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

srv = S(("127.0.0.1", 0), H)
open(PORTF, "w").write(str(srv.server_address[1]))
srv.serve_forever()
