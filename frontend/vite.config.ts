import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// ORT WASM files that must be served at a fixed, unhashed URL.
// Vite's asset hashing breaks ort's internal resolution of these files.
const ORT_FILES = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
];

function ortAssetsPlugin(): Plugin {
  const srcDir = path.resolve("node_modules/onnxruntime-web/dist");

  return {
    name: "ort-assets",

    // Dev: serve ORT files from node_modules at "/" with correct MIME types
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const basename = (req.url ?? "").split("?")[0].replace(/^.*\//, "");
        if (ORT_FILES.includes(basename)) {
          const file = path.join(srcDir, basename);
          if (fs.existsSync(file)) {
            res.setHeader(
              "Content-Type",
              basename.endsWith(".wasm") ? "application/wasm" : "text/javascript",
            );
            res.end(fs.readFileSync(file));
            return;
          }
        }
        next();
      });
    },

    // Build: copy ORT files to dist root with original filenames (no hash)
    writeBundle({ dir = "dist" }: { dir?: string }) {
      for (const file of ORT_FILES) {
        const src = path.join(srcDir, file);
        const dest = path.join(dir, file);
        if (fs.existsSync(src)) fs.copyFileSync(src, dest);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), ortAssetsPlugin()],
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
});
