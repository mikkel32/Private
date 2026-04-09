import { useEffect, useRef } from "react";

export default function ChatWindow() {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onCanvasFrame(async (pngData) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Handle standard IPC Serialization Edge Case {type: 'Buffer', data: [...]}
      const rawBytes = pngData.data ? pngData.data : pngData;
      const blob = new Blob([new Uint8Array(rawBytes)], { type: 'image/png' });
      try {
        const bitmap = await createImageBitmap(blob);
        
        // Dynamically scale canvas to match the stream frame exactly
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0);

        // Auto-scroll to bottom of the container
        canvas.parentElement.scrollTop = canvas.parentElement.scrollHeight;
      } catch (err) {
        console.error("Canvas rendering failed", err);
      }
    });

      // Draw fallback initialization UI immediately to verify Canvas is visible!
      const canvas = canvasRef.current;
      if (canvas && canvas.getContext) {
          canvas.width = 800;
          canvas.height = 300;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#2a2a35';
          ctx.fillRect(0, 0, 800, 300);
          ctx.fillStyle = '#ffaa00';
          ctx.font = '20px sans-serif';
          ctx.fillText("Connecting to Native Vault...", 20, 40);
      }

    return () => {
       window.electronAPI.offCanvasFrame();
    };
  }, []);

  return (
    <div className="messages-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#1e1e24', overflowY: 'auto' }}>
      <canvas 
          ref={canvasRef} 
          id="secure-canvas-renderer"
          style={{ width: '100%', maxWidth: '800px', margin: '20px 0', flexShrink: 0 }}
      />
    </div>
  );
}
