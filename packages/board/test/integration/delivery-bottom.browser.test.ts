import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, fleet as buildFleet, scenario, type Catalogue } from '../catalogue/index.js';
import { type Fleet } from '../../src/contract/schema.js';

/**
 * THE BOTTOM OF THE DELIVERY TAB: the Tickets card and the footer line, styled by `delivery-bottom.css`.
 *
 * The screenshot test proves the stylesheet loads. These assertions prove its rules reach real
 * elements over any utility left on them, at 1280 px and at 320 px.
 */
describe('the Tickets card and the footer line (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (width: number, over: Partial<Fleet> | null = null): Promise<Page> => {
    const opts = { tab: 'agents', viewport: { width, height: 900 }, colorScheme: 'dark' as const };
    const page = over === null
      ? await cat.open('every-delivery-section', opts)
      : await cat.open('every-delivery-section', {
        ...opts,
        over: { fleet: buildFleet({ ...envelope(), ...over } as unknown as Partial<Fleet>) },
      });
    await page.locator('section#tickets').waitFor({ timeout: 15_000 });
    return page;
  };

  /** The scenario's fleet with its derived fields removed, so `buildFleet` derives them again. */
  const envelope = () => {
    const { agents: _a, summary: _s, ...rest } = scenario('every-delivery-section').fleet;
    return rest;
  };

  /** The computed colour a token resolves to on this page. */
  const tokenColour = (page: Page, token: string) => page.evaluate((t) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);

  it('draws the Do cell in --hue-blue and the footer rule in --card-border', async () => {
    const page = await open(1280);
    try {
      const doCell = page.locator('section#tickets [data-tickets-do]').first();
      await doCell.waitFor({ timeout: 10_000 });
      expect(await doCell.evaluate((el) => getComputedStyle(el).color)).toBe(await tokenColour(page, '--hue-blue'));
      expect(await doCell.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('600');
      const footer = page.locator('[data-footer-line]');
      expect(await footer.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(await tokenColour(page, '--card-border'));
      expect(await footer.evaluate((el) => getComputedStyle(el).display)).toBe('flex');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('makes Tickets a card with its four column headers shown at 1280 px', async () => {
    const page = await open(1280);
    try {
      const section = page.locator('section#tickets');
      expect(await section.evaluate((el) => el.classList.contains('delivery-card'))).toBe(true);
      expect(await section.locator('.delivery-head [data-delivery-section="tickets"]').count()).toBe(1);
      const headers = section.getByRole('columnheader');
      await expect.poll(() => headers.count()).toBe(4);
      expect(await headers.first().isVisible()).toBe(true);
      const lefts = await section.evaluate((el) => {
        const head = [...el.querySelectorAll('[role="columnheader"]')].map((c) => Math.round(c.getBoundingClientRect().left));
        const row = [...(el.querySelector('[data-issue-row]')?.querySelectorAll('[role="gridcell"]') ?? [])].map((c) => Math.round(c.getBoundingClientRect().left));
        return { head, row };
      });
      expect(lefts.row).toEqual(lefts.head);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('hides the header row at 320 px, stacks the cells and keeps the footer from scrolling', async () => {
    const page = await open(320);
    try {
      const section = page.locator('section#tickets');
      expect(await section.getByRole('columnheader').first().isVisible()).toBe(false);
      const tops = await section.locator('[data-issue-row]').first().evaluate((row) =>
        [...row.querySelectorAll('[role="gridcell"]')].map((c) => Math.round(c.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(tops.length);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      const footer = page.locator('[data-footer-line]');
      expect(await footer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const inside = await footer.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('[data-freshness]')].every((e) => {
          const r = e.getBoundingClientRect();
          return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
        });
      });
      expect(inside).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('keeps a Tickets section that is not rows a card with its title and one sentence', async () => {
    const page = await open(1280, { issueAnswer: 'failed', issues: [] } as Partial<Fleet>);
    try {
      const section = page.locator('section#tickets');
      await expect.poll(() => section.getAttribute('data-tickets-state')).toBe('failed');
      expect(await section.evaluate((el) => el.classList.contains('delivery-card'))).toBe(true);
      expect(await section.locator('[data-delivery-section="tickets"]').innerText()).toContain('Tickets');
      expect(await section.locator('[data-tickets-absent]').count()).toBe(1);
      expect(await section.locator('ul').count()).toBe(0);
      expect(await section.locator('[data-tickets-header]').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});
