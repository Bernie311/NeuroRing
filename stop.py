import urllib.request
try:
    req=urllib.request.Request('http://127.0.0.1:8791/api/stop',data=b'',headers={'X-Codex-Screen':'stop-local-service'},method='POST')
    urllib.request.urlopen(req,timeout=3).close()
except Exception:pass
