import {defineConfig, devices} from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 4173);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: {timeout: 7_000},
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
    launchOptions: executablePath ? {executablePath} : {},
  },
  projects: [
    {name: 'desktop-chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1365, height: 900}}},
    {name: 'mobile-chromium', use: {...devices['Pixel 7'], viewport: {width: 390, height: 844}}},
  ],
  webServer: {
    command: 'npm run build:pdf-preview && node tests/serve.mjs',
    url: `http://127.0.0.1:${port}/documents.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
