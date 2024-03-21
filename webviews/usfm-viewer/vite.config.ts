import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { glob } from "glob";
import path from "node:path";
import { fileURLToPath } from "node:url";
import smartAsset from "rollup-plugin-smart-asset";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  build: {
    outDir: 'build', 

    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'src/main.tsx'), 
        ...Object.fromEntries(
          glob
            .sync("src/views/*.tsx")
            .map((file) => [
              path.relative(
                "src",
                file.slice(0, file.length - path.extname(file).length)
              ),
              fileURLToPath(new URL(file, import.meta.url)),
            ])
        ),
      },
      plugins: [smartAsset({
        keepName: true,
        useHash: false,
      })],
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (asset) => {
          console.log(asset); if (asset.name === 'App.css') {
            return 'assets/index.css';
          }
          // 
          return `assets/${asset.name}`;
        },
      },
    },
  },
});
