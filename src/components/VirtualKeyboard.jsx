import React, { useState, useEffect, useCallback } from 'react';

const STANDARD_KEYS = [
    'q','w','e','r','t','y','u','i','o','p',
    'a','s','d','f','g','h','j','k','l',
    'z','x','c','v','b','n','m',
    '1','2','3','4','5','6','7','8','9','0',
    ',','.','?','!','-','_', '@',
];

const SHUFFLE = (array) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        // High-entropy scramble
        const j = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 0xFFFFFFFF * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

export default function VirtualKeyboard({ onKeyPress, onBackspace, onSpace, onEnter }) {
    const [keys, setKeys] = useState([]);
    const [isShift, setIsShift] = useState(false);

    // Shuffle aggressively on every mount
    useEffect(() => {
        setKeys(SHUFFLE(STANDARD_KEYS));
    }, []);

    const handleKeyClick = useCallback((char) => {
        const finalChar = isShift ? char.toUpperCase() : char;
        const buffer = new TextEncoder().encode(finalChar);
        if (window.electronAPI) {
            window.electronAPI.appendBuffer(buffer);
        }
        onKeyPress(finalChar);
        
        // Shuffle everything again after each click to defeat mouse-tracking algorithms
        setKeys(SHUFFLE(STANDARD_KEYS));
        setIsShift(false);
    }, [isShift, onKeyPress]);

    const handleSpace = useCallback(() => {
        const buffer = new TextEncoder().encode(" ");
        if (window.electronAPI) window.electronAPI.appendBuffer(buffer);
        onSpace();
        setKeys(SHUFFLE(STANDARD_KEYS));
    }, [onSpace]);

    const handleBackspace = useCallback(() => {
        if (window.electronAPI) window.electronAPI.backspace();
        onBackspace();
        setKeys(SHUFFLE(STANDARD_KEYS));
    }, [onBackspace]);

    return (
        <div style={{
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid #333',
            borderRadius: '8px',
            padding: '12px',
            userSelect: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            width: '100%',
            maxWidth: '600px',
            backdropFilter: 'blur(10px)',
            pointerEvents: 'auto'
        }}>
            <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px',
                justifyContent: 'center'
            }}>
                {keys.map((k, i) => (
                    <button
                        key={`${k}-${i}`}
                        onMouseDown={(e) => { e.preventDefault(); handleKeyClick(k); }} // use onMouseDown to bypass focus loss
                        style={{
                            width: '32px',
                            height: '36px',
                            background: '#1a1a24',
                            border: '1px solid #444',
                            color: '#ccc',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            textTransform: isShift ? 'uppercase' : 'lowercase'
                        }}
                    >
                        {isShift ? k.toUpperCase() : k}
                    </button>
                ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button
                    onMouseDown={(e) => { e.preventDefault(); setIsShift(!isShift); setKeys(SHUFFLE(STANDARD_KEYS)); }}
                    style={{ padding: '8px 16px', background: isShift ? '#444' : '#222', border: '1px solid #555', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
                >
                    ⇧ SHIFT
                </button>
                <button
                    onMouseDown={(e) => { e.preventDefault(); handleSpace(); }}
                    style={{ flex: 1, height: '36px', background: '#222', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer' }}
                />
                <button
                    onMouseDown={(e) => { e.preventDefault(); handleBackspace(); }}
                    style={{ padding: '8px 16px', background: '#3a2020', border: '1px solid #633', color: '#ffaaaa', borderRadius: '4px', cursor: 'pointer' }}
                >
                    ⌫ BKSP
                </button>
                <button
                    onMouseDown={(e) => { e.preventDefault(); onEnter(); }}
                    style={{ padding: '8px 16px', background: '#203a20', border: '1px solid #363', color: '#aaffaa', borderRadius: '4px', cursor: 'pointer' }}
                >
                    ⏎ ENTER
                </button>
            </div>
        </div>
    );
}
