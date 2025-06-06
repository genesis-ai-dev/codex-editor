// vite.config.ts
import { defineConfig } from "file:///Users/work/Documents/GitHub/codex-editor/webviews/codex-webviews/node_modules/.pnpm/vite@5.4.14_@types+node@22.13.10/node_modules/vite/dist/node/index.js";
import react from "file:///Users/work/Documents/GitHub/codex-editor/webviews/codex-webviews/node_modules/.pnpm/@vitejs+plugin-react@4.3.4_vite@5.4.14_@types+node@22.13.10_/node_modules/@vitejs/plugin-react/dist/index.mjs";
var appToBuild = process.env.APP_NAME;
var vite_config_default = defineConfig({
  plugins: [react()],
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
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvd29yay9Eb2N1bWVudHMvR2l0SHViL2NvZGV4LWVkaXRvci93ZWJ2aWV3cy9jb2RleC13ZWJ2aWV3c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL3dvcmsvRG9jdW1lbnRzL0dpdEh1Yi9jb2RleC1lZGl0b3Ivd2Vidmlld3MvY29kZXgtd2Vidmlld3Mvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL3dvcmsvRG9jdW1lbnRzL0dpdEh1Yi9jb2RleC1lZGl0b3Ivd2Vidmlld3MvY29kZXgtd2Vidmlld3Mvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuXG4vLyBVc2UgYW4gZW52aXJvbm1lbnQgdmFyaWFibGUgdG8gc3BlY2lmeSB0aGUgYXBwIHRvIGJ1aWxkXG5jb25zdCBhcHBUb0J1aWxkID0gcHJvY2Vzcy5lbnYuQVBQX05BTUU7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gICAgcGx1Z2luczogW3JlYWN0KCldLFxuICAgIGJ1aWxkOiB7XG4gICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgICAgICAgIGlucHV0OiBgc3JjLyR7YXBwVG9CdWlsZH0vaW5kZXgudHN4YCxcbiAgICAgICAgICAgIGV4dGVybmFsOiBbXCJ2c2NvZGVcIl0sXG4gICAgICAgICAgICBvdXRwdXQ6IHtcbiAgICAgICAgICAgICAgICAvLyBTcGVjaWZ5IG5hbWluZyBjb252ZW50aW9ucyBoZXJlIHdpdGhvdXQgYSBoYXNoXG4gICAgICAgICAgICAgICAgZW50cnlGaWxlTmFtZXM6IGBbbmFtZV0uanNgLFxuICAgICAgICAgICAgICAgIGNodW5rRmlsZU5hbWVzOiBgW25hbWVdLmpzYCxcbiAgICAgICAgICAgICAgICBhc3NldEZpbGVOYW1lczogYFtuYW1lXS5bZXh0XWAsXG4gICAgICAgICAgICAgICAgZm9ybWF0OiBcImlpZmVcIixcbiAgICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIG91dERpcjogYXBwVG9CdWlsZCA/IGBkaXN0LyR7YXBwVG9CdWlsZH1gIDogXCJkaXN0XCIsXG4gICAgICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXFYLFNBQVMsb0JBQW9CO0FBQ2xaLE9BQU8sV0FBVztBQUdsQixJQUFNLGFBQWEsUUFBUSxJQUFJO0FBRS9CLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQ3hCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixPQUFPO0FBQUEsSUFDSCxlQUFlO0FBQUEsTUFDWCxPQUFPLE9BQU8sVUFBVTtBQUFBLE1BQ3hCLFVBQVUsQ0FBQyxRQUFRO0FBQUEsTUFDbkIsUUFBUTtBQUFBO0FBQUEsUUFFSixnQkFBZ0I7QUFBQSxRQUNoQixnQkFBZ0I7QUFBQSxRQUNoQixnQkFBZ0I7QUFBQSxRQUNoQixRQUFRO0FBQUEsTUFDWjtBQUFBLElBQ0o7QUFBQSxJQUNBLFFBQVEsYUFBYSxRQUFRLFVBQVUsS0FBSztBQUFBLElBQzVDLFdBQVc7QUFBQSxFQUNmO0FBQ0osQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
