import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: "chrome",
    viewport: { width: 1440, height: 960 },
    launchOptions: { args: ["--enable-webgl", "--use-angle=metal"] },
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
})
