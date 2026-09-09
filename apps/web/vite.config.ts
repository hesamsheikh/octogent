import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiProxyTarget = process.env.OCTOGENT_API_ORIGIN ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
    include: ["tests/**/*.test.tsx"],
    // Canvas hydration settles behind timers; the default 5s leaves no room
    // once several such specs share a worker.
    testTimeout: 20_000,
  },
} as never);
