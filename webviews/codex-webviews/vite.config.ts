import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

// Plugin to ensure CSS is injected into the bundle
const injectCssPlugin = () => {
    let cssContent = "";

    return {
        name: "inject-css-for-webview",
        enforce: "post" as const, // Run after other plugins
        generateBundle(_options, bundle) {
            // Find CSS asset
            const cssAsset = Object.values(bundle).find(
                (chunk: any) => chunk.type === "asset" && chunk.fileName?.endsWith(".css")
            ) as { type: string; fileName: string; source: string | Buffer; } | undefined;

            if (cssAsset && cssAsset.type === "asset") {
                cssContent = typeof cssAsset.source === "string"
                    ? cssAsset.source
                    : cssAsset.source.toString();
                // Remove CSS file from bundle since we'll inject it
                delete bundle[cssAsset.fileName];
            }
        },
        renderChunk(code, chunk, _options) {
            // Inject CSS into entry chunks
            if (chunk.isEntry && cssContent) {
                const cssInjection = `(function(){if(typeof document!=='undefined'){const style=document.createElement('style');style.textContent=${JSON.stringify(cssContent)};document.head.appendChild(style);}})();`;
                return {
                    code: cssInjection + code,
                    map: null,
                };
            }
            return null;
        },
        closeBundle() {
            // Final fallback - inject CSS after everything is done
            if (cssContent) {
                const outputDir = path.join(process.cwd(), "dist", appToBuild || "");
                const jsPath = path.join(outputDir, "index.js");

                if (fs.existsSync(jsPath)) {
                    const jsContent = fs.readFileSync(jsPath, "utf-8");

                    // Only inject if not already injected
                    if (!jsContent.includes("createElement('style')")) {
                        const cssInjection = `(function(){if(typeof document!=='undefined'){const style=document.createElement('style');style.textContent=${JSON.stringify(cssContent)};document.head.appendChild(style);}})();`;
                        fs.writeFileSync(jsPath, cssInjection + jsContent, "utf-8");
                    }
                }
            }
        },
        writeBundle(options, bundle) {
            // Fallback: Also check for any CSS files in the output directory
            if (!cssContent) {
                const outputDir = path.join(process.cwd(), options.dir || "dist", appToBuild || "");
                if (fs.existsSync(outputDir)) {
                    const files = fs.readdirSync(outputDir);
                    const cssFile = files.find((f) => f.endsWith(".css"));
                    if (cssFile) {
                        const cssPath = path.join(outputDir, cssFile);
                        cssContent = fs.readFileSync(cssPath, "utf-8");
                        fs.unlinkSync(cssPath);

                        // Inject into JS file
                        const jsFile = Object.values(bundle).find(
                            (chunk: any) => chunk.type === "chunk" && chunk.isEntry
                        ) as { type: string; fileName: string; } | undefined;

                        if (jsFile && jsFile.type === "chunk") {
                            const jsPath = path.join(outputDir, jsFile.fileName);
                            if (fs.existsSync(jsPath)) {
                                const jsContent = fs.readFileSync(jsPath, "utf-8");
                                const cssInjection = `(function(){if(typeof document!=='undefined'){const style=document.createElement('style');style.textContent=${JSON.stringify(cssContent)};document.head.appendChild(style);}})();`;
                                fs.writeFileSync(jsPath, cssInjection + jsContent, "utf-8");
                            }
                        }
                    }
                }
            }
        },
    };
};

// Use an environment variable to specify the app to build
const appToBuild = process.env.APP_NAME;

export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        injectCssPlugin(),
    ],
    resolve: {
        alias: {
            "@sharedUtils": path.resolve(__dirname, "../../sharedUtils"),
            // Updated anime.js alias for v4 - simplify to just point to the module root
            animejs: path.resolve(__dirname, "node_modules/animejs"),
            // Add quill alias
            quill: path.resolve(__dirname, "node_modules/quill"),
            // Add types alias to match tsconfig.json paths
            "types": path.resolve(__dirname, "../../types"),
            // Add shadcn/ui aliases
            // "@": path.resolve(__dirname, "./src"),
            // "@/components": path.resolve(__dirname, "./src/components"),
            // "@/lib": path.resolve(__dirname, "./src/lib"),
        },
    },
    // Optimize dependencies for ESM-only packages like react-player v3
    optimizeDeps: {
        include: ["react-player"],
        // Ensure ESM dependencies are properly handled
        esbuildOptions: {
            target: "es2020",
        },
    },
    css: {
        postcss: "./postcss.config.js",
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
        // Ensure ESM dependencies are properly bundled
        target: "es2020",
        cssCodeSplit: false, // Inline CSS into JS for webview compatibility
    },
});
