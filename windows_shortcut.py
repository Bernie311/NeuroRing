"""Create Windows shell links with the Unicode interface, independent of locale."""
import ctypes
from ctypes import wintypes
from pathlib import Path
import uuid


class GUID(ctypes.Structure):
    _fields_ = [('data1', wintypes.DWORD), ('data2', wintypes.WORD),
                ('data3', wintypes.WORD), ('data4', ctypes.c_ubyte * 8)]

    @classmethod
    def parse(cls, value):
        return cls.from_buffer_copy(uuid.UUID(value).bytes_le)


def _check(result):
    if result < 0:
        raise OSError(f'Windows shell link operation failed: 0x{result & 0xffffffff:08X}')


def _method(pointer, slot, *arguments):
    table = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    return ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, *arguments)(table[slot])


def create_desktop_shortcut(target):
    """Write a per-user .lnk using IShellLinkW and IPersistFile.

    WScript.Shell's shortcut properties can lose characters outside the system
    code page. Use the explicitly wide Windows interface for every path.
    """
    ole = ctypes.WinDLL('ole32')
    ole.CoInitializeEx.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    ole.CoInitializeEx.restype = ctypes.c_long
    ole.CoCreateInstance.argtypes = [ctypes.POINTER(GUID), ctypes.c_void_p,
                                   wintypes.DWORD, ctypes.POINTER(GUID),
                                   ctypes.POINTER(ctypes.c_void_p)]
    ole.CoCreateInstance.restype = ctypes.c_long
    ole.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    ole.CoTaskMemFree.restype = None
    ole.CoUninitialize.argtypes = []
    ole.CoUninitialize.restype = None
    initialized = ole.CoInitializeEx(None, 2)
    # RPC_E_CHANGED_MODE means COM already exists on this thread; do not uninit it.
    if initialized != -2147417850:
        _check(initialized)
    shell_link = ctypes.c_void_p()
    persist = ctypes.c_void_p()
    desktop_pointer = ctypes.c_void_p()
    try:
        shell = ctypes.WinDLL('shell32')
        shell.SHGetKnownFolderPath.argtypes = [ctypes.POINTER(GUID), wintypes.DWORD,
                                              wintypes.HANDLE, ctypes.POINTER(ctypes.c_void_p)]
        shell.SHGetKnownFolderPath.restype = ctypes.c_long
        desktop_id = GUID.parse('B4BFCC3A-DB2C-424C-B029-7FE99A87C641')
        _check(shell.SHGetKnownFolderPath(ctypes.byref(desktop_id), 0x8000, None,
                                         ctypes.byref(desktop_pointer)))
        desktop = Path(ctypes.wstring_at(desktop_pointer))
        link_path = desktop / 'NeuroRing Portable.lnk'
        target = Path(target).resolve()
        class_id = GUID.parse('00021401-0000-0000-C000-000000000046')
        interface_id = GUID.parse('000214F9-0000-0000-C000-000000000046')  # IShellLinkW
        _check(ole.CoCreateInstance(ctypes.byref(class_id), None, 1,
                                    ctypes.byref(interface_id), ctypes.byref(shell_link)))
        _check(_method(shell_link, 20, ctypes.c_wchar_p)(shell_link, str(target)))
        _check(_method(shell_link, 9, ctypes.c_wchar_p)(shell_link, str(target.parent)))
        _check(_method(shell_link, 7, ctypes.c_wchar_p)(shell_link, 'NeuroRing'))
        persist_id = GUID.parse('0000010B-0000-0000-C000-000000000046')
        _check(_method(shell_link, 0, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p))(
            shell_link, ctypes.byref(persist_id), ctypes.byref(persist)))
        _check(_method(persist, 6, ctypes.c_wchar_p, wintypes.BOOL)(persist, str(link_path), True))
        return link_path
    finally:
        if persist:
            _method(persist, 2)(persist)
        if shell_link:
            _method(shell_link, 2)(shell_link)
        if desktop_pointer:
            ole.CoTaskMemFree(desktop_pointer)
        if initialized >= 0:
            ole.CoUninitialize()
