import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, row, scenario, type Catalogue } from '../catalogue/index.js';
import type { Fleet } from '../../src/contract/schema.js';

/**
 * EVERY DELIVERY ARTIFACT IS SEEN AS A TUPLE — the four surfaces this slice moved
 * onto `LinkTupleView`: a section header, a Tickets row, the Release group title and a
 * release delivery plan row, on `every-delivery-section`.
 *
 * The segments are asserted without a browser in `test/unit/delivery-tuples.test.ts`;
 * this proves the page draws the bordered tuple with its anchors. The board gains a
 * merged row for `bed-a` that names its plan file, so the release delivery plan row has a plan route to link.
 */
const fleetWithPlanFile = (): Fleet => {
  const base = scenario('every-delivery-section').fleet;
  return {
    ...base,
    rows: [...base.rows, row({
      branch: 'feature/bed-a', plan: 'bed-a', planFile: '2026-11-01-bed-a.md', wave: 'Beds',
      state: 'merged', group: 'done', ageMinutes: 600,
    })],
  };
};

describe('every Delivery artifact is drawn as a link tuple (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;
  beforeAll(async () => { cat = await openCatalogue(); }, 60_000);
  afterAll(async () => { await cat?.close(); });

  const open = async (width = 1280, colorScheme: 'light' | 'dark' = 'light'): Promise<Page> => {
    const page = await cat.open('every-delivery-section', {
      tab: 'agents', over: { fleet: fleetWithPlanFile() }, viewport: { width, height: 900 }, colorScheme,
    });
    await page.locator('[data-section="release-delivery"] [data-plan-row]').first().waitFor({ timeout: 15_000 });
    return page;
  };

  /** The bordered tuples inside `scope`, each as its segment kinds and anchor hrefs. */
  const tuplesIn = (page: Page, scope: string) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} [data-link-tuple]`)].map((t) => ({
    border: getComputedStyle(t).borderTopStyle,
    kinds: [...t.querySelectorAll('[data-tuple-link], [data-tuple-text]')].map((s) => s.getAttribute('data-tuple-link') ?? s.getAttribute('data-tuple-text')),
    hrefs: [...t.querySelectorAll('a[data-tuple-link]')].map((a) => a.getAttribute('href')),
  })), scope);

  it('draws a section header link as a bordered tuple', async () => {
    const page = await open();
    try {
      const tuples = await tuplesIn(page, 'li[data-delivery-link]');
      expect(tuples.length).toBeGreaterThan(0);
      expect(tuples[0].border).toBe('solid');
      expect(tuples[0].hrefs.length).toBeGreaterThan(0);
    } finally { await page.close(); }
  });

  it('draws a Tickets row\'s ticket as a bordered ticket tuple that links to the tracker', async () => {
    const page = await open();
    try {
      const tuples = await tuplesIn(page, 'section#tickets li[data-issue-row]');
      expect(tuples.length).toBeGreaterThan(0);
      expect(tuples[0]).toMatchObject({ border: 'solid', kinds: ['ticket'] });
      expect(tuples[0].hrefs[0]).toMatch(/^https:\/\/github\.com\/tiny\/garden\/issues\/\d+$/);
      expect(await page.locator('section#tickets a[data-issue-link]').count()).toBeGreaterThan(0);
    } finally { await page.close(); }
  });

  it('draws the Release group title as a bordered release tuple, as text because the payload holds no release URL', async () => {
    const page = await open();
    try {
      const tuples = await tuplesIn(page, '[data-release-group-title]');
      expect(tuples).toHaveLength(1);
      expect(tuples[0]).toMatchObject({ border: 'solid', kinds: ['release'], hrefs: [] });
    } finally { await page.close(); }
  });

  it('draws a release delivery plan row\'s plan as a bordered tuple that links to its route', async () => {
    const page = await open();
    try {
      const tuples = await tuplesIn(page, '[data-section="release-delivery"] [data-plan-row]');
      const plan = tuples.find((t) => t.kinds.includes('plan'));
      expect(plan?.border).toBe('solid');
      expect(plan?.hrefs).toContain('/plan/2026-11-01-bed-a.md');
    } finally { await page.close(); }
  });

  for (const scheme of ['light', 'dark'] as const) {
    it(`scrolls no wider than a 320 px viewport in ${scheme}`, async () => {
      const page = await open(320, scheme);
      try {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      } finally { await page.close(); }
    });
  }
});
