import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Use an environment variable to specify the app to build
const appToBuild = process.env.APP_NAME;

export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            input: `src/${appToBuild}/index.tsx`,
            output: {
                // Specify naming conventions here without a hash
                entryFileNames: `[name].js`,
                chunkFileNames: `[name].js`,
                assetFileNames: `[name].[ext]`,
            },
        },
        outDir: appToBuild ? `dist/${appToBuild}` : "dist",
    },
});
