import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: 'http://127.0.0.1:5180',
    channel: 'chrome',
    viewport: { width: 1440, height: 960 },
    launchOptions: { args: process.platform === 'darwin' ? ['--use-angle=metal'] : [] },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: !process.env.CI,
  },
})
