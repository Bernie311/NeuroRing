"""Launch NeuroRing on a usable local port, then open the browser."""
import argparse
import pathlib
import subprocess
import sys
import time
import webbrowser
from launcher_support import BASE, LOG, free_port, healthy, remember, running_port, url

def start():
    existing = running_port()
    if existing:
        return existing
    executable = pathlib.Path(sys.executable).with_name('pythonw.exe')
    if not executable.exists():
        executable = pathlib.Path(sys.executable)
    # A competing process could claim the probed port; retry with a fresh probe.
    for attempt in range(3):
        port = free_port()
        with LOG.open('a', encoding='utf-8') as log:
            log.write(f'\nStarting NeuroRing on 127.0.0.1:{port}\n')
            log.flush()
            process = subprocess.Popen(
                [str(executable), str(BASE/'server.py'), '--port', str(port)],
                cwd=BASE, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
                stdout=log, stderr=log)
        for _ in range(60):
            if process.poll() is not None:
                break
            if healthy(port):
                remember(port, process.pid)
                return port
            time.sleep(.2)
        if process.poll() is None:
            # Only the child created by this attempt is stopped.
            process.terminate()
            process.wait(timeout=5)
    raise RuntimeError(f'服务未能启动。详细错误已保存到：{LOG}')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    try:
        address = url(start())
        if args.no_browser:
            if sys.stdout:
                print(address)
        elif not webbrowser.open(address):
            raise RuntimeError(f'服务已启动，请在浏览器中打开：{address}')
    except Exception as error:
        if args.no_browser:
            raise
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, str(error), 'NeuroRing', 0)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
