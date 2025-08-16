// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  // Pour les scénarios e2e réseau, mieux vaut éviter le full parallel (risque de course sur WS / ports)
  fullyParallel: false,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 1 : undefined, // 1 worker en CI pour la stabilité réseau
  reporter: IS_CI ? 'list' : 'html',
  timeout: 90_000,                 // Timeout global d'un test (WebRTC/ICE peut être lent)
  expect: { timeout: 20_000 },     // Timeout par expect()
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',       // Trace sur le premier retry
    screenshot: 'only-on-failure', // Screenshot seulement en cas d'échec
    video: IS_CI ? 'retain-on-failure' : 'off',
    headless: process.env.HEADFUL ? false : true, // HEADFUL=1 pour voir le test
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // slowMo: 100, // décommenter pour déboguer visuellement
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Tu peux injecter des envs ici si besoin (ex: URL du serveur de signalisation)
    // command: 'cross-env VITE_SIGNALING_URL=ws://localhost:3001 npm run dev',
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 120_000, // laisse à Vite le temps de démarrer
  },
});
