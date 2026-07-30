import { defineConfig } from "vite";

// Tauri 웹뷰 전용 설정. 데스크톱 앱이라 상대 경로 기준으로 번들한다.
export default defineConfig({
  // Tauri CLI 로그가 지워지지 않도록 화면 클리어를 끈다.
  clearScreen: false,
  server: {
    port: 5173,
    // 포트가 바뀌면 tauri.conf.json 의 devUrl 과 어긋나므로 고정한다.
    strictPort: true,
  },
  build: {
    // macOS WKWebView 기준. 윈도우까지 지원하면 chrome105 로 낮춘다.
    target: "safari15",
    sourcemap: false,
    rollupOptions: {
      // 창이 둘이라 진입점도 둘이다. 미니는 별도 페이지로 두는 편이 쿼리스트링으로
      // 분기하는 것보다 명확하고, 번들도 필요한 것만 담긴다.
      input: {
        main: "index.html",
        mini: "mini.html",
      },
    },
  },
});
