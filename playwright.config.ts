import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a local Postgres (scripts/db/local.sh) with
// AUTH_MODE=local, so CI needs no Supabase project. `npm run db:reset` first.
const port = Number(process.env.E2E_PORT ?? 3100);
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, grep: /@mobile/ },
  ],
  webServer: {
    command: process.env.E2E_COMMAND ?? `npx next start -p ${port}`,
    url: `http://127.0.0.1:${port}/sign-in`,
    reuseExistingServer: !process.env.CI,
    // The AI route planner talks to a stand-in model API that the test starts
    // itself (tests/e2e/route-ai.spec.ts); no real key, nothing leaves the machine.
    env: { ANTHROPIC_API_KEY: "e2e-not-a-real-key", ANTHROPIC_BASE_URL: "http://127.0.0.1:3199", CRON_SECRET: "e2e-cron-secret-not-real-1234" },
    timeout: 120_000,
  },
});
