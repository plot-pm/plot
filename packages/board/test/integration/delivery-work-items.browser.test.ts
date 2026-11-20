import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';

/**
 * THE WORK ITEMS SECTION'S LOOK — what `delivery-work-items.css` computes on
 * real Work items elements of `every-delivery-section`.
 *
 * The screenshot test proves the file loads; this proves its rules beat the
 * utilities on the same elements. `feature/rain-barrel` is At a gate with CI
 * pending, so its CI mark is the real element each outcome is read on. The
 * markup half — which outcome each mark carries — is asserted without a browser
 * in `test/unit/delivery-row-cell.test.ts`.
 */
describe('the Work items section in the mockup look (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;
  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (colorScheme: 'light' | 'dark'): Promise<Page> => {
    const page = await cat.open('every-delivery-section', { tab: 'agents', viewport: { width: 1280, height: 900 }, colorScheme });
    await page.locator('[data-section="work-items"] [data-gate-outcome="pending"]').first().waitFor({ timeout: 15_000 });
    return page;
  };

  for (const scheme of ['light', 'dark'] as const) {
    it(`colours each gate outcome from its token in ${scheme}`, async () => {
      const page = await open(scheme);
      try {
        const read = await page.locator('[data-section="work-items"] [data-gate-outcome="pending"]').first().evaluate((mark) => {
          const section = mark.closest('[data-section="work-items"]')!;
          const token = (name: string) => {
            const probe = document.createElement('span');
            probe.style.color = `var(${name})`;
            section.appendChild(probe);
            const value = getComputedStyle(probe).color;
            probe.remove();
            return value;
          };
          const was = mark.getAttribute('data-gate-outcome')!;
          const colours: Record<string, string> = {};
          for (const outcome of ['pass', 'pending', 'fail', 'none']) {
            mark.setAttribute('data-gate-outcome', outcome);
            colours[outcome] = getComputedStyle(mark).color;
          }
          mark.setAttribute('data-gate-outcome', was);
          return {
            colours,
            tokens: { pass: token('--hue-green'), pending: token('--hue-amber'), fail: token('--hue-red'), none: token('--card-meta') },
          };
        });
        expect(read.colours).toEqual(read.tokens);
        expect(new Set(Object.values(read.colours)).size).toBe(4);
      } finally {
        await page.close();
      }
    });
  }

  it('draws the PR and its branch as one tuple in the Where cell, the branch in the muted colour', async () => {
    const page = await open('dark');
    try {
      const where = page.locator('[data-section="work-items"] [data-row-cell="where"]')
        .filter({ has: page.locator('[data-tuple-link="pr"]') })
        .filter({ has: page.locator('[data-tuple-link="branch"]') })
        .first();
      const read = await where.evaluate((cell) => {
        const prLink = cell.querySelector('[data-tuple-link="pr"]')!;
        const pr = prLink.getBoundingClientRect();
        const branch = cell.querySelector('[data-tuple-link="branch"]')!;
        const sameTuple = prLink.closest('[data-link-tuple]') !== null && prLink.closest('[data-link-tuple]') === branch.closest('[data-link-tuple]');
        const probe = document.createElement('span');
        probe.style.color = 'var(--card-meta)';
        cell.appendChild(probe);
        const meta = getComputedStyle(probe).color;
        probe.remove();
        return { sameTuple, prTop: pr.top, prRight: pr.right, branch: branch.getBoundingClientRect(), colour: getComputedStyle(branch).color, meta };
      });
      // One tuple: the branch is the PR's next segment, on the same line and to its right.
      expect(read.sameTuple).toBe(true);
      expect(read.branch.top).toBeCloseTo(read.prTop, 0);
      expect(read.branch.left).toBeGreaterThanOrEqual(read.prRight);
      expect(read.colour).toBe(read.meta);
    } finally {
      await page.close();
    }
  });
});
