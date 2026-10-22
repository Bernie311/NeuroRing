"""User-invoked local launcher. No startup registration or app configuration changes."""
import json,pathlib,subprocess,sys,time,urllib.request,webbrowser
BASE=pathlib.Path(__file__).resolve().parent
URL='http://127.0.0.1:8791'
def available():
    try:
        with urllib.request.urlopen(URL+'/api/health',timeout=1) as r:return json.load(r).get('app')=='codex-live-screen'
    except Exception:return False
if not available():
    python=pathlib.Path(sys.executable).with_name('pythonw.exe')
    if not python.exists():python=pathlib.Path(sys.executable)
    subprocess.Popen([str(python),str(BASE/'server.py')],cwd=BASE,creationflags=0x08000000,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    for _ in range(40):
        if available():break
        time.sleep(.25)
if available():webbrowser.open(URL)
else:
    import ctypes
    ctypes.windll.user32.MessageBoxW(0,'无法启动本机服务。请检查 8791 端口是否被占用。','Codex 项目观测站',0)
