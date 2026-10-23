"""Local launcher state and direct loopback health checks."""
from contextlib import contextmanager
import errno
from http.client import HTTPException
import json
import hashlib
import os
from pathlib import Path
import socket
import sys
import time
import urllib.request

BASE = Path(__file__).resolve().parent
FROZEN = bool(getattr(sys, 'frozen', False))
INSTALL = Path(sys.executable).resolve().parent if FROZEN else BASE
# Bundled resources are read-only. Each extracted copy owns its own service.
INSTANCE = hashlib.sha256(str(INSTALL).casefold().encode('utf-8')).hexdigest()[:16] if FROZEN else None
DATA = Path(os.environ['NEURORING_DATA_DIR']) if os.environ.get('NEURORING_DATA_DIR') else (
    Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData' / 'Local')) / 'NeuroRing' / INSTANCE
    if FROZEN else BASE)
STATE = DATA / '.neuroring-runtime.json'
LOG = DATA / 'launcher.log'
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
            return (isinstance(payload, dict) and payload.get('app') == 'codex-live-screen'
                    and (INSTANCE is None or payload.get('instance') == INSTANCE))
    except (OSError, ValueError, HTTPException):
        return False


@contextmanager
def lifecycle_lock(timeout=60):
    """Serialize start/stop for this installation, including across processes."""
    # Keep the file: unlinking it could let another process lock a different file.
    STATE.parent.mkdir(parents=True, exist_ok=True)
    with STATE.with_suffix('.lock').open('a+b') as handle:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b'\0')
            handle.flush()
        if os.name == 'nt':
            import msvcrt
            def acquire():
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            def release():
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            def acquire():
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            def release():
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        deadline = time.monotonic() + timeout
        while True:
            try:
                acquire()
                break
            except OSError as error:
                if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                    raise
                if time.monotonic() >= deadline:
                    raise TimeoutError('另一项启动或停止操作尚未完成，请稍后重试。') from error
                time.sleep(.05)
        try:
            yield
        finally:
            release()

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
