"""Build an allowlisted, self-contained Windows distribution."""
import argparse
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.1.0-preview.1'


def make_icon(path):
    """Draw the app's existing ring mark, without external image dependencies."""
    size = 64
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            ring = 0.0
            for dx, dy in ((.25,.25),(.75,.25),(.25,.75),(.75,.75)):
                radius = math.hypot(x+dx-32, y+dy-32)
                ring += max(0, 1-abs(radius-22)/1.8)/4
            raw.extend((int(10+ring*205), int(15+ring*226), int(16+ring*215), 255))
    def chunk(kind, content):
        return struct.pack('>I', len(content))+kind+content+struct.pack('>I', zlib.crc32(kind+content)&0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
    path.write_bytes(struct.pack('<HHH',0,1,1)+struct.pack('<BBBBHHII',size,size,0,0,1,32,len(png),22)+png)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT/'dist')
    args = parser.parse_args()
    if sys.platform != 'win32' or struct.calcsize('P') != 8:
        raise SystemExit('Build on Windows with 64-bit Python.')
    destination = args.output.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    target = destination/'NeuroRing'
    if target.exists():
        raise SystemExit(f'Use an empty output folder: {target}')
    build_root = ROOT/'.build'
    build_root.mkdir(exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='windows-', dir=build_root))
    icon = stage/'NeuroRing.ico'
    make_icon(icon)
    version_file = stage/'version.txt'
    version_file.write_text('''VSVersionInfo(ffi=FixedFileInfo(filevers=(0,1,0,0),prodvers=(0,1,0,0),mask=0x3f,flags=0,OS=0x40004,fileType=1,subtype=0,date=(0,0)),kids=[StringFileInfo([StringTable('040904b0',[StringStruct('CompanyName','NeuroRing'),StringStruct('FileDescription','NeuroRing local Codex dashboard'),StringStruct('FileVersion','0.1.0-preview.1'),StringStruct('InternalName','NeuroRing'),StringStruct('OriginalFilename','NeuroRing.exe'),StringStruct('ProductName','NeuroRing'),StringStruct('ProductVersion','0.1.0-preview.1')])]),VarFileInfo([VarStruct('Translation',[1033,1200])])])''', encoding='utf-8')
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
        '--onedir', '--windowed', '--noupx', '--name', 'NeuroRing',
        '--icon', str(icon), '--version-file', str(version_file),
        '--add-data', f'{ROOT / "web"};web', '--distpath', str(destination),
        '--workpath', str(stage/'build'), '--specpath', str(stage), str(ROOT/'launch.py')],
        cwd=ROOT, check=True)
    for name in ('LICENSE', 'NOTICE.md', 'catalog.example.json'):
        shutil.copy2(ROOT/name, target/name)
    shutil.copy2(ROOT/'PORTABLE.md', target/'使用说明.md')
    if (ROOT/'PORTABLE_VALIDATION.md').exists():
        shutil.copy2(ROOT/'PORTABLE_VALIDATION.md', target/'验证说明.md')
    for filename, option in (('停止 NeuroRing.cmd','--stop'), ('创建桌面快捷方式.cmd','--shortcut')):
        (target/filename).write_bytes(f'@echo off\r\nstart "" "%~dp0NeuroRing.exe" {option}\r\n'.encode('ascii'))
    licenses = target/'licenses'
    licenses.mkdir()
    python_license = Path(sys.base_prefix)/'LICENSE.txt'
    if not python_license.is_file():
        raise SystemExit('CPython license missing; refusing an incomplete distribution.')
    shutil.copy2(python_license, licenses/'Python-LICENSE.txt')
    distribution = importlib.metadata.distribution('PyInstaller')
    for item in distribution.files or []:
        if item.name in ('COPYING.txt', 'COPYING', 'LICENSE', 'LICENSE.txt'):
            shutil.copy2(distribution.locate_file(item), licenses/('PyInstaller-'+item.name))
    if not list(licenses.glob('PyInstaller-*')):
        raise SystemExit('PyInstaller license missing; refusing an incomplete distribution.')
    (licenses/'README.txt').write_text('Bundled CPython and its standard-library dependencies retain their respective licenses (Python-LICENSE.txt). The PyInstaller bootloader is distributed under its license and bootloader exception (PyInstaller-COPYING.txt). Build-only packages are not part of the runtime.\n', encoding='utf-8')
    (target/'build-info.json').write_text(json.dumps({
        'app':'NeuroRing', 'version':VERSION, 'platform':'windows-x64',
        'python':platform.python_version(), 'pyinstaller':importlib.metadata.version('PyInstaller'),
        'sourceBase':'111a194f79402c81a935dc16b239b407794cf46b',
        'candidate':True, 'requiresSystemPython':False,
    }, indent=2)+'\n', encoding='utf-8')
    archive = destination/'NeuroRing-Windows-x64.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as bundle:
        for path in sorted(target.rglob('*')):
            if path.is_file():
                bundle.write(path, path.relative_to(destination))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n', encoding='ascii')
    print(json.dumps({'zip':str(archive),'bytes':archive.stat().st_size,'sha256':digest}))


if __name__ == '__main__':
    main()
