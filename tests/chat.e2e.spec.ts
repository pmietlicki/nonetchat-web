// chat.e2e.spec.ts
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

test.describe('Scénario de Chat de Bout en Bout', () => {
  let browser: Browser;
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  // Paramètres
  const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
  const USER_A_NAME = process.env.USER_A_NAME || 'Alice';
  const USER_B_NAME = process.env.USER_B_NAME || 'Bob';

  // Les réseaux/ICE peuvent être lents
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    // Un seul browser pour toute la suite (évite les fuites)
    browser = await chromium.launch({ headless: true });
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test.beforeEach(async () => {
    // Contexts indépendants = profils utilisateurs séparés
    ctxA = await browser.newContext();
    ctxB = await browser.newContext();
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();
  });

  test.afterEach(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  // Petit helper : aller sur l’onglet "Pairs" (le libellé peut être "Pairs (1)", "Pairs (2)", etc.)
  const goToPairsTab = async (page: Page) => {
    // Noms accessibles possibles : "Pairs (1)", "Pairs (2)", etc. On matche juste "Pairs"
    const pairsBtn = page.getByRole('button', { name: /Pairs/i });
    await expect(pairsBtn).toBeVisible();
    await pairsBtn.click();
  };

  test('deux utilisateurs se voient et échangent un message', async () => {
    // --- Alice ---
    await pageA.goto(BASE_URL);
    await pageA.waitForLoadState('networkidle');

    // Le modal "Votre Profil" est ouvert au chargement → le renseigner puis sauvegarder
    const aliceProfileHeading = pageA.getByRole('heading', { name: 'Votre Profil', level: 3 });
    await expect(aliceProfileHeading).toBeVisible();

    await pageA.getByLabel("Nom d'utilisateur").fill(USER_A_NAME);
    await pageA.getByRole('button', { name: 'Sauvegarder' }).click();

    // Attendre la fermeture réelle du modal
    await aliceProfileHeading.waitFor({ state: 'detached' });

    // Assurer qu'on est sur l’onglet Pairs
    await goToPairsTab(pageA);

    // --- Bob ---
    await pageB.goto(BASE_URL);
    await pageB.waitForLoadState('networkidle');

    const bobProfileHeading = pageB.getByRole('heading', { name: 'Votre Profil', level: 3 });
    await expect(bobProfileHeading).toBeVisible();

    await pageB.getByLabel("Nom d'utilisateur").fill(USER_B_NAME);
    await pageB.getByRole('button', { name: 'Sauvegarder' }).click();
    await bobProfileHeading.waitFor({ state: 'detached' });

    await goToPairsTab(pageB);

    // --- Alice ouvre la conversation avec USER_B_NAME ---
    const bobItemForAlice = pageA.getByRole('listitem').filter({ hasText: new RegExp(`^${USER_B_NAME}\\b`) });
    await expect(bobItemForAlice).toBeVisible({ timeout: 30_000 });
    await bobItemForAlice.getByRole('button', { name: 'Démarrer une conversation' }).click();

    // --- Bob ouvre aussi la conversation avec USER_A_NAME ---
    const aliceItemForBob = pageB.getByRole('listitem').filter({ hasText: new RegExp(`^${USER_A_NAME}\\b`) });
    await expect(aliceItemForBob).toBeVisible({ timeout: 30_000 });
    await aliceItemForBob.getByRole('button', { name: 'Démarrer une conversation' }).click();

    // --- Envoi Alice -> Bob ---
    const msg = `Bonjour ${USER_B_NAME} #${Date.now()}`;
    await pageA.getByPlaceholder(/tapez votre message/i).fill(msg);
    await pageA.getByRole('button', { name: /envoyer le message/i }).click();

    // Bob doit voir le message
    await expect(pageB.getByText(msg, { exact: true })).toBeVisible({ timeout: 20_000 });

    // --- Réponse Bob -> Alice ---
    const reply = `Salut ${USER_A_NAME} #${Date.now()}`;
    await pageB.getByPlaceholder(/tapez votre message/i).fill(reply);
    await pageB.getByRole('button', { name: /envoyer le message/i }).click();

    await expect(pageA.getByText(reply, { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
