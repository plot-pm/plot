import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';

// UI layer: a real browser against the shipped artifact. What a route test
// cannot see is whether the ACTION is visible — a badge-only implementation
// satisfies "a story can be opened" and leaves nothing to click for anyone
// scanning the header for something to do.
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const VIEWPORT = { width: 1280, height: 900 };

describe('story overlay: opening a story from the board', () => {
  let server: { port: number; kill: () => void };
  let browser: Browser;
  let baseURL: string;

  beforeAll(async () => {
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  async function openBoard(): Promise<Page> {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(baseURL);
    await page.getByText('Deal with the zucchini glut').waitFor({ timeout: 10_000 });
    return page;
  }

  /** Open the plan modal for the netting plan — the one with a story file. */
  async function openNettingPlan(page: Page) {
    await page
      .locator('article', { hasText: 'Net the strawberry bed' })
      .getByRole('link', { name: 'Open' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    return dialog;
  }

  /** The visible control names in a dialog's header, in order. */
  const headerControls = (page: Page) =>
    page
      .getByRole('dialog')
      .locator('header')
      .locator('button, a')
      .allTextContents();

  it('the plan modal offers `Open story` as a BUTTON, not only a badge', async () => {
    const page = await openBoard();
    try {
      const dialog = await openNettingPlan(page);
      // A real <button>: a badge-only implementation would pass "a story can be
      // opened" while leaving the action invisible to anyone reading the modal.
      const control = dialog.getByRole('button', { name: 'Open story' });
      await control.waitFor({ timeout: 5_000 });
      expect(await control.evaluate((el) => el.tagName)).toBe('BUTTON');
    } finally {
      await page.close();
    }
  });

  it('`Open story` is ABSENT for a plan whose story has no file', async () => {
    const page = await openBoard();
    try {
      // drip-irrigation names `orphan-bed`, a story nobody has written. That is
      // the case the rule is for: no button rather than one that 404s. The card
      // keeps its title and status, which are true regardless.
      await page
        .locator('article', { hasText: 'Install drip-irrigation timers' })
        .getByRole('link', { name: 'Open' })
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });
      // The modal itself rendered, so this is an absent control rather than an
      // unrendered dialog.
      await page.locator('iframe[title="Plan: drip-irrigation"]')
        .waitFor({ state: 'visible', timeout: 5_000 });
      expect(await dialog.getByRole('button', { name: 'Open story' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('a story with no file renders NO LINK on the card either', async () => {
    const page = await openBoard();
    try {
      // The badge still NAMES the story — losing that would hide real
      // information to avoid a broken link — but it is text, not an anchor.
      const card = page.locator('article', { hasText: 'Install drip-irrigation timers' });
      await expect.poll(() => card.getByText('orphan-bed').count()).toBeGreaterThan(0);
      expect(await card.getByRole('link', { name: 'orphan-bed' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('a plan with no story at all offers no story control', async () => {
    const page = await openBoard();
    try {
      await page
        .locator('article', { hasText: 'Start a pumpkin patch' })
        .getByRole('link', { name: 'Open' })
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });
      await page.locator('iframe[title="Plan: pumpkin-patch"]')
        .waitFor({ state: 'visible', timeout: 5_000 });
      expect(await dialog.getByRole('button', { name: 'Open story' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('the story overlay\'s header MATCHES the plan modal\'s — compared, not listed', async () => {
    const page = await openBoard();
    try {
      await openNettingPlan(page);
      const planHeader = await headerControls(page);
      await page.getByRole('dialog').getByRole('button', { name: 'Open story' }).click();
      await page.getByRole('dialog').getByRole('heading', { name: 'Story' })
        .waitFor({ timeout: 5_000 });
      const storyHeader = await headerControls(page);

      // The assertion is the COMPARISON. Listing the three names in both places
      // would still pass the day one modal grew a fourth control, which is the
      // exact drift this symmetry exists to prevent.
      expect(storyHeader).toEqual(planHeader);
      // …and it is genuinely all three, not two empty lists agreeing.
      expect(planHeader).toEqual(['Show in board', 'Open in new tab', 'Close']);
    } finally {
      await page.close();
    }
  });

  it('lists the story\'s plans with their phases, DERIVED from the board\'s cards', async () => {
    const page = await openBoard();
    try {
      await openNettingPlan(page);
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Open story' }).click();
      await dialog.getByRole('heading', { name: 'Story' }).waitFor({ timeout: 5_000 });

      const section = dialog.locator('div', { hasText: 'Plans in this story' }).last();
      // Both real plans, with their live phases — from the cards, in phase order.
      await expect.poll(() => section.getByText('Net the strawberry bed').count())
        .toBeGreaterThan(0);
      await expect.poll(() => section.getByText('Write a compost-turning guide').count())
        .toBeGreaterThan(0);
      // `Net the strawberry bed` is approved with no Started record, which is
      // DEVELOPMENT — work waiting for an agent. It read `Design` while the
      // board manufactured that column by forking approved on started; a plan
      // reaches Design now only by being IN the Design phase, and no fixture
      // plan is. Asserting `Design` here would pin the defect this wave removes.
      await expect.poll(() => section.getByText('Development', { exact: true }).count())
        .toBeGreaterThan(0);
      await expect.poll(() => section.getByText('Testing', { exact: true }).count())
        .toBeGreaterThan(0);
      // …and Design is genuinely absent, which is the half that proves the
      // column stopped being manufactured rather than merely renamed.
      expect(await section.getByText('Design', { exact: true }).count()).toBe(0);

      // The fixture's STORY file disagrees on purpose: its hand-written
      // "Current Plan" section names a plan that does not exist and omits both
      // that do. The DERIVED list must win — drift is why it is derived.
      expect(await section.getByText('Dig the second bed').count()).toBe(0);
      // …and that stale prose really is in the document being rendered below,
      // so this is a DISAGREEMENT the derived list wins rather than an absence.
      await expect.poll(async () =>
        ((await dialog.locator('iframe').getAttribute('srcdoc')) ?? '').includes('Dig the second bed'),
      ).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('opening a story from an open plan modal REPLACES it — one overlay, one Close', async () => {
    const page = await openBoard();
    try {
      await openNettingPlan(page);
      expect(await page.getByRole('dialog').count()).toBe(1);
      await page.getByRole('dialog').getByRole('button', { name: 'Open story' }).click();
      await page.getByRole('dialog').getByRole('heading', { name: 'Story' })
        .waitFor({ timeout: 5_000 });

      // Never stacked: an overlay above an overlay gives two Close buttons and
      // an ambiguous Escape, for context the header already names.
      expect(await page.getByRole('dialog').count()).toBe(1);
      expect(await page.getByRole('button', { name: 'Close' }).count()).toBe(1);
      // The plan modal is gone, not merely behind it.
      expect(await page.getByRole('heading', { name: 'Plan', exact: true }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('the story badge on a card is a real link to the story route', async () => {
    const page = await openBoard();
    try {
      // The badge NAMES the story at triage time; the modal button is where you
      // GO. Both exist — this is the naming half, and it must still be a real
      // anchor so cmd-click and "copy link address" behave.
      const badge = page
        .locator('article', { hasText: 'Net the strawberry bed' })
        .getByRole('link', { name: 'berry-patch' });
      await badge.waitFor({ timeout: 10_000 });
      expect(await badge.getAttribute('href')).toBe('/story/berry-patch');

      await badge.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });
      expect(await dialog.getByRole('heading', { name: 'Story' }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('a swimlane row header opens its story — the other place one is named', async () => {
    const page = await openBoard();
    try {
      // The lane view names a story as a ROW HEADER, which led nowhere for the
      // same reason the badge did. Both now point at the story's own file.
      await page.getByLabel('Story lanes').check();
      const header = page.getByRole('link', { name: 'Berry patch' });
      await header.waitFor({ timeout: 10_000 });
      expect(await header.getAttribute('href')).toBe('/story/berry-patch');

      await header.click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });
      expect(await dialog.getByRole('heading', { name: 'Story' }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('a lane naming a story with no file is plain text, not a link', async () => {
    const page = await openBoard();
    try {
      // `orphan-bed` gets its own lane — dropping it would make work vanish —
      // but the header names no artefact, so it links to none.
      await page.getByLabel('Story lanes').check();
      await expect.poll(() => page.getByText('orphan-bed').count()).toBeGreaterThan(0);
      expect(await page.getByRole('link', { name: 'orphan-bed' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('`Show in board` from the story overlay filters the board to that story', async () => {
    const page = await openBoard();
    try {
      await openNettingPlan(page);
      await page.getByRole('dialog').getByRole('button', { name: 'Open story' }).click();
      await page.getByRole('dialog').getByRole('heading', { name: 'Story' })
        .waitFor({ timeout: 5_000 });
      await page.getByRole('dialog').getByRole('button', { name: 'Show in board' }).click();

      await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
      // The filter IS the landing for a story — it is not one card, so there is
      // no single card to highlight.
      await expect.poll(() => new URL(page.url()).searchParams.get('story')).toBe('berry-patch');
      // Only the story's two plans remain on the board.
      await expect.poll(() => page.locator('article').count()).toBe(2);
    } finally {
      await page.close();
    }
  });

  it('a plan opened from the story overlay replaces it in turn', async () => {
    const page = await openBoard();
    try {
      await openNettingPlan(page);
      await page.getByRole('dialog').getByRole('button', { name: 'Open story' }).click();
      await page.getByRole('dialog').getByRole('heading', { name: 'Story' })
        .waitFor({ timeout: 5_000 });

      // The way back is the same click in reverse, and it stacks no further
      // than the way out did.
      await page.getByRole('dialog')
        .getByRole('button', { name: 'Write a compost-turning guide' }).click();
      await page.getByRole('dialog').getByRole('heading', { name: 'Plan', exact: true })
        .waitFor({ timeout: 5_000 });
      expect(await page.getByRole('dialog').count()).toBe(1);
    } finally {
      await page.close();
    }
  });
});
