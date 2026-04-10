import React, { useState, useEffect, useCallback, useRef } from 'react';

const STANDARD_KEYS = [
    'q','w','e','r','t','y','u','i','o','p',
    'a','s','d','f','g','h','j','k','l',
    'z','x','c','v','b','n','m',
    '1','2','3','4','5','6','7','8','9','0',
    ',','.','?','!','-','_', '@',
];

const PRECOMPUTED_ENCODER = new TextEncoder();
const PREALLOCATED_KEYS = STANDARD_KEYS.map(k => ({
    l: k,
    u: k.toUpperCase(),
    lBuf: PRECOMPUTED_ENCODER.encode(k),
    uBuf: PRECOMPUTED_ENCODER.encode(k.toUpperCase())
}));
const STATIC_SPACE_BUF = PRECOMPUTED_ENCODER.encode(" ");

let sab = null;
let sabView = null;
try {
    if (typeof SharedArrayBuffer !== 'undefined') {
        sab = new SharedArrayBuffer(8192);
        sabView = new DataView(sab);
        if (window.electronAPI) window.electronAPI.initSAB(sab);
    }
} catch (e) {
    console.warn("SAB Initialization failed, falling back to basic IPC");
}

const sendToC = (buffer) => {
    if (sabView) {
        sabView.setUint32(0, buffer.length, false);
        for(let i=0; i<buffer.length; i++) {
            sabView.setUint8(4 + i, buffer[i]);
        }
    } else if (window.electronAPI) {
        window.electronAPI.appendBuffer(buffer);
    }
};

const SHUFFLE = (array) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 0xFFFFFFFF * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

// Layout constants
const PADDING = 12;
const KEY_W = 32;
const KEY_H = 36;
const GAP = 4;
const WIDTH = 600;
const HEIGHT = 200;

