import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import sri from "vite-plugin-sri";

export default defineConfig({
  plugins: [react(), sri()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
