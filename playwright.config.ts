import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', timeout: 40000, workers: 1, fullyParallel: false,
  globalTeardown: './tests/teardown.ts',
  use: { baseURL: 'http://127.0.0.1:8877', channel: 'msedge', headless: true,
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    viewport: { width: 1440, height: 850 }, launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } },
  webServer: { command: 'python tests/serve.py', url: 'http://127.0.0.1:8877/api/health', timeout: 60000, reuseExistingServer: false },
});
