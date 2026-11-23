import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { expandAgentFolds } from '../helpers.mjs';

/**
 * THE DELIVERY TAB, SECTION BY SECTION, IN BOTH THEMES.
 *
 * Every section of `every-delivery-section` opens in light and in dark at
 * 1280 px and in one theme at 320 px. Each run asserts that the section renders,
 * that the page has no horizontal scroll at 320 px, and that each stylesheet
 * `index.css` imports reached the built CSS. Where `PLOT_SCREENSHOT_DIR` is set,
 * it writes `<section>-light.png`, `<section>-dark.png` and `<section>-320.png`
 * there, and renders each mockup the section names to `<section>-mock-<n>.png`.
 * The Release group names the sprint only under the «My sprint» chip, which also narrows You,
 * Work items and the release section to the sprint, so the 1280 px runs shoot
 * every section unfiltered and then `header-my-sprint-<theme>.png` with the chip on.
 */

const MOCKUPS = fileURLToPath(new URL('../../../../docs/superpowers/specs/2026-11-16-delivery-tab-mockups/', import.meta.url));
const OUT = process.env.PLOT_SCREENSHOT_DIR ?? '';

type Section = {
  /** The file-name stem of the section's images. */
  name: string;
  /** The elements the section's image covers; the image is their union box. */
  selectors: readonly string[];
  /** The mockup files the section is compared with. */
  mockups: readonly string[];
};

const SECTIONS: readonly Section[] = [
  { name: 'header', selectors: ['[data-tab-header]'], mockups: ['first-five-seconds-v2.html', 'you-section-v2.html'] },
  { name: 'release', selectors: ['[data-section="release-delivery"]'], mockups: ['delivery-toggle-icons-v2.html', 'plan-slices.html'] },
  { name: 'you', selectors: ['[data-section="you"]'], mockups: ['you-section-v2.html', 'section-header.html'] },
  { name: 'work-items', selectors: ['[data-section="work-items"]'], mockups: ['work-items-v1.html'] },
  { name: 'fleet', selectors: ['[data-section="fleet"]'], mockups: ['fleet-section-v3.html'] },
  { name: 'bottom', selectors: ['[data-section="machine"]', '[data-section="tickets"]', '[data-footer-line]'], mockups: ['bottom-of-tab.html'] },
  { name: 'tab', selectors: ['main'], mockups: ['section-header.html'] },
];

/** The rule each stylesheet carries, read from the element it styles. */
const STYLESHEETS: ReadonlyArray<readonly [file: string, selector: string, property: string, expected: string]> = [
  ['delivery.css', '[data-section="you"]', 'border-top-left-radius', '8px'],
  ['delivery-header.css', '[data-tab-header]', '--delivery-section', 'header'],
  ['delivery-release.css', '[data-section="release-delivery"]', '--delivery-section', 'release'],
  ['delivery-you.css', '[data-section="you"]', '--delivery-section', 'you'],
  ['delivery-work-items.css', '[data-section="work-items"]', '--delivery-section', 'work-items'],
  ['delivery-fleet.css', '[data-section="fleet"]', '--delivery-section', 'fleet'],
  ['delivery-bottom.css', '[data-footer-line]', '--delivery-section', 'bottom'],
];

