"""Read-only Codex IPC transport, adapted from the user's local Token Bite transport.
Only the bounded Windows pipe framing/transport is reused; no application state is modified.
"""
import ctypes as C
from ctypes import wintypes as W
import json,struct,threading
MAX_FRAME=256*1024*1024

class Frames:
    def __init__(self): self.buffer = bytearray()

    def feed(self, data):
        self.buffer.extend(data)
        while len(self.buffer) >= 4:
            size = struct.unpack_from('<I', self.buffer)[0]
            if not 0 < size <= MAX_FRAME: raise ValueError(f'Invalid IPC frame size: {size} bytes (limit {MAX_FRAME})')
            if len(self.buffer) < size + 4: return
            obj = json.loads(self.buffer[4:size+4])
            del self.buffer[:size+4]
            if not isinstance(obj, dict): raise ValueError('Invalid IPC object')
            yield obj



class _Overlapped(C.Structure):
    _fields_=[('Internal',C.c_size_t),('InternalHigh',C.c_size_t),
              ('Offset',W.DWORD),('OffsetHigh',W.DWORD),('hEvent',W.HANDLE)]


class Pipe:
    # Operations exceptionally still cancelling after the grace period keep
    # their handle, buffer and OVERLAPPED alive here until completion is proved.
    _retired={}
    _retired_lock=threading.Lock()

    def __init__(self,path=r'\\.\pipe\codex-ipc',timeout=2.0,cancel_grace=.25):
        self.timeout_ms=max(1,int(timeout*1000))
        self.cancel_grace_ms=max(1,int(cancel_grace*1000))
        self.k = k = C.WinDLL('kernel32', use_last_error=True)
        k.CreateFileW.argtypes = [W.LPCWSTR,W.DWORD,W.DWORD,C.c_void_p,W.DWORD,W.DWORD,W.HANDLE]
        k.CreateFileW.restype = W.HANDLE
        k.PeekNamedPipe.argtypes = [W.HANDLE,C.c_void_p,W.DWORD,C.c_void_p,C.POINTER(W.DWORD),C.c_void_p]
        k.ReadFile.argtypes = [W.HANDLE,C.c_void_p,W.DWORD,C.POINTER(W.DWORD),C.c_void_p]
        k.WriteFile.argtypes = k.ReadFile.argtypes
        k.CloseHandle.argtypes = [W.HANDLE]
        k.CreateEventW.argtypes=[C.c_void_p,W.BOOL,W.BOOL,W.LPCWSTR]
        k.CreateEventW.restype=W.HANDLE
        k.WaitForSingleObject.argtypes=[W.HANDLE,W.DWORD]
        k.WaitForSingleObject.restype=W.DWORD
        k.CancelIoEx.argtypes=[W.HANDLE,C.POINTER(_Overlapped)]
        k.GetOverlappedResult.argtypes=[W.HANDLE,C.POINTER(_Overlapped),C.POINTER(W.DWORD),W.BOOL]
        self.handle = k.CreateFileW(path,0xC0000000,0,None,3,0x40000000,None)
        if self.handle == C.c_void_p(-1).value: raise C.WinError(C.get_last_error())

    @classmethod
    def _reap(cls,key):
        with cls._retired_lock:record=cls._retired[key]
        k,handle,overlapped,buffer=record
        # This daemon owns all resources; it may outlive the disconnected Pipe.
        # CancelIoEx itself never grants permission to free OVERLAPPED memory.
        if k.WaitForSingleObject(overlapped.hEvent,0xFFFFFFFF)!=0:return
        count=W.DWORD()
        complete=k.GetOverlappedResult(handle,C.byref(overlapped),C.byref(count),False)
        if not complete and C.get_last_error()==996:return  # ERROR_IO_INCOMPLETE
        k.CloseHandle(handle);k.CloseHandle(overlapped.hEvent)
        with cls._retired_lock:cls._retired.pop(key,None)

    def _cancel_pending(self,overlapped,buffer):
        handle=self.handle
        self.k.CancelIoEx(handle,C.byref(overlapped))
        if self.k.WaitForSingleObject(overlapped.hEvent,self.cancel_grace_ms)==0:
            count=W.DWORD()
            complete=self.k.GetOverlappedResult(handle,C.byref(overlapped),C.byref(count),False)
            if complete or C.get_last_error()!=996:
                self.close()
                return False
        # No completion yet. Disconnect logically now, but let the reaper close
        # the physical handles only after Windows releases the operation.
        self.handle=None
        key=id(overlapped)
        with self._retired_lock:self._retired[key]=(self.k,handle,overlapped,buffer)
        try:threading.Thread(target=self._reap,args=(key,),daemon=True).start()
        except RuntimeError:pass  # Retain resources safely if a thread cannot start.
        return True

    def _transfer(self,buffer,size,write):
        if self.handle is None:raise OSError('IPC disconnected')
        event=self.k.CreateEventW(None,True,False,None)
        if not event:raise C.WinError(C.get_last_error())
        overlapped=_Overlapped();overlapped.hEvent=event
        count=W.DWORD();pending=False;retired=False
        try:
            operation=self.k.WriteFile if write else self.k.ReadFile
            if not operation(self.handle,buffer,size,C.byref(count),C.byref(overlapped)):
                error=C.get_last_error()
                if error!=997:raise C.WinError(error)  # ERROR_IO_PENDING
                pending=True
                wait=self.k.WaitForSingleObject(event,self.timeout_ms)
                if wait==258:raise TimeoutError('IPC write timeout' if write else 'IPC read timeout')
                if wait!=0:raise OSError('IPC completion wait failed')
            if not self.k.GetOverlappedResult(self.handle,C.byref(overlapped),C.byref(count),False):
                error=C.get_last_error()
                if error!=996:pending=False
                raise C.WinError(error)
            pending=False
            return count.value
        finally:
            if pending:retired=self._cancel_pending(overlapped,buffer)
            if not retired:self.k.CloseHandle(event)

    def send(self, obj):
        body = json.dumps(obj).encode('utf8')
        data = struct.pack('<I',len(body))+body
        buffer=C.create_string_buffer(data)
        if self._transfer(buffer,len(data),True)!=len(data):
            raise OSError('IPC send failed')

    def read(self):
        if self.handle is None:raise OSError('IPC disconnected')
        available = W.DWORD()
        if not self.k.PeekNamedPipe(self.handle,None,0,None,C.byref(available),None): raise OSError('IPC disconnected')
        if not available.value: return b''
        buf = C.create_string_buffer(min(available.value,65536))
        count=self._transfer(buf,len(buf),False)
        return buf.raw[:count]

    def close(self):
        if self.handle is not None:
            handle,self.handle=self.handle,None
            self.k.CloseHandle(handle)
