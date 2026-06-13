import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke config (skeleton-plan §11/§12). Runs against the PRODUCTION build
 * via `vite preview` — so the one smoke test doubles as build-artifact sanity.
 * Browsers are expected at the default ~/.cache/ms-playwright location.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
