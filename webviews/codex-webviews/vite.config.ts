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
        },
    },
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
    },
});
