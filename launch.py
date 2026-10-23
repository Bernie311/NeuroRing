"""Launch NeuroRing on a usable local port, then open the browser."""
import argparse
import os
import pathlib
import subprocess
import sys
import time
import webbrowser
from launcher_support import BASE, FROZEN, INSTALL, LOG, free_port, healthy, lifecycle_lock, remember, running_port, url

def start():
    with lifecycle_lock():
        return _start_locked()


def _start_locked():
    existing = running_port()
    if existing:
        return existing
    if FROZEN:
        command = [sys.executable, '--serve']
    else:
        # This stdlib-only app can use the base interpreter. A Windows venv
        # redirector creates a grandchild that cannot be reaped via Popen.
        interpreter = getattr(sys, '_base_executable', sys.executable) if os.name == 'nt' else sys.executable
        executable = pathlib.Path(interpreter).with_name('pythonw.exe')
        if not executable.exists():
            executable = pathlib.Path(interpreter)
        command = [str(executable), str(BASE/'server.py')]
    # A competing process could claim the probed port; retry with a fresh probe.
    for attempt in range(3):
        port = free_port()
        with LOG.open('a', encoding='utf-8') as log:
            log.write(f'\nStarting NeuroRing on 127.0.0.1:{port}\n')
            log.flush()
            process = subprocess.Popen(
                [*command, '--port', str(port)],
                cwd=INSTALL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
                stdout=log, stderr=log)
        handed_off = False
        try:
            for _ in range(60):
                if process.poll() is not None:
                    break
                if healthy(port):
                    remember(port, process.pid)
                    handed_off = True
                    return port
                time.sleep(.2)
        finally:
            if not handed_off and process.poll() is None:
                # Only this attempt's child is ours to clean up, even if saving fails.
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
    raise RuntimeError(f'服务未能启动。详细错误已保存到：{LOG}')

def create_shortcut():
    """Create a per-user Unicode shortcut without elevation or scripting tools."""
    if not FROZEN:
        raise RuntimeError('请在免安装版中创建快捷方式。')
    from windows_shortcut import create_desktop_shortcut
    create_desktop_shortcut(sys.executable)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-browser', action='store_true')
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--serve', action='store_true', help=argparse.SUPPRESS)
    action.add_argument('--stop', action='store_true')
    action.add_argument('--shortcut', action='store_true')
    parser.add_argument('--port', type=int, default=8791, help='Preferred local port; unavailable ports fall back automatically')
    args = parser.parse_args()
    try:
        if not 1 <= args.port <= 65535:
            raise ValueError('端口必须在 1 到 65535 之间。')
        import launcher_support
        launcher_support.DEFAULT_PORT = args.port
        if args.serve:
            from server import serve
            serve(args.port)
            return 0
        if args.stop:
            from stop import main as stop_service
            stop_service()
            return 0
        if args.shortcut:
            create_shortcut()
            return 0
        address = url(start())
        if args.no_browser:
            if sys.stdout:
                print(address)
        elif not webbrowser.open(address):
            raise RuntimeError(f'服务已启动，请在浏览器中打开：{address}')
    except Exception as error:
        if args.no_browser and not FROZEN:
            raise
        try:
            LOG.parent.mkdir(parents=True, exist_ok=True)
            with LOG.open('a', encoding='utf-8') as log:
                log.write(f'\n{type(error).__name__}: {error}\n')
        except OSError:
            pass
        if args.serve or args.no_browser:
            return 1
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, f'{error}\n\n诊断日志：{LOG}', 'NeuroRing', 0x10)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
