#!/usr/bin/env python3
# Birim testi için yerel HTTP sunucusu: liste indirmesinin yarıda kesildiği durumları gerçek bağlantıyla üretir.
#   python3 kesik-sunucu.py PORT_DOSYASI
# Yollar (Google'ın ipranges biçiminde JSON; "prefixes" içinde ipv4Prefix):
#   /tam.json    12 önek, tam yanıt
#   /kesik.json  Content-Length tam gövdeyi söyler, 8 önekten sonra bağlantı kapanır (curl: eksik aktarım, çıkış 18)
#   /yarim.json  gövde 7 önekten sonra kesilmiş ama Content-Length ona göre (curl başarılı, JSON yarım)
#   /yavas.json  yanıt 5 sn bekler (curl --max-time aşılır, çıkış 28)
import http.server, json, socketserver, sys, time

def body(n):
    d = {"creationTime": "2026-11-23T00:00:00", "prefixes": [{"ipv4Prefix": "198.51.%d.0/24" % i} for i in range(n)]}
    return json.dumps(d, indent=2).encode()

FULL = body(12)

def cut_after(n):
    # n. önekten sonra kes: tam gövdedeki (n+1). "ipv4Prefix" anahtarının başı
    pos = -1
    for _ in range(n + 1):
        pos = FULL.index(b'"ipv4Prefix"', pos + 1)
    return FULL[:pos]

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def do_GET(self):
        p = self.path
        if p == "/tam.json":
            self.send_response(200); self.send_header("Content-Length", str(len(FULL))); self.end_headers(); self.wfile.write(FULL)
        elif p == "/kesik.json":
            part = cut_after(8)
            self.send_response(200); self.send_header("Content-Length", str(len(FULL))); self.end_headers()
            self.wfile.write(part); self.wfile.flush(); self.close_connection = True
        elif p == "/yarim.json":
            part = cut_after(7)
            self.send_response(200); self.send_header("Content-Length", str(len(part))); self.end_headers(); self.wfile.write(part)
        elif p == "/yavas.json":
            time.sleep(5)
            self.send_response(200); self.send_header("Content-Length", str(len(FULL))); self.end_headers(); self.wfile.write(FULL)
        else:
            self.send_response(404); self.end_headers()

class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

srv = S(("127.0.0.1", 0), H)
with open(sys.argv[1], "w") as f:
    f.write(str(srv.server_address[1]))
srv.serve_forever()
