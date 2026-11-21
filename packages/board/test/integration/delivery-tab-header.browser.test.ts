import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';

/**
 * THE TAB HEADER'S LAYOUT, ONE OF ITS COLOURS AND ITS JUMPS, IN A REAL BROWSER.
 *
 * `delivery-header.css` lays the five groups in one row with a vertical rule
 * between them from 640 px up and stacks them below, and colours a header number
 * by its tone. A utility left on the element would win silently over neither, so
 * both are read as computed boxes and styles from the shipped artifact.
 */

describe('the Delivery tab header (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  });

  afterAll(async () => {
    await cat?.close();
  });

  const openAt = async (width: number): Promise<Page> => {
    const page = await cat.open('every-delivery-section', { tab: 'agents', viewport: { width, height: 900 }, colorScheme: 'dark' });
    await page.locator('[data-tab-header] [data-header-group="machine"]').waitFor({ timeout: 10_000 });
    return page;
  };

  const GROUPS = ['you', 'work-items', 'fleet', 'machine'] as const;

  it('puts the four reading groups side by side at 1280 px, each after a vertical rule', async () => {
    const page = await openAt(1280);
    try {
      const boxes = await Promise.all(GROUPS.map(async (g) => (await page.locator(`[data-header-group="${g}"]`).boundingBox())!));
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].x, GROUPS[i]).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 1);
        expect(Math.abs(boxes[i].y - boxes[0].y), GROUPS[i]).toBeLessThan(1);
      }
      for (const g of GROUPS) {
        expect(await page.locator(`[data-header-group="${g}"]`).evaluate((el) => getComputedStyle(el).borderLeftWidth), g).toBe('1px');
      }
    } finally {
      await page.close();
    }
  });

  it('stacks the groups and scrolls nothing sideways at 320 px', async () => {
    const page = await openAt(320);
    try {
      const boxes = await Promise.all(GROUPS.map(async (g) => (await page.locator(`[data-header-group="${g}"]`).boundingBox())!));
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].y, GROUPS[i]).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    } finally {
      await page.close();
    }
  });

  it('colours a non-zero blocks-delivery number with --hue-red', async () => {
    const page = await openAt(1280);
    try {
      const number = page.locator('[data-header-number="blocks-delivery"]:not([data-count="0"])');
      await number.waitFor({ timeout: 10_000 });
      const [actual, expected] = await number.evaluate((el) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--hue-red)';
        el.parentElement!.appendChild(probe);
        const want = getComputedStyle(probe).color;
        probe.remove();
        return [getComputedStyle(el).color, want];
      });
      expect(actual).toBe(expected);
    } finally {
      await page.close();
    }
  });

  it('has no fold: no aria-expanded and no section toggle inside the header', async () => {
    const page = await openAt(1280);
    try {
      const header = page.locator('[data-tab-header]');
      expect(await header.count()).toBe(1);
      expect(await header.locator('[aria-expanded]').count()).toBe(0);
      expect(await header.getAttribute('aria-expanded')).toBeNull();
      expect(await header.locator('[data-section-toggle], [data-section-head]').count()).toBe(0);
      await header.locator('[data-header-label]').first().click();
      expect(await header.locator('[data-header-group="machine"]').isVisible()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('opens a folded section from open › and marks the section as the link target', async () => {
    const page = await openAt(1280);
    try {
      const toggle = page.locator('[data-section-toggle="work-items"]');
      await toggle.waitFor({ timeout: 10_000 });
      if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      await page.locator('[data-header-open="work-items"]').click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
      await expect.poll(() => page.locator('#delivery-section-work-items').getAttribute('data-link-target')).toBe('');
    } finally {
      await page.close();
    }
  });
});
