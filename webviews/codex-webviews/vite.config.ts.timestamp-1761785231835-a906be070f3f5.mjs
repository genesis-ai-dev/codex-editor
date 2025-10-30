// vite.config.ts
import { defineConfig } from "file:///Users/daniellosey/CodexApp/codex-editor/webviews/codex-webviews/node_modules/.pnpm/vite@5.4.19_@types+node@22.17.0_lightningcss@1.30.1/node_modules/vite/dist/node/index.js";
import react from "file:///Users/daniellosey/CodexApp/codex-editor/webviews/codex-webviews/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.19_@types+node@22.17.0_lightningcss@1.30.1_/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
var __vite_injected_original_dirname = "/Users/daniellosey/CodexApp/codex-editor/webviews/codex-webviews";
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvZGFuaWVsbG9zZXkvQ29kZXhBcHAvY29kZXgtZWRpdG9yL3dlYnZpZXdzL2NvZGV4LXdlYnZpZXdzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvZGFuaWVsbG9zZXkvQ29kZXhBcHAvY29kZXgtZWRpdG9yL3dlYnZpZXdzL2NvZGV4LXdlYnZpZXdzL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy9kYW5pZWxsb3NleS9Db2RleEFwcC9jb2RleC1lZGl0b3Ivd2Vidmlld3MvY29kZXgtd2Vidmlld3Mvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIjtcblxuLy8gVXNlIGFuIGVudmlyb25tZW50IHZhcmlhYmxlIHRvIHNwZWNpZnkgdGhlIGFwcCB0byBidWlsZFxuY29uc3QgYXBwVG9CdWlsZCA9IHByb2Nlc3MuZW52LkFQUF9OQU1FO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICAgIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgICByZXNvbHZlOiB7XG4gICAgICAgIGFsaWFzOiB7XG4gICAgICAgICAgICBcIkBzaGFyZWRVdGlsc1wiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uLy4uL3NoYXJlZFV0aWxzXCIpLFxuICAgICAgICAgICAgLy8gVXBkYXRlZCBhbmltZS5qcyBhbGlhcyBmb3IgdjQgLSBzaW1wbGlmeSB0byBqdXN0IHBvaW50IHRvIHRoZSBtb2R1bGUgcm9vdFxuICAgICAgICAgICAgYW5pbWVqczogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCJub2RlX21vZHVsZXMvYW5pbWVqc1wiKSxcbiAgICAgICAgICAgIC8vIEFkZCBxdWlsbCBhbGlhc1xuICAgICAgICAgICAgcXVpbGw6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwibm9kZV9tb2R1bGVzL3F1aWxsXCIpLFxuICAgICAgICAgICAgLy8gQWRkIHNoYWRjbi91aSBhbGlhc2VzXG4gICAgICAgICAgICAvLyBcIkBcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyY1wiKSxcbiAgICAgICAgICAgIC8vIFwiQC9jb21wb25lbnRzXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmMvY29tcG9uZW50c1wiKSxcbiAgICAgICAgICAgIC8vIFwiQC9saWJcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyYy9saWJcIiksXG4gICAgICAgIH0sXG4gICAgfSxcbiAgICBjc3M6IHtcbiAgICAgICAgcG9zdGNzczogXCIuL3Bvc3Rjc3MuY29uZmlnLmpzXCIsXG4gICAgfSxcbiAgICBidWlsZDoge1xuICAgICAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICAgICAgICBpbnB1dDogYHNyYy8ke2FwcFRvQnVpbGR9L2luZGV4LnRzeGAsXG4gICAgICAgICAgICBleHRlcm5hbDogW1widnNjb2RlXCJdLFxuICAgICAgICAgICAgb3V0cHV0OiB7XG4gICAgICAgICAgICAgICAgLy8gU3BlY2lmeSBuYW1pbmcgY29udmVudGlvbnMgaGVyZSB3aXRob3V0IGEgaGFzaFxuICAgICAgICAgICAgICAgIGVudHJ5RmlsZU5hbWVzOiBgW25hbWVdLmpzYCxcbiAgICAgICAgICAgICAgICBjaHVua0ZpbGVOYW1lczogYFtuYW1lXS5qc2AsXG4gICAgICAgICAgICAgICAgYXNzZXRGaWxlTmFtZXM6IGBbbmFtZV0uW2V4dF1gLFxuICAgICAgICAgICAgICAgIGZvcm1hdDogXCJpaWZlXCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBvdXREaXI6IGFwcFRvQnVpbGQgPyBgZGlzdC8ke2FwcFRvQnVpbGR9YCA6IFwiZGlzdFwiLFxuICAgICAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgICAgIC8vIGNzc0NvZGVTcGxpdDogZmFsc2UsIC8vIElubGluZSBDU1MgaW50byBKUyBmb3Igd2VidmlldyBjb21wYXRpYmlsaXR5XG4gICAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFrWCxTQUFTLG9CQUFvQjtBQUMvWSxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBS3pDLElBQU0sYUFBYSxRQUFRLElBQUk7QUFFL0IsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDeEIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLFNBQVM7QUFBQSxJQUNMLE9BQU87QUFBQSxNQUNILGdCQUFnQixLQUFLLFFBQVEsa0NBQVcsbUJBQW1CO0FBQUE7QUFBQSxNQUUzRCxTQUFTLEtBQUssUUFBUSxrQ0FBVyxzQkFBc0I7QUFBQTtBQUFBLE1BRXZELE9BQU8sS0FBSyxRQUFRLGtDQUFXLG9CQUFvQjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFLdkQ7QUFBQSxFQUNKO0FBQUEsRUFDQSxLQUFLO0FBQUEsSUFDRCxTQUFTO0FBQUEsRUFDYjtBQUFBLEVBQ0EsT0FBTztBQUFBLElBQ0gsZUFBZTtBQUFBLE1BQ1gsT0FBTyxPQUFPLFVBQVU7QUFBQSxNQUN4QixVQUFVLENBQUMsUUFBUTtBQUFBLE1BQ25CLFFBQVE7QUFBQTtBQUFBLFFBRUosZ0JBQWdCO0FBQUEsUUFDaEIsZ0JBQWdCO0FBQUEsUUFDaEIsZ0JBQWdCO0FBQUEsUUFDaEIsUUFBUTtBQUFBLE1BQ1o7QUFBQSxJQUNKO0FBQUEsSUFDQSxRQUFRLGFBQWEsUUFBUSxVQUFVLEtBQUs7QUFBQSxJQUM1QyxXQUFXO0FBQUE7QUFBQSxFQUVmO0FBQ0osQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
