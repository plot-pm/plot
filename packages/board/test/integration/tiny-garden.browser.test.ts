import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { findFreePort, startServer } from '../helpers.mjs';

// UI layer: drive a REAL browser against the shipped artifact's served page, so
// pixel-level assertions (bug a: no horizontal page scroll) and inline-sprint
// filter behaviour (bug b) are validated on exactly what plot ships — not on
// recompiled components. Requires a freshly built artifact; `test:integration`
// rebuilds first so these bytes are never stale.
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

// A small phone viewport — the reported bug was horizontal scroll on mobile.
const MOBILE = { width: 390, height: 844 };
const LONG_SPRINT = 'the-great-heirloom-tomato-and-zucchini-overplanting-recovery-initiative';

describe('tiny-garden: UI layer (real browser renders the shipped artifact)', () => {
  let server: { port: number; kill: () => void };
  let browser: Browser;
  let baseURL: string;

  beforeAll(async () => {
    server = await startServer(FIXTURE, await findFreePort());
    baseURL = `http://localhost:${server.port}/`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  /** Open the board at mobile width and wait for cards to render. */
  async function openBoard(): Promise<Page> {
    const page = await browser.newPage({ viewport: MOBILE });
    await page.goto(baseURL);
    await page.getByText('Deal with the zucchini glut').waitFor({ timeout: 10_000 });
    return page;
  }

  it('bug (a): a very long badge value does not force horizontal page scroll on mobile', async () => {
    const page = await openBoard();
    try {
      // The long sprint slug is present…
      await expect.poll(() => page.getByText(LONG_SPRINT).count()).toBeGreaterThan(0);
      // …yet the document is not wider than the viewport (no sideways scroll).
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      // And the badge itself stays within the viewport (it wraps, not overflows).
      const box = await page.getByText(LONG_SPRINT).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width + 1);
    } finally {
      await page.close();
    }
  });

  it('bug (b): the sprint filter appears from inline values despite no sprint directory', async () => {
    const page = await openBoard();
    try {
      // The trigger carries aria-label="All sprints" (MultiSelect).
      expect(await page.getByLabel('All sprints').isVisible()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('shows per-option result counts in the sprint dropdown', async () => {
    const page = await openBoard();
    try {
      await page.getByLabel('All sprints').click();
      // Each option row ends with an aria-hidden count span. spring-planting is
      // on 2 plans (Draft + Approved); 3 plans carry no sprint at all.
      const countIn = (label: string) =>
        page.locator('label', { hasText: label }).locator('span[aria-hidden]').textContent();
      await expect.poll(() => countIn('spring-planting')).toBe('2');
      expect(await countIn('No sprint')).toBe('3');
    } finally {
      await page.close();
    }
  });

  it('bug (b): selecting an inline sprint filters the board', async () => {
    const page = await openBoard();
    try {
      expect(await page.locator('article').count()).toBe(8);

      await page.getByLabel('All sprints').click();
      // Options are Radix checkboxes named by their wrapping label — distinct
      // from the identically-worded sprint badges on cards.
      await page.getByRole('checkbox', { name: 'spring-planting' }).click();

      // Only plant-tomatoes (Draft) + fix-leaky-hose (Approved) carry it.
      await expect.poll(() => page.locator('article').count()).toBe(2);
    } finally {
      await page.close();
    }
  });

  // ── Plan viewer ───────────────────────────────────────────────────────────
  const PLAN_PATH = '/plan/2026-03-01-plant-tomatoes.md';
  const tomatoCard = (page: Page) =>
    page.locator('article', { hasText: 'Plant heirloom tomatoes' });

  it('the Open control is a real anchor to the plan route', async () => {
    const page = await openBoard();
    try {
      const open = tomatoCard(page).getByRole('link', { name: 'Open' });
      // A real href is what makes native cmd/ctrl/middle-click open a new tab.
      expect(await open.getAttribute('href')).toBe(PLAN_PATH);
    } finally {
      await page.close();
    }
  });

  it('a plain click opens the modal with the embedded plan, and Close closes it', async () => {
    const page = await openBoard();
    try {
      await tomatoCard(page).getByRole('link', { name: 'Open' }).click();

      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });

      // "opens" = the iframe is present and its srcdoc was populated by the
      // fetch with the server-rendered plan HTML (no frame traversal needed).
      const iframe = page.locator('iframe[title="Plan: plant-tomatoes"]');
      await iframe.waitFor({ state: 'visible', timeout: 5_000 });
      await expect
        .poll(async () => ((await iframe.getAttribute('srcdoc')) ?? '').includes('<h2>Approach</h2>'))
        .toBe(true);

      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('a meta-click does NOT open the modal (native new-tab is left alone)', async () => {
    const page = await openBoard();
    try {
      // A modified click may open a background tab; whatever the browser does,
      // our handler must not intercept it — so no modal appears.
      const popup = page.context().waitForEvent('page', { timeout: 2000 }).catch(() => null);
      await tomatoCard(page).getByRole('link', { name: 'Open' }).click({ modifiers: ['Meta'] });
      expect(await page.getByRole('dialog').count()).toBe(0);
      const p = await popup;
      if (p) await p.close();
    } finally {
      await page.close();
    }
  });

  it('"Open in new tab" navigates a new page to the plan route', async () => {
    const page = await openBoard();
    try {
      await tomatoCard(page).getByRole('link', { name: 'Open' }).click();
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 5_000 });

      const [popup] = await Promise.all([
        page.context().waitForEvent('page'),
        page.getByRole('link', { name: 'Open in new tab' }).click(),
      ]);
      await popup.waitForLoadState('domcontentloaded');
      expect(popup.url().endsWith(PLAN_PATH)).toBe(true);
      // The new tab is the full standalone plan page.
      expect(await popup.locator('h1').textContent()).toBe('Plant heirloom tomatoes');
      await popup.close();
    } finally {
      await page.close();
    }
  });
});