describe('the Delivery tab in each theme and at 320 px (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
    if (OUT !== '') mkdirSync(OUT, { recursive: true });
  });

  afterAll(async () => {
    await cat?.close();
  });

  const openDelivery = async (width: number, colorScheme: 'light' | 'dark'): Promise<Page> => {
    const page = await cat.open('every-delivery-section', { tab: 'agents', viewport: { width, height: 900 }, colorScheme });
    await page.locator('[data-section="fleet"]').waitFor({ timeout: 10_000 });
    return page;
  };

  /** The union box of a section's elements, in page coordinates. */
  const boxOf = async (page: Page, section: Section) => {
    const boxes = [];
    for (const selector of section.selectors) {
      const el = page.locator(selector).first();
      await el.waitFor({ timeout: 10_000 });
      await el.scrollIntoViewIfNeeded();
      const box = await el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
      });
      boxes.push(box);
    }
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return {
      x, y,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    };
  };

  const shoot = async (page: Page, section: Section, file: string) => {
    const clip = await boxOf(page, section);
    expect(clip.width).toBeGreaterThan(0);
    expect(clip.height).toBeGreaterThan(0);
    if (OUT !== '') await page.screenshot({ path: join(OUT, file), clip, fullPage: true });
  };

  for (const scheme of ['light', 'dark'] as const) {
    it(`renders every section at 1280 px in ${scheme}`, async () => {
      const page = await openDelivery(1280, scheme);
      try {
        for (const section of SECTIONS) await shoot(page, section, `${section.name}-${scheme}.png`);
        await page.locator('[data-chip="My sprint"]').click();
        await page.locator('[data-release-group-scope="my-sprint"]').waitFor({ timeout: 10_000 });
        await shoot(page, SECTIONS[0], `header-my-sprint-${scheme}.png`);
      } finally {
        await page.close();
      }
    });
  }

  it('renders every section at 320 px with no horizontal scroll', async () => {
    const page = await openDelivery(320, 'dark');
    try {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      for (const section of SECTIONS) await shoot(page, section, `${section.name}-320.png`);
    } finally {
      await page.close();
    }
  });

  it('shows the column-header rows at 1280 px and hides them at 320 px', async () => {
    const wide = await openDelivery(1280, 'light');
    try {
      const header = wide.locator('[data-section="work-items"] [role="row"]').filter({ has: wide.getByRole('columnheader') }).first();
      await expect.poll(() => header.isVisible()).toBe(true);
      expect(await wide.locator('[data-section="work-items"]').getByRole('columnheader', { name: 'Plan' }).first().isVisible()).toBe(true);
    } finally {
      await wide.close();
    }
    const narrow = await openDelivery(320, 'light');
    try {
      expect(await narrow.locator('[data-section="work-items"]').getByRole('columnheader').count()).toBe(0);
    } finally {
      await narrow.close();
    }
  });

  it('loads each Delivery stylesheet into the built CSS', async () => {
    const page = await openDelivery(1280, 'light');
    try {
      for (const [file, selector, property, expected] of STYLESHEETS) {
        const value = await page.locator(selector).first()
          .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p).trim(), property);
        expect(value, `${file}: ${property} on ${selector}`).toBe(expected);
      }
    } finally {
      await page.close();
    }
  });

  /** A token's value as the browser computes a colour, so it compares with `color` and `box-shadow`. */
  const tokenColour = (page: Page, token: string) => page.evaluate((t) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);

  const YOU_GROUPS = [
    { group: 'blocks-delivery', token: '--hue-red' },
    { group: 'input-to-the-fleet', token: '--hue-blue' },
  ] as const;

  for (const scheme of ['light', 'dark'] as const) {
    it(`colours the You groups' tags, row bars and Do triggers from the hue tokens in ${scheme}`, async () => {
      const page = await openDelivery(1280, scheme);
      try {
        await expandAgentFolds(page);
        for (const { group, token } of YOU_GROUPS) {
          const hue = await tokenColour(page, token);
          const scope = page.locator(`[data-section="you"] [data-group="${group}"]`);
          const marker = scope.locator('[data-group-marker]');
          await marker.waitFor({ timeout: 10_000 });
          // The computed colour, not the file: a `text-red-600` that wins leaves the file loaded and the tag wrong.
          expect(await marker.evaluate((el) => getComputedStyle(el).color), `${group} tag`).toBe(hue);

          const rows = scope.locator('[data-delivery-row]');
          expect(await rows.count(), `${group} rows`).toBeGreaterThan(0);
          const shadow = await rows.first().evaluate((el) => getComputedStyle(el).boxShadow);
          expect(shadow, `${group} row bar`).toContain(hue);
          expect(shadow, `${group} row bar`).toContain('3px 0px 0px');

          // A You row's Do cell holds the `⋯` trigger; no You row renders `[data-row-do]`.
          const trigger = scope.locator('[data-row-cell="do"] [aria-haspopup="menu"]:not([aria-disabled])');
          if (group === 'blocks-delivery') expect(await trigger.count(), `${group} Do trigger`).toBeGreaterThan(0);
          if (await trigger.count() > 0) {
            expect(await trigger.first().evaluate((el) => getComputedStyle(el).color), `${group} Do`).toBe(hue);
          }
        }

        // Unblock: a neutral tag and no bar. A rule on `[data-delivery-row]` alone would paint these too.
        const unblock = page.locator('[data-section="you"] [data-group="unblock"]');
        const unblockRows = unblock.locator('[data-delivery-row]');
        expect(await unblockRows.count(), 'unblock rows').toBeGreaterThan(0);
        for (const shadow of await unblockRows.evaluateAll((els) => els.map((el) => getComputedStyle(el).boxShadow))) {
          expect(shadow, 'unblock row bar').toBe('none');
        }
        expect(await unblock.locator('[data-group-marker]').evaluate((el) => getComputedStyle(el).color))
          .toBe(await tokenColour(page, '--card-meta'));

        // The bar stays inside You: no Work items row carries it.
        for (const shadow of await page.locator('[data-section="work-items"] [data-delivery-row]')
          .evaluateAll((els) => els.map((el) => getComputedStyle(el).boxShadow))) {
          expect(shadow, 'work-items row').toBe('none');
        }
      } finally {
        await page.close();
      }
    });
  }

  it.runIf(OUT !== '')('renders each mockup the sections name', async () => {
    const page = await cat.browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
    try {
      for (const section of SECTIONS) {
        for (const [n, mockup] of section.mockups.entries()) {
          await page.setContent(readFileSync(join(MOCKUPS, mockup), 'utf8'), { waitUntil: 'load' });
          await page.screenshot({ path: join(OUT, `${section.name}-mock-${n + 1}.png`), fullPage: true });
        }
      }
    } finally {
      await page.close();
    }
  });
});
