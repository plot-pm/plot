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

  it('shows the You header counts and the phase strip, and a count link reaches its target', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const header = page.locator('h2[data-delivery-section="you"]');
      await header.waitFor({ timeout: 15_000 });
      const line = header.locator('[data-you-header]');
      await line.waitFor({ timeout: 15_000 });
      const counts = await line.locator('[data-you-count]').allInnerTexts();
      expect(counts.length, `counts ${JSON.stringify(counts)}`).toBeGreaterThan(0);
      for (const c of counts.map((t) => t.replace(/^· /, '').trim())) expect(c).toMatch(/^(\d+ (block delivery|inputs the fleet waits for|to clean up|tickets to triage)|tickets to triage: not read)$/);
      const strip = header.locator('[data-phase-strip]');
      await strip.waitFor({ timeout: 15_000 });
      expect(await strip.innerText()).toMatch(/─▶/);
      expect(await strip.locator('[data-phase-strip-entry]').count()).toBeGreaterThan(0);
      const link = header.locator('[data-you-count-link]').first();
      if (await link.count() > 0) {
        const key = await link.getAttribute('data-you-count-link');
        await link.click();
        const target = key === 'tickets' ? '[data-delivery-section="tickets"]' : `[data-group="${key}"][data-link-target]`;
        await page.locator(target).first().waitFor({ state: 'attached', timeout: 5_000 });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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

  it('shows above the cards, marks every line in words, and its links scroll to the row and the Tickets section', async () => {
    const page = await cat.open('a-full-estate', { tab: 'agents' });
    try {
      const list = page.locator('[data-todo-list]');
      await list.waitFor({ timeout: 15_000 });
      const [listY, cardY] = await Promise.all([
        list.evaluate((el) => el.getBoundingClientRect().top + window.scrollY),
        page.locator('[data-delivery-section]').first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY),
      ]);
      expect(listY).toBeLessThan(cardY);
      const lines = page.locator('[data-todo-line]');
      const n = await lines.count();
      for (let i = 0; i < n; i++) {
        expect(await lines.nth(i).locator('[data-todo-marker]').innerText()).toMatch(/^(blocks delivery|input|clean up)$/);
      }
      if (n > 0) {
        await lines.first().locator('[data-todo-name]').click();
        expect(await page.locator('[data-section="you"]').first().isVisible()).toBe(true);
      }
      await page.locator('[data-todo-triage-link]').click();
      await page.locator('#tickets').waitFor({ state: 'attached', timeout: 5_000 });
      await page.setViewportSize({ width: 320, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);
});
