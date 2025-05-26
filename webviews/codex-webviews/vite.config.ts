import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Use an environment variable to specify the app to build
const appToBuild = process.env.APP_NAME;

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@sharedUtils": path.resolve(__dirname, "../../sharedUtils"),
            // Updated anime.js alias for v4 - simplify to just point to the module root
            animejs: path.resolve(__dirname, "node_modules/animejs"),
            // Add quill alias
            quill: path.resolve(__dirname, "node_modules/quill"),
            // Add shadcn/ui aliases
            // "@": path.resolve(__dirname, "./src"),
            // "@/components": path.resolve(__dirname, "./src/components"),
            // "@/lib": path.resolve(__dirname, "./src/lib"),
        },
    },
    // css: {
    //     postcss: "./postcss.config.js",
    // },
    build: {
        rollupOptions: {
            input: `src/${appToBuild}/index.tsx`,
            external: ["vscode"],
            output: {
                // Specify naming conventions here without a hash
                entryFileNames: `[name].js`,
                chunkFileNames: `[name].js`,
                assetFileNames: `[name].[ext]`,
                format: "iife",
            },
        },
        outDir: appToBuild ? `dist/${appToBuild}` : "dist",
        sourcemap: true,
        // cssCodeSplit: false, // Inline CSS into JS for webview compatibility
    },
});
