import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

function ortAssetsPlugin(): Plugin {
  const srcDir = path.resolve("node_modules/onnxruntime-web/dist");

  return {
    name: "ort-assets",

    // Dev: serve any ORT .wasm/.mjs file from node_modules at "/" with correct MIME types
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const basename = (req.url ?? "").split("?")[0].replace(/^.*\//, "");
        const file = path.join(srcDir, basename);
        if (
          (basename.endsWith(".wasm") || basename.endsWith(".mjs")) &&
          fs.existsSync(file)
        ) {
          res.setHeader(
            "Content-Type",
            basename.endsWith(".wasm") ? "application/wasm" : "text/javascript",
          );
          res.end(fs.readFileSync(file));
          return;
        }
        next();
      });
    },

    // Build: copy all ORT .wasm/.mjs files to dist root (no hash, original filenames)
    writeBundle({ dir = "dist" }: { dir?: string }) {
      for (const file of fs.readdirSync(srcDir)) {
        if (file.endsWith(".wasm") || file.endsWith(".mjs")) {
          fs.copyFileSync(path.join(srcDir, file), path.join(dir, file));
        }
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