export default function VirtualKeyboard({ onKeyPress, onBackspace, onSpace, onEnter }) {
    const canvasRef = useRef(null);
    const stateRef = useRef({ shift: false, hitBoxes: [] });

    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        
        ctx.strokeStyle = '#333';
        ctx.strokeRect(0, 0, WIDTH, HEIGHT);
        
        const keys = SHUFFLE(PREALLOCATED_KEYS);
        const hitBoxes = [];
        const isShift = stateRef.current.shift;

        let x = PADDING;
        let y = PADDING;
        
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        for (let k of keys) {
            if (x + KEY_W > WIDTH - PADDING) {
                x = PADDING;
                y += KEY_H + GAP;
            }
            
            ctx.fillStyle = '#1a1a24';
            ctx.fillRect(x, y, KEY_W, KEY_H);
            ctx.strokeStyle = '#222';
            ctx.strokeRect(x, y, KEY_W, KEY_H);
            
            // Phase 9 Ghost Mode: Ultra-low contrast
            ctx.fillStyle = '#2b2b35';
            const char = isShift ? k.u : k.l;
            ctx.fillText(char, x + KEY_W/2, y + KEY_H/2);
            
            hitBoxes.push({ x, y, w: KEY_W, h: KEY_H, type: 'char', obj: k, char });
            x += KEY_W + GAP;
        }

        y += KEY_H + GAP * 2;
        x = PADDING;
        
        // Shift
        ctx.fillStyle = isShift ? '#252530' : '#15151e';
        ctx.fillRect(x, y, 90, KEY_H);
        ctx.fillStyle = '#3a3a46';
        ctx.fillText("⇧ SHIFT", x + 45, y + KEY_H/2);
        hitBoxes.push({ x, y, w: 90, h: KEY_H, type: 'shift' });
        x += 90 + GAP;
        
        // Space
        ctx.fillStyle = '#15151e';
        ctx.fillRect(x, y, 150, KEY_H);
        hitBoxes.push({ x, y, w: 150, h: KEY_H, type: 'space' });
        x += 150 + GAP;
        
        // Backspace
        ctx.fillStyle = '#201515';
        ctx.fillRect(x, y, 90, KEY_H);
        ctx.fillStyle = '#402a2a';
        ctx.fillText("⌫ BKSP", x + 45, y + KEY_H/2);
        hitBoxes.push({ x, y, w: 90, h: KEY_H, type: 'bksp' });
        x += 90 + GAP;
        
        // Enter
        ctx.fillStyle = '#152015';
        ctx.fillRect(x, y, 90, KEY_H);
        ctx.fillStyle = '#2a402a';
        ctx.fillText("⏎ ENTER", x + 45, y + KEY_H/2);
        hitBoxes.push({ x, y, w: 90, h: KEY_H, type: 'enter' });

        // Phase 20: Extreme Anti-OCR Jitter
        // We draw the basic layout once and then delegate to a high-frequency animation loop
        stateRef.current.hitBoxes = hitBoxes;
    }, []);

    // Phase 20: High-frequency Anti-OCR noise and jitter shader loop
    useEffect(() => {
        let animId;
        const ocrDestroyerLoop = () => {
            const canvas = canvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                
                // Redraw base layout on each frame (since we need to randomly reposition Glyphs)
                ctx.fillStyle = 'rgba(0,0,0,0.85)';
                ctx.fillRect(0, 0, WIDTH, HEIGHT);
                
                ctx.strokeStyle = '#333';
                ctx.strokeRect(0, 0, WIDTH, HEIGHT);
                
                const isShift = stateRef.current.shift;
                
                ctx.font = '14px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                // Draw keys with slight optical shaking
                for (let box of stateRef.current.hitBoxes) {
                    const shakeX = (Math.random() * 2 - 1); // Jitter -1 to 1px
                    const shakeY = (Math.random() * 2 - 1); 
                    
                    if (box.type === 'char') {
                        ctx.fillStyle = '#1a1a24';
                        ctx.fillRect(box.x, box.y, box.w, box.h);
                        // Extreme contrast shifting
                        const cNoise = 30 + Math.random() * 50; 
                        ctx.fillStyle = `rgb(${cNoise},${cNoise},${cNoise + 10})`;
                        const char = isShift ? box.obj.u : box.obj.l;
                        ctx.fillText(char, box.x + box.w/2 + shakeX, box.y + box.h/2 + shakeY);
                    } else if (box.type === 'shift') {
                        ctx.fillStyle = isShift ? '#252530' : '#15151e';
                        ctx.fillRect(box.x, box.y, box.w, box.h);
                        ctx.fillStyle = '#3a3a46';
                        ctx.fillText("⇧ SHIFT", box.x + box.w/2 + shakeX, box.y + box.h/2 + shakeY);
                    } else if (box.type === 'space') {
                        ctx.fillStyle = '#15151e';
                        ctx.fillRect(box.x, box.y, box.w, box.h);
                    } else if (box.type === 'bksp') {
                        ctx.fillStyle = '#201515';
                        ctx.fillRect(box.x, box.y, box.w, box.h);
                        ctx.fillStyle = '#402a2a';
                        ctx.fillText("⌫ BKSP", box.x + box.w/2 + shakeX, box.y + box.h/2 + shakeY);
                    } else if (box.type === 'enter') {
                        ctx.fillStyle = '#152015';
                        ctx.fillRect(box.x, box.y, box.w, box.h);
                        ctx.fillStyle = '#2a402a';
                        ctx.fillText("⏎ ENTER", box.x + box.w/2 + shakeX, box.y + box.h/2 + shakeY);
                    }
                }

                // Inject blinding noise scanlines across the active frame
                for (let idx=0; idx < HEIGHT; idx+= (Math.random() * 4 + 1)) {
                    ctx.strokeStyle = `rgba(0, 0, 0, ${Math.random() * 0.9})`;
                    ctx.beginPath();
                    ctx.moveTo(0, idx + (Math.random() * 2));
                    ctx.lineTo(WIDTH, idx + (Math.random() * 2));
                    ctx.stroke();
                }
            }
            animId = requestAnimationFrame(ocrDestroyerLoop);
        };
        
        animId = requestAnimationFrame(ocrDestroyerLoop);
        
        return () => {
            cancelAnimationFrame(animId);
        };
    }, []);

    useEffect(() => {
        redraw();
    }, [redraw]);

    const handleMouseMove = useCallback((e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        
        let hoveredBox = null;
        for (let box of stateRef.current.hitBoxes) {
            if (mx >= box.x && mx <= box.x + box.w && my >= box.y && my <= box.y + box.h) {
                hoveredBox = box;
                break;
            }
        }
        
        if (stateRef.current.activeHover !== hoveredBox) {
            if (stateRef.current.hoverTimer) clearTimeout(stateRef.current.hoverTimer);
            stateRef.current.activeHover = hoveredBox;
            
            if (hoveredBox) {
                stateRef.current.hoverTimer = setTimeout(() => {
                    const box = hoveredBox;
                    if (box.type === 'char') {
                        const buf = stateRef.current.shift ? box.obj.uBuf : box.obj.lBuf;
                        sendToC(buf);
                        onKeyPress(box.char);
                        stateRef.current.shift = false;
                    } else if (box.type === 'shift') {
                        stateRef.current.shift = !stateRef.current.shift;
                    } else if (box.type === 'space') {
                        sendToC(STATIC_SPACE_BUF);
                        onSpace();
                    } else if (box.type === 'bksp') {
                        if (window.electronAPI) window.electronAPI.backspace();
                        onBackspace();
                    } else if (box.type === 'enter') {
                        onEnter();
                    }
                    redraw();
                    // Clear hover to prevent double triggering
                    stateRef.current.activeHover = null;
                }, 600); // 600ms Dwell time
            }
        }
    }, [redraw, onKeyPress, onSpace, onBackspace, onEnter]);

    const handleMouseLeave = useCallback(() => {
        if (stateRef.current.hoverTimer) clearTimeout(stateRef.current.hoverTimer);
        stateRef.current.activeHover = null;
    }, []);

    return (
        <canvas 
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ borderRadius: '8px', cursor: 'crosshair', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))' }}
        />
    );
}
