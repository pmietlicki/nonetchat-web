// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const IS_CI = !!process.env.CI;
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

// Signaling/ICE (par défaut on pointe sur le serveur public avec TURN en prod)
// - surcharge possible via variables d'env : VITE_SIGNALING_URL et VITE_ICE_SERVERS
const SIGNALING_URL = process.env.VITE_SIGNALING_URL || 'ws://localhost:3001';
// VITE_ICE_SERVERS accepte soit une string JSON (array), soit une liste CSV d'urls.
// Ici on envoie une string JSON par défaut (stun public). Remplace par tes TURN si besoin.
const ICE_SERVERS_JSON =
  process.env.VITE_ICE_SERVERS ||
  JSON.stringify([{ urls: 'stun:stun.l.google.com:19302' }]);

// Pour injecter proprement les env côté Vite depuis Playwright, on préfixe la commande du webServer.
// Sous Windows, il faut "cross-env" pour supporter l’injection d’env inline.
const webServerCommand =
  process.platform === 'win32'
    ? `cross-env VITE_SIGNALING_URL=${SIGNALING_URL} VITE_ICE_SERVERS='${ICE_SERVERS_JSON}' npm run dev`
    : `VITE_SIGNALING_URL=${SIGNALING_URL} VITE_ICE_SERVERS='${ICE_SERVERS_JSON}' npm run dev`;

export default defineConfig({
  testDir: './tests',
  // Pour des scénarios e2e réseau/WebRTC, éviter le parallélisme global
  fullyParallel: false,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 1 : undefined, // 1 worker en CI = plus stable pour WS/ICE
  reporter: IS_CI ? 'list' : 'html',

  // Timeouts plus larges (découverte pairs/ICE)
  timeout: 90_000,             // timeout global d'un test
  expect: { timeout: 20_000 }, // timeout par expect()

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',        // trace au premier retry
    screenshot: 'only-on-failure',  // screenshots en cas d'échec
    video: IS_CI ? 'retain-on-failure' : 'off',
    headless: process.env.HEADFUL ? false : true, // HEADFUL=1 pour voir le test
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // slowMo: 100, // décommente pour débug pas-à-pas
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: webServerCommand,
    url: BASE_URL,
    reuseExistingServer: !IS_CI, // réutilise Vite en local si déjà lancé
    timeout: 120_000,           // laisse à Vite le temps de démarrer
  },
});
