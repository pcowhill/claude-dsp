import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Use the environment's preinstalled Chromium when the Playwright-managed
// download is absent (e.g. sandboxed CI containers).
const systemChromium = '/opt/pw-browsers/chromium';
const executablePath = existsSync(systemChromium) ? systemChromium : undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 1,
  workers: 2,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 950 },
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'npm run dev -- --port 5177 --strictPort',
    url: 'http://localhost:5177',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
