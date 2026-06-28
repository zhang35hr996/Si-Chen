import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke config (skeleton-plan §11/§12). Runs against the PRODUCTION build
 * via `vite preview` — so the one smoke test doubles as build-artifact sanity.
 * Browsers are expected at the default ~/.cache/ms-playwright location.
 *
 * VITE_E2E=1 is injected only for this build so `?e2eSeed=N` can pin the random
 * harem for deterministic assertions. Real production builds omit the flag and
 * always use crypto-random seeds.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
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
    env: { VITE_E2E: "1" },
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
