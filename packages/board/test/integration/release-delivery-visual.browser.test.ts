import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';

/**
 * THE RELEASE SECTION'S COLOURS AND TABLE, READ FROM THE SHIPPED ARTIFACT.
 *
 * `every-delivery-section` opens at 1280, 639 and 320 px. A Done line's state word
 * takes `--hue-green` and a blocked count takes `--hue-red`, each resolved on the
 * page; the plan table's header row shows from 640 px up and is hidden below, where
 * a row's cells stack; and the page has no horizontal scroll at 320 px.
 */

const RELEASE = '[data-section="release-delivery"]';

describe('the Release section matches its mockups (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  });

  afterAll(async () => {
    await cat?.close();
  });

  const openAt = async (width: number): Promise<Page> => {
    const page = await cat.open('every-delivery-section', { tab: 'agents', viewport: { width, height: 900 }, colorScheme: 'light' });
    await page.locator(`${RELEASE} [data-plan-row]`).first().waitFor({ timeout: 10_000 });
    return page;
  };

  /** The computed colour a token resolves to, read through a probe element. */
  const tokenColour = (page: Page, token: string) => page.evaluate((t) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${t})`;
    document.querySelector('[data-section="release-delivery"]')!.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);

  it('colours a Done line green and a blocked count red', async () => {
    const page = await openAt(1280);
    try {
      await page.locator(`${RELEASE} [data-plan-toggle="bed-a"]`).click();
      const word = page.locator(`${RELEASE} [data-plan-row="bed-a"] [data-plan-line="done"] [data-plan-line-state]`).first();
      await word.waitFor({ timeout: 5_000 });
      expect(await word.textContent()).toBe('✓ merged');
      expect(await word.evaluate((n) => getComputedStyle(n).color)).toBe(await tokenColour(page, '--hue-green'));
      const blocked = page.locator(`${RELEASE} [data-release-header-count="blocked"] b`).first();
      expect(await blocked.evaluate((n) => getComputedStyle(n).color)).toBe(await tokenColour(page, '--hue-red'));
    } finally {
      await page.close();
    }
  });

  it('shows the table header at 1280 px', async () => {
    const page = await openAt(1280);
    try {
      expect(await page.locator(`${RELEASE} [data-plan-thead]`).first().isVisible()).toBe(true);
      expect(await page.locator(`${RELEASE} [data-plan-thead] [role="columnheader"]`).allTextContents()).toEqual(['Plan', 'Phase', 'Slices', 'Owner']);
    } finally {
      await page.close();
    }
  });

  it('hides the table header at 639 px and stacks the plan cell above the slices', async () => {
    const page = await openAt(639);
    try {
      expect(await page.locator(`${RELEASE} [data-plan-thead]`).first().isVisible()).toBe(false);
      const row = page.locator(`${RELEASE} [data-plan-row]`).first();
      const toggle = (await row.locator('[data-plan-toggle]').boundingBox())!;
      const strip = (await row.locator('[data-plan-strip]').boundingBox())!;
      expect(strip.y).toBeGreaterThanOrEqual(toggle.y + toggle.height);
    } finally {
      await page.close();
    }
  });

  it('has no horizontal scroll at 320 px', async () => {
    const page = await openAt(320);
    try {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    } finally {
      await page.close();
    }
  });
});
