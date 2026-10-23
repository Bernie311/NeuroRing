"""Stop the verified NeuroRing service using its actual launch port."""
import urllib.request
from http.client import HTTPException
import time
from launcher_support import HTTP, STATE, healthy, lifecycle_lock, running_port, url

def main():
    with lifecycle_lock():
        _stop_locked()


def _stop_locked():
    port = running_port()
    if port is None:
        return
    request = urllib.request.Request(url(port) + '/api/stop', data=b'',
        headers={'X-Codex-Screen': 'stop-local-service'}, method='POST')
    try:
        with HTTP.open(request, timeout=3) as response:
            response.read()
        # Do not let a concurrent launch reuse a service that is still shutting down.
        deadline = time.monotonic() + 5
        while healthy(port):
            if time.monotonic() >= deadline:
                raise TimeoutError('服务尚未停止，请稍后重试。')
            time.sleep(.1)
        STATE.unlink(missing_ok=True)
    except (OSError, HTTPException) as error:
        # Retain the port so a subsequent stop can retry.
        raise RuntimeError('服务尚未确认停止，请稍后重试。') from error

if __name__ == '__main__':
    main()
