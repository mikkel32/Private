import ctypes
import json
import logging

libc = ctypes.CDLL(None)

class SecureMemoryVault:
    """
    Manages conversational history via explicitly bytearray blocks pinned to physical RAM.
    Bypasses dynamic string paging by utilizing libc.mlock.
    """
    def __init__(self):
        self.buffers: dict[str, bytearray] = {}

    def _mlock(self, buf: bytearray):
        addr = ctypes.addressof(ctypes.c_char.from_buffer(buf))
        res = libc.mlock(ctypes.c_void_p(addr), len(buf))
        if res != 0:
            logging.error(f"[Secure Memory] mlock failed: {res}")
        else:
            print(f"[Secure Memory] Pinned buffer {len(buf)} bytes to RAM.")

    def get_history(self, conv_id: str) -> list[dict]:
        """ Decodes physical RAM immediately into Python structs during V8 transaction """
        if conv_id not in self.buffers:
            return []
        
        raw = bytes(self.buffers[conv_id]).decode('utf-8')
        if not raw:
            return []
        try:
            return json.loads(raw)
        except:
            return []

    def set_history(self, conv_id: str, messages: list[dict]):
        """ Encodes struct into physical bytearray and pins it, sweeping the old one """
        raw_bytes = json.dumps(messages).encode('utf-8')
        
        if conv_id in self.buffers:
            # Zero out old memory!
            old_buf = self.buffers[conv_id]
            for i in range(len(old_buf)):
                old_buf[i] = 0

        new_buf = bytearray(raw_bytes)
        self._mlock(new_buf)
        self.buffers[conv_id] = new_buf

vault = SecureMemoryVault()
