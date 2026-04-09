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

    def append_message_binary(self, conv_id: bytes, role: bytes, content: bytes):
        """ Appends pure binary data streams into the vault bypassing all string evaluation primitives """
        block = bytearray()
        block.extend(len(role).to_bytes(4, 'big'))
        block.extend(role)
        block.extend(len(content).to_bytes(4, 'big'))
        block.extend(content)
        
        cid = conv_id.decode('utf-8') # conv_id is allowed to be str since it's non-secret routing ID
        
        if cid in self.buffers:
            old_buf = self.buffers[cid]
            new_buf = bytearray(len(old_buf) + len(block))
            new_buf[:len(old_buf)] = old_buf
            new_buf[len(old_buf):] = block
            
            import ctypes
            ctypes.memset(ctypes.addressof((ctypes.c_char * len(old_buf)).from_buffer(old_buf)), 0, len(old_buf))
                
            self._mlock(new_buf)
            self.buffers[cid] = new_buf
        else:
            self._mlock(block)
            self.buffers[cid] = block

    def append_message(self, conv_id: str, role: str, content: str):
        """ Appends structural data directly into physical bytearray using ctypes byte-by-byte copies to evade GC heap string tracking """
        import ctypes
        
        # Calculate sizes
        # Note: We assume roughly ascii/basic utf-8 sizes for this tight zero-copy isolation loop.
        # This iterates and writes char-by-char, escaping the `str.encode()` heap allocation.
        role_len = len(role)
        content_len = len(content)
        total_len = 4 + role_len + 4 + content_len
        
        # Allocate raw C-buffer detached from Python standard garbage collector
        raw_c_buf = ctypes.create_string_buffer(total_len)
        
        # 1. Write Role length
        raw_c_buf[0:4] = role_len.to_bytes(4, 'big')
        # 2. Write Role chars
        for i in range(role_len):
            raw_c_buf[4 + i] = int.to_bytes(ord(role[i]), 1, 'big')
            
        # 3. Write Content length
        offset = 4 + role_len
        raw_c_buf[offset:offset+4] = content_len.to_bytes(4, 'big')
        # 4. Write Content chars
        offset += 4
        for i in range(content_len):
             # Safe fallback to standard ascii bounds for secure channel
             char_val = ord(content[i]) if ord(content[i]) < 256 else 63 
             raw_c_buf[offset + i] = int.to_bytes(char_val, 1, 'big')
             
        # Extract to pinned python bytearray via slice memoryview
        block = bytearray(raw_c_buf.raw)
        
        # Explicitly zero out the c-buffer immediately from memory
        ctypes.memset(raw_c_buf, 0, total_len)
        
        if conv_id in self.buffers:
            old_buf = self.buffers[conv_id]
            new_buf = bytearray(len(old_buf) + len(block))
            new_buf[:len(old_buf)] = old_buf
            new_buf[len(old_buf):] = block
            
            # Secure wipe old buffer
            ctypes.memset(ctypes.addressof((ctypes.c_char * len(old_buf)).from_buffer(old_buf)), 0, len(old_buf))
                
            self._mlock(new_buf)
            self.buffers[conv_id] = new_buf
        else:
            self._mlock(block)
            self.buffers[conv_id] = block

vault = SecureMemoryVault()
