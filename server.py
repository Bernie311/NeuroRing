import argparse,json,mimetypes,pathlib,sqlite3,threading,time,urllib.parse
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from observer import Observer
from data_source import Source,DataUnavailable
from launcher_support import INSTANCE

ROOT=pathlib.Path(__file__).resolve().parent
class App:
    def __init__(self):
        self.observer=Observer();self.source=None;self.state={'ok':False,'error':'正在读取本机数据…','code':'loading','generatedAt':None}
    def scan(self):
        while not self.observer.stop.is_set():
            try:
                if self.source is None:self.source=Source(self.observer)
                self.state=self.source.collect()
            except Exception as e:
                if isinstance(e,DataUnavailable):code,message=e.code,str(e)
                elif isinstance(e,sqlite3.DatabaseError):code,message='incompatible','Codex 数据暂不可读或版本不兼容。请保持 Codex 打开；本页会自动重试。'
                elif isinstance(e,(ValueError,KeyError,TypeError)):code,message='invalid','本地配置格式暂不可读。请检查 catalog.json（若有），并重新打开 Codex。'
                else:code,message='unavailable','无法读取本机数据。请以运行 Codex 的同一 Windows 账号打开 NeuroRing；本页会自动重试。'
                self.state={'ok':False,'error':message,'code':code,'generatedAt':time.time()}
            self.observer.stop.wait(3)
    def start(self):
        threading.Thread(target=self.observer.run,daemon=True).start()
        threading.Thread(target=self.scan,daemon=True).start()

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        allowed={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        if (self.path!='/api/stop' or self.headers.get('Host') not in allowed
                or self.headers.get('X-Codex-Screen')!='stop-local-service'
                or self.headers.get('Sec-Fetch-Site')=='cross-site'
                or self.headers.get('Origin') not in (None,*[f'http://{h}' for h in allowed])):
            self.send_error(403);return
        self.send_response(200);self.end_headers();self.wfile.write(b'OK')
        self.server.app.observer.stop.set()
        threading.Thread(target=self.server.shutdown,daemon=True).start()
    def do_GET(self):
        allowed={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        if self.headers.get('Host') not in allowed:self.send_error(403);return
        origin=self.headers.get('Origin')
        if origin and origin not in {f'http://{h}' for h in allowed}:self.send_error(403);return
        route=urllib.parse.urlparse(self.path).path
        if route.startswith('/api/') and self.headers.get('Sec-Fetch-Site')=='cross-site':self.send_error(403);return
        if route=='/api/state':body=json.dumps(self.server.app.state,ensure_ascii=False).encode('utf-8');typ='application/json'
        elif route=='/api/health':body=json.dumps({'app':'codex-live-screen','version':1,'instance':INSTANCE}).encode();typ='application/json'
        elif route in ('/','/index.html','/app.js','/style.css','/instruments.js','/instruments.css','/task-band.js','/task-band.css','/theme.js','/theme.css'):
            name='index.html' if route=='/' else route[1:];p=ROOT/'web'/name
            body=p.read_bytes();typ=mimetypes.guess_type(name)[0] or 'text/plain'
        else:self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',typ+'; charset=utf-8');self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'")
        self.end_headers();self.wfile.write(body)
    def log_message(self,*args):pass

def serve(port):
    app=App();server=ThreadingHTTPServer(('127.0.0.1',port),Handler);server.app=app;app.start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:app.observer.stop.set();server.server_close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8791);args=parser.parse_args()
    serve(args.port)
