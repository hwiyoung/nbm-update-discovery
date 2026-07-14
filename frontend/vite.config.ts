import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // 일부 레거시 브라우저 의존성의 Node.js 환경 참조를 위한 최소 폴리필.
  define: {
    "process.browser": "true",
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: true,
    },
    // 백엔드 API 프록시 — 브라우저가 host publish 된 개발 진입점
    // 서버 IP:18210 으로 same-origin 호출하면 Vite(container:5173)가
    // docker 내부망 backend:8000 으로 프록시한다.
    proxy: {
      "/api": {
        target: "http://backend:8000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://backend:8000",
        changeOrigin: true,
      },
      // TiTiler — COG 타일·tilejson. /titiler/cog/... → titiler-cache(nginx):8000/cog/...
      // nginx 가 디스크 캐시 적용 후 titiler:8000 으로 forward. 캐시 hit 시 1ms 이내.
      "/titiler": {
        target: "http://titiler-cache:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/titiler/, ""),
      },
      // VWorld 오프라인 베이스맵 타일 — /vworld/{z}/{x}/{y}.jpg
      // → titiler-cache(nginx):8000/vworld/... (정적 파일, alias /data/vworld_tiles)
      "/vworld": {
        target: "http://titiler-cache:8000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
  },
});
