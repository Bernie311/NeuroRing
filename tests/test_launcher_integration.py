"""Exercise real launcher processes against isolated, metadata-free services."""
import json
from pathlib import Path
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import launcher_support as support


SERVER = '''
import argparse,json,os,pathlib,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
parser=argparse.ArgumentParser();parser.add_argument('--port',type=int);args=parser.parse_args()
time.sleep(.4)
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body=b'{"app":"codex-live-screen","version":1}'
        self.send_response(200);self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)
    def do_POST(self):
        self.send_response(200);self.send_header('Content-Length','2')
        self.end_headers();self.wfile.write(b'OK')
        pathlib.Path('stopping').touch()
        threading.Timer(.4,self.server.shutdown).start()
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
with open('starts.jsonl','a') as out:out.write(json.dumps({'pid':os.getpid(),'port':args.port})+'\\n')
watchdog=threading.Timer(25,server.shutdown);watchdog.daemon=True;watchdog.start()
try:server.serve_forever(poll_interval=.05)
finally:watchdog.cancel();server.server_close()
'''

RUNNER = '''
import json,pathlib,sys,time
import launcher_support as support
import launch,stop
support.DEFAULT_PORT=int(sys.argv[1])
action=sys.argv[2]
if len(sys.argv)>3:
    while not pathlib.Path(sys.argv[3]).exists():time.sleep(.01)
if action=='start':print(json.dumps({'port':launch.start()}),flush=True)
elif action=='stop':stop.main()
elif action=='save-failure':
    children=[];original=launch.subprocess.Popen
    def tracked(*args,**kwargs):
        child=original(*args,**kwargs);children.append(child);return child
    def fail(*args):raise PermissionError('synthetic state save failure')
    launch.subprocess.Popen=tracked;launch.remember=fail
    try:launch.start()
    except PermissionError as error:
        print(json.dumps({'error':str(error),'running':[p.poll() is None for p in children]}),flush=True)
'''


class ForeignHandler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.recv(8192)
        self.request.sendall(self.server.payload)


class ForeignServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    payload = b'SSH-2.0-synthetic-service\r\n'


class LauncherIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.fixture = Path(self.temporary.name)
        for name in ('launch.py', 'launcher_support.py', 'stop.py'):
            shutil.copy2(ROOT / name, self.fixture / name)
        (self.fixture / 'server.py').write_text(SERVER, encoding='utf-8')
        (self.fixture / 'runner.py').write_text(RUNNER, encoding='utf-8')
        self.foreign = ForeignServer(('127.0.0.1', 0), ForeignHandler)
        self.foreign_thread = threading.Thread(target=self.foreign.serve_forever, daemon=True)
        self.foreign_thread.start()
        self.workers = []

    def tearDown(self):
        for worker in self.workers:
            if worker.poll() is None:
                worker.terminate()
            worker.communicate(timeout=5)
        # Only stop ports recorded by this test fixture's synthetic children.
        for started in self.starts():
            try:
                request = urllib.request.Request(support.url(started['port']) + '/api/stop', data=b'')
                with support.HTTP.open(request, timeout=1) as response:
                    response.read()
            except OSError:
                pass
        self.foreign.shutdown()
        self.foreign.server_close()
        self.foreign_thread.join(timeout=2)
        deadline = time.monotonic() + 5
        for started in self.starts():
            while support.healthy(started['port']):
                self.assertLess(time.monotonic(), deadline, 'Synthetic service did not stop')
                time.sleep(.05)
        # A closed listener can precede process exit and release of redirected logs.
        while True:
            try:
                self.temporary.cleanup()
                break
            except PermissionError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.05)

    def worker(self, action, gate=None):
        command = [sys.executable, str(self.fixture / 'runner.py'), str(self.foreign.server_address[1]), action]
        if gate is not None:
            command.append(str(gate))
        process = subprocess.Popen(command, cwd=self.fixture, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.workers.append(process)
        return process

    def result(self, process):
        output, errors = process.communicate(timeout=15)
        self.assertEqual(process.returncode, 0, errors)
        return json.loads(output) if output.strip() else None

    def starts(self):
        path = self.fixture / 'starts.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_simultaneous_launches_reuse_one_service_despite_non_http_default(self):
        gate = self.fixture / 'go'
        first, second = self.worker('start', gate), self.worker('start', gate)
        gate.touch()
        first_port, second_port = self.result(first)['port'], self.result(second)['port']
        self.assertEqual(first_port, second_port)
        self.assertNotEqual(first_port, self.foreign.server_address[1])
        self.assertEqual(len(self.starts()), 1)
        self.assertTrue(support.healthy(first_port))
        self.result(self.worker('stop'))
        self.assertFalse(support.healthy(first_port))
        self.assertFalse((self.fixture / '.neuroring-runtime.json').exists())

    def test_truncated_http_health_does_not_prevent_fallback(self):
        self.foreign.payload = b'HTTP/1.1 200 OK\r\nContent-Length: 99\r\n\r\n{'
        port = self.result(self.worker('start'))['port']
        self.assertNotEqual(port, self.foreign.server_address[1])
        self.assertTrue(support.healthy(port))

    def test_state_save_failure_reaps_its_child(self):
        result = self.result(self.worker('save-failure'))
        self.assertEqual(result['error'], 'synthetic state save failure')
        self.assertEqual(result['running'], [False])
        self.assertEqual(len(self.starts()), 1)
        self.assertFalse(support.healthy(self.starts()[0]['port']))

    def test_start_waits_for_stop_instead_of_reusing_a_dying_service(self):
        self.result(self.worker('start'))
        stopping = self.worker('stop')
        deadline = time.monotonic() + 5
        while not (self.fixture / 'stopping').exists():
            self.assertLess(time.monotonic(), deadline, 'Stop request did not reach fixture')
            time.sleep(.01)
        restarting = self.worker('start')
        self.result(stopping)
        new_port = self.result(restarting)['port']
        self.assertEqual(len(self.starts()), 2)
        self.assertTrue(support.healthy(new_port))
        state = json.loads((self.fixture / '.neuroring-runtime.json').read_text())
        self.assertEqual(state['port'], new_port)
        self.assertEqual(state['pid'], self.starts()[-1]['pid'])


if __name__ == '__main__':
    unittest.main()
