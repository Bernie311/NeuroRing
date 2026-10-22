"""Stop the verified NeuroRing service using its actual launch port."""
import urllib.request
from launcher_support import HTTP, STATE, running_port, url

def main():
    port = running_port()
    if port is None:
        return
    request = urllib.request.Request(url(port) + '/api/stop', data=b'',
        headers={'X-Codex-Screen': 'stop-local-service'}, method='POST')
    try:
        with HTTP.open(request, timeout=3):
            pass
        STATE.unlink(missing_ok=True)
    except OSError:
        pass

if __name__ == '__main__':
    main()
