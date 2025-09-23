// vite.config.ts
import { defineConfig } from "file:///C:/Users/sampe/codex/codex-editor/webviews/codex-webviews/node_modules/.pnpm/vite@5.4.20_@types+node@22.18.6_lightningcss@1.30.1/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/sampe/codex/codex-editor/webviews/codex-webviews/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.20_@types+node@22.18.6_lightningcss@1.30.1_/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
var __vite_injected_original_dirname = "C:\\Users\\sampe\\codex\\codex-editor\\webviews\\codex-webviews";
var appToBuild = process.env.APP_NAME;
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sharedUtils": path.resolve(__vite_injected_original_dirname, "../../sharedUtils"),
      // Updated anime.js alias for v4 - simplify to just point to the module root
      animejs: path.resolve(__vite_injected_original_dirname, "node_modules/animejs"),
      // Add quill alias
      quill: path.resolve(__vite_injected_original_dirname, "node_modules/quill")
      // Add shadcn/ui aliases
      // "@": path.resolve(__dirname, "./src"),
      // "@/components": path.resolve(__dirname, "./src/components"),
      // "@/lib": path.resolve(__dirname, "./src/lib"),
    }
  },
  css: {
    postcss: "./postcss.config.js"
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
        format: "iife"
      }
    },
    outDir: appToBuild ? `dist/${appToBuild}` : "dist",
    sourcemap: true
    // cssCodeSplit: false, // Inline CSS into JS for webview compatibility
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxzYW1wZVxcXFxjb2RleFxcXFxjb2RleC1lZGl0b3JcXFxcd2Vidmlld3NcXFxcY29kZXgtd2Vidmlld3NcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXHNhbXBlXFxcXGNvZGV4XFxcXGNvZGV4LWVkaXRvclxcXFx3ZWJ2aWV3c1xcXFxjb2RleC13ZWJ2aWV3c1xcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvc2FtcGUvY29kZXgvY29kZXgtZWRpdG9yL3dlYnZpZXdzL2NvZGV4LXdlYnZpZXdzL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcclxuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xyXG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xyXG5cclxuLy8gVXNlIGFuIGVudmlyb25tZW50IHZhcmlhYmxlIHRvIHNwZWNpZnkgdGhlIGFwcCB0byBidWlsZFxyXG5jb25zdCBhcHBUb0J1aWxkID0gcHJvY2Vzcy5lbnYuQVBQX05BTUU7XHJcblxyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xyXG4gICAgcGx1Z2luczogW3JlYWN0KCldLFxyXG4gICAgcmVzb2x2ZToge1xyXG4gICAgICAgIGFsaWFzOiB7XHJcbiAgICAgICAgICAgIFwiQHNoYXJlZFV0aWxzXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi4vLi4vc2hhcmVkVXRpbHNcIiksXHJcbiAgICAgICAgICAgIC8vIFVwZGF0ZWQgYW5pbWUuanMgYWxpYXMgZm9yIHY0IC0gc2ltcGxpZnkgdG8ganVzdCBwb2ludCB0byB0aGUgbW9kdWxlIHJvb3RcclxuICAgICAgICAgICAgYW5pbWVqczogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCJub2RlX21vZHVsZXMvYW5pbWVqc1wiKSxcclxuICAgICAgICAgICAgLy8gQWRkIHF1aWxsIGFsaWFzXHJcbiAgICAgICAgICAgIHF1aWxsOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIm5vZGVfbW9kdWxlcy9xdWlsbFwiKSxcclxuICAgICAgICAgICAgLy8gQWRkIHNoYWRjbi91aSBhbGlhc2VzXHJcbiAgICAgICAgICAgIC8vIFwiQFwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjXCIpLFxyXG4gICAgICAgICAgICAvLyBcIkAvY29tcG9uZW50c1wiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4vc3JjL2NvbXBvbmVudHNcIiksXHJcbiAgICAgICAgICAgIC8vIFwiQC9saWJcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyYy9saWJcIiksXHJcbiAgICAgICAgfSxcclxuICAgIH0sXHJcbiAgICBjc3M6IHtcclxuICAgICAgICBwb3N0Y3NzOiBcIi4vcG9zdGNzcy5jb25maWcuanNcIixcclxuICAgIH0sXHJcbiAgICBidWlsZDoge1xyXG4gICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcclxuICAgICAgICAgICAgaW5wdXQ6IGBzcmMvJHthcHBUb0J1aWxkfS9pbmRleC50c3hgLFxyXG4gICAgICAgICAgICBleHRlcm5hbDogW1widnNjb2RlXCJdLFxyXG4gICAgICAgICAgICBvdXRwdXQ6IHtcclxuICAgICAgICAgICAgICAgIC8vIFNwZWNpZnkgbmFtaW5nIGNvbnZlbnRpb25zIGhlcmUgd2l0aG91dCBhIGhhc2hcclxuICAgICAgICAgICAgICAgIGVudHJ5RmlsZU5hbWVzOiBgW25hbWVdLmpzYCxcclxuICAgICAgICAgICAgICAgIGNodW5rRmlsZU5hbWVzOiBgW25hbWVdLmpzYCxcclxuICAgICAgICAgICAgICAgIGFzc2V0RmlsZU5hbWVzOiBgW25hbWVdLltleHRdYCxcclxuICAgICAgICAgICAgICAgIGZvcm1hdDogXCJpaWZlXCIsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICBvdXREaXI6IGFwcFRvQnVpbGQgPyBgZGlzdC8ke2FwcFRvQnVpbGR9YCA6IFwiZGlzdFwiLFxyXG4gICAgICAgIHNvdXJjZW1hcDogdHJ1ZSxcclxuICAgICAgICAvLyBjc3NDb2RlU3BsaXQ6IGZhbHNlLCAvLyBJbmxpbmUgQ1NTIGludG8gSlMgZm9yIHdlYnZpZXcgY29tcGF0aWJpbGl0eVxyXG4gICAgfSxcclxufSk7XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBMlcsU0FBUyxvQkFBb0I7QUFDeFksT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUZqQixJQUFNLG1DQUFtQztBQUt6QyxJQUFNLGFBQWEsUUFBUSxJQUFJO0FBRS9CLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQ3hCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixTQUFTO0FBQUEsSUFDTCxPQUFPO0FBQUEsTUFDSCxnQkFBZ0IsS0FBSyxRQUFRLGtDQUFXLG1CQUFtQjtBQUFBO0FBQUEsTUFFM0QsU0FBUyxLQUFLLFFBQVEsa0NBQVcsc0JBQXNCO0FBQUE7QUFBQSxNQUV2RCxPQUFPLEtBQUssUUFBUSxrQ0FBVyxvQkFBb0I7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBS3ZEO0FBQUEsRUFDSjtBQUFBLEVBQ0EsS0FBSztBQUFBLElBQ0QsU0FBUztBQUFBLEVBQ2I7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNILGVBQWU7QUFBQSxNQUNYLE9BQU8sT0FBTyxVQUFVO0FBQUEsTUFDeEIsVUFBVSxDQUFDLFFBQVE7QUFBQSxNQUNuQixRQUFRO0FBQUE7QUFBQSxRQUVKLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLFFBQ2hCLFFBQVE7QUFBQSxNQUNaO0FBQUEsSUFDSjtBQUFBLElBQ0EsUUFBUSxhQUFhLFFBQVEsVUFBVSxLQUFLO0FBQUEsSUFDNUMsV0FBVztBQUFBO0FBQUEsRUFFZjtBQUNKLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
