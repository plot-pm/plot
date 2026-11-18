import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';

/** THE TO-DO LIST — what is seen. Order, counts and wording are asserted in `todo-list.test.ts` of the domain. */
describe('the Delivery tab renders the to-do list', () => {
  let cat: Catalogue;
  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

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
