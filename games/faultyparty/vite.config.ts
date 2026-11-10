import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A static build for RookieGamers hosting: relative paths, since the portal
// serves each build from its own versioned folder.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist-rookiegamers", assetsInlineLimit: 0 },
});
