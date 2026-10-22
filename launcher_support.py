"""Local launcher state and direct loopback health checks."""
import json
from pathlib import Path
import socket
import urllib.request

BASE = Path(__file__).resolve().parent
STATE = BASE / '.neuroring-runtime.json'
LOG = BASE / 'launcher.log'
DEFAULT_PORT = 8791
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def url(port):
    return f'http://127.0.0.1:{port}'

def healthy(port):
    if not isinstance(port, int) or not 1 <= port <= 65535:
        return False
    try:
        with HTTP.open(url(port) + '/api/health', timeout=1) as response:
            payload = json.load(response)
            return isinstance(payload, dict) and payload.get('app') == 'codex-live-screen'
    except (OSError, ValueError):
        return False

def saved_port():
    try:
        state = json.loads(STATE.read_text(encoding='utf-8'))
        port = state.get('port') if isinstance(state, dict) else None
        return port if type(port) is int and 1 <= port <= 65535 else None
    except (OSError, ValueError):
        return None

def running_port():
    for port in dict.fromkeys((saved_port(), DEFAULT_PORT)):
        if healthy(port):
            return port
    return None

def free_port():
    # Windows may reserve a port without any process listening on it.
    for candidate in (DEFAULT_PORT, 0):
        try:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', candidate))
                return probe.getsockname()[1]
        except OSError:
            continue
    raise OSError('No available loopback port')

def remember(port, pid):
    temp = STATE.with_suffix('.tmp')
    temp.write_text(json.dumps({'port': port, 'pid': pid}), encoding='utf-8')
    temp.replace(STATE)
