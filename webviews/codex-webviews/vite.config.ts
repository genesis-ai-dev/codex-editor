import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Use an environment variable to specify the app to build
const appToBuild = process.env.APP_NAME;

if (!appToBuild) {
    throw new Error("APP_NAME environment variable must be set");
}

// Node.js built-in modules that should be treated as external
const nodeBuiltins = ["fs", "path", "crypto", "os", "zlib", "readline", "fs/promises"];

export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            input: `src/${appToBuild}/index.tsx`,
            external: [
                "vscode",
                /^@vscode\/webview-ui-toolkit/,
                "usfm-grammar",
                ...nodeBuiltins,
                /node:.*/, // Handle node: protocol imports
            ],
            output: {
                entryFileNames: `[name].js`,
                chunkFileNames: `[name].js`,
                assetFileNames: `[name].[ext]`,
                format: "iife",
                globals: {
                    vscode: "acquireVsCodeApi",
                    // Add empty implementations for Node.js modules
                    ...Object.fromEntries(nodeBuiltins.map((mod) => [mod, "{}"])),
                },
            },
        },
        outDir: `build/${appToBuild}`,
        emptyOutDir: true,
        sourcemap: true,
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "../../src"),
            types: resolve(__dirname, "../../types"),
            webviews: resolve(__dirname, "../"),
        },
    },
    optimizeDeps: {
        exclude: ["vscode", "@vscode/webview-ui-toolkit", "usfm-grammar", ...nodeBuiltins],
    },
});
