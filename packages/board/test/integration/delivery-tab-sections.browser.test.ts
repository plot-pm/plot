import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openCatalogue, scenario, fleet, row, type Catalogue } from '../catalogue/index.js';

/**
 * THE DELIVERY TAB SHOWS FIVE SECTIONS — what is seen.
 *
 * Where a row lands is decided by `placeDelivery` and asserted in
 * `delivery-view.test.ts` and `delivery-readings.test.ts`. This file proves the
 * result reaches the page: five headings in the layout's order, and one row
 * under each of You, Work items and Fleet.
 */
describe('the Delivery tab renders the five sections', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  it('shows the five headings and a row under You, Work items and Fleet', async () => {
    const base = scenario('a-full-estate');
    // A green PR with a pending review and `Auto-review` off waits for a person.
    const forYou = row({
      branch: 'feature/ready-for-review', plan: 'review-plan', wave: 'Review', group: 'waiting-on-you',
      ageMinutes: 5,
      pr: {
        number: 131, url: 'https://github.com/tiny/garden/pull/131', draft: false, state: 'green',
        ciChecks: 'green', plotReview: 'pending',
      },
    });
    const page = await cat.open('a-full-estate', {
      tab: 'agents',
      over: { fleet: fleet({ ...base.fleet, rows: [...base.fleet.rows, forYou] }) },
    });
    try {
      await page.locator('[data-delivery-section]').first().waitFor({ timeout: 15_000 });
      const headings = await page.locator('[data-delivery-section]').evaluateAll(
        (els) => els.map((el) => el.getAttribute('data-delivery-section')),
      );
      expect(headings).toEqual(['release-delivery', 'you', 'work-items', 'fleet', 'machine', 'tickets']);
      for (const section of ['you', 'work-items', 'fleet']) {
        const rows = page.locator(`[data-section="${section}"] li[data-tuple-kind]`);
        expect(await rows.count(), `a row under ${section}`).toBeGreaterThan(0);
      }
    } finally {
      await page.close();
    }
  }, 60_000);

  it('shows an icon and a count link in a header, and the link reaches its group', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const header = page.locator('h2[data-delivery-section="fleet"]');
      await header.waitFor({ timeout: 15_000 });
      expect(await header.locator('svg[data-section-icon]').count()).toBe(1);
      const link = header.locator('[data-summary-link]').first();
      await link.waitFor({ timeout: 15_000 });
      const key = await link.getAttribute('data-summary-link');
      await link.click();
      await page.locator(`[data-group="${key}"][data-link-target]`).waitFor({ timeout: 5_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('shows Work items counts that link to their group, and a column name under each group', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const header = page.locator('h2[data-delivery-section="work-items"]');
      await header.waitFor({ timeout: 15_000 });
      const link = header.locator('[data-summary-link]').first();
      await link.waitFor({ timeout: 15_000 });
      expect(await link.innerText()).toMatch(/^\d+ [a-z ]+$/);
      const key = await link.getAttribute('data-summary-link');
      await link.click();
      await page.locator(`[data-group="${key}"][data-link-target]`).waitFor({ timeout: 5_000 });
      const names = await page.locator('[data-section="work-items"] [data-column-header]').allTextContents();
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) expect(['Gates', 'Progress', 'Waits on']).toContain(n);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('shows the At a gate cell as one mark per gate', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      await page.locator('[data-delivery-section="work-items"]').waitFor({ timeout: 15_000 });
      const cells = page.locator('[data-section="work-items"] [data-group="at-a-gate"] [data-row-cell="status"]');
      await cells.first().waitFor({ timeout: 15_000 });
      const texts = await cells.allInnerTexts();
      const marked = texts.filter((t) => /CI [✓⟳✗]|review [✓⟳✗–]/.test(t));
      expect(marked.length, `a gate mark among ${JSON.stringify(texts)}`).toBeGreaterThan(0);
      for (const t of marked) expect(t).toMatch(/(CI [✓⟳✗])?( · )?(review [✓⟳✗–])?$/);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('shows a Progress cell and a Waits on cell', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      await page.locator('[data-delivery-section="work-items"]').waitFor({ timeout: 15_000 });
      const cell = (group: string) => page.locator(`[data-section="work-items"] [data-group="${group}"] [data-row-cell="status"]`);
      const built = (await cell('being-built').allInnerTexts()).map((t) => t.trim()).filter((t) => t !== '');
      const queued = (await cell('queued').allInnerTexts()).map((t) => t.trim()).filter((t) => t !== '');
      expect(built.length + queued.length, `cells ${JSON.stringify({ built, queued })}`).toBeGreaterThan(0);
      for (const t of built) expect(t).toMatch(/^(no PR yet|PR open)( · \d+ unpushed)?$/);
      for (const t of queued) expect(t).not.toMatch(/^waits on /);
    } finally {
      await page.close();
    }
  }, 60_000);
});
