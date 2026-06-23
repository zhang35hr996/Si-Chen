/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/llm": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  test: {
    // Two explicit lanes so `npm test` runs both, but environments never mix
    // (scene-ui-narrative-refactor PR2: isolated jsdom/RTL lane for *.test.tsx only).
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"], // existing engine/logic tests — unchanged
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/**/*.test.tsx"], // interaction-heavy UI components (RTL)
          setupFiles: ["./tests/setup.ui.ts"],
        },
      },
    ],
  },
});
