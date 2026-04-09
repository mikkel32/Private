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
        """ Parses physical RAM block sequence into Python structs transiently """
        if conv_id not in self.buffers:
            return []
            
        buf = self.buffers[conv_id]
        messages = []
        offset = 0
        length = len(buf)
        
        while offset < length:
            role_len = int.from_bytes(buf[offset:offset+4], 'big')
            offset += 4
            role = buf[offset:offset+role_len].decode('utf-8')
            offset += role_len
            
            content_len = int.from_bytes(buf[offset:offset+4], 'big')
            offset += 4
            content = buf[offset:offset+content_len].decode('utf-8')
            offset += content_len
            
            messages.append({"role": role, "content": content})
            
        return messages

    def append_message(self, conv_id: str, role: str, content: str):
        """ Appends structural data into physical bytearray, preserving mlock bounds by relocating securely """
        role_bytes = role.encode('utf-8')
        content_bytes = content.encode('utf-8')
        
        block = bytearray()
        block.extend(len(role_bytes).to_bytes(4, 'big'))
        block.extend(role_bytes)
        block.extend(len(content_bytes).to_bytes(4, 'big'))
        block.extend(content_bytes)
        
        if conv_id in self.buffers:
            old_buf = self.buffers[conv_id]
            new_buf = bytearray(len(old_buf) + len(block))
            new_buf[:len(old_buf)] = old_buf
            new_buf[len(old_buf):] = block
            
            # Secure wipe old buffer
            for i in range(len(old_buf)):
                old_buf[i] = 0
                
            self._mlock(new_buf)
            self.buffers[conv_id] = new_buf
        else:
            self._mlock(block)
            self.buffers[conv_id] = block

vault = SecureMemoryVault()
