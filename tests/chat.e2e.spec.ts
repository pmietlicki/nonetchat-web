// tests/chat.e2e.spec.ts
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

test.describe('Scénario de Chat de Bout en Bout', () => {
  let browser: Browser;
  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  // Paramètres (surchageables via env)
  const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
  const USER_A_NAME = process.env.USER_A_NAME || 'Alice';
  const USER_B_NAME = process.env.USER_B_NAME || 'Bob';

  // Les réseaux/ICE peuvent être lents
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    browser = await chromium.launch({
      headless: process.env.HEADFUL ? false : true,
      // slowMo: 100, // décommente pour déboguer visuellement
    });
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test.beforeEach(async () => {
    ctxA = await browser.newContext();
    ctxB = await browser.newContext();
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();
  });

  test.afterEach(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  // Helper: échapper un nom pour l’utiliser dans une RegExp
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Helper: aller sur l’onglet "Pairs" (le libellé peut être "Pairs (1)", "Pairs (2)", etc.)
  const goToPairsTab = async (page: Page) => {
    const pairsBtn = page.getByRole('button', { name: /Pairs/i });
    await expect(pairsBtn).toBeVisible();
    await pairsBtn.click();
  };

  // Helper: remplir et fermer le modal "Votre Profil"
  const completeProfileModal = async (page: Page, username: string) => {
    const profileHeading = page.getByRole('heading', { name: 'Votre Profil', level: 3 });
    await expect(profileHeading).toBeVisible();

    await page.getByLabel("Nom d'utilisateur").fill(username);
    await page.getByRole('button', { name: 'Sauvegarder' }).click();

    await profileHeading.waitFor({ state: 'detached' }).catch(async () => {
      await expect(profileHeading).toBeHidden();
    });
  };

  // Helper robuste: ouvrir la conversation avec un pair donné
  // On match le <listitem> qui CONTIENT soit un <p> "peerName", soit un texte "peerName" n'importe où.
  const openConversationWith = async (page: Page, peerName: string) => {
    const nameRe = new RegExp(`\\b${escapeRe(peerName)}\\b`, 'i');

    // Priorité: un paragraphe qui porte exactement le nom (ton snapshot montre "paragraph: Bob")
    const itemByParagraph = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('paragraph', { name: nameRe }) });

    // Fallback: n'importe quel listitem qui a le texte (par ex. si pas de rôle "paragraph" exposé)
    const itemFallback = page.getByRole('listitem').filter({ has: page.getByText(nameRe) });

    const item = (await itemByParagraph.count()) > 0 ? itemByParagraph : itemFallback;

    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.getByRole('button', { name: 'Démarrer une conversation' }).click();
  };

  test('deux utilisateurs se voient et échangent un message', async () => {
    // --- Alice ---
    await pageA.goto(BASE_URL);
    await pageA.waitForLoadState('networkidle');
    await completeProfileModal(pageA, USER_A_NAME);
    await goToPairsTab(pageA);

    // --- Bob ---
    await pageB.goto(BASE_URL);
    await pageB.waitForLoadState('networkidle');
    await completeProfileModal(pageB, USER_B_NAME);
    await goToPairsTab(pageB);

    // --- Alice ouvre la conversation avec USER_B_NAME ---
    await openConversationWith(pageA, USER_B_NAME);

    // --- Bob ouvre aussi la conversation avec USER_A_NAME ---
    await openConversationWith(pageB, USER_A_NAME);

    // --- Envoi Alice -> Bob ---
    const msg = `Bonjour ${USER_B_NAME} #${Date.now()}`;
    await pageA.getByPlaceholder(/tapez votre message/i).fill(msg);
    await pageA.getByRole('button', { name: /envoyer le message/i }).click();

    await expect(pageB.getByText(msg, { exact: true })).toBeVisible({ timeout: 20_000 });

    // --- Réponse Bob -> Alice ---
    const reply = `Salut ${USER_A_NAME} #${Date.now()}`;
    await pageB.getByPlaceholder(/tapez votre message/i).fill(reply);
    await pageB.getByRole('button', { name: /envoyer le message/i }).click();

    await expect(pageA.getByText(reply, { exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
