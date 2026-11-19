import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, scenario, type Catalogue } from '../catalogue/index.js';
import type { Fleet } from '../../src/contract/schema.js';

/**
 * THE FLEET SECTION DRAWS FROM `delivery-fleet.css`, in a real browser against the shipped artifact.
 *
 * `every-delivery-section` with run bounds and start times added, so one Working
 * agent has most of its bound left (a green bar), one has under 20 % left (a red
 * bar), and the waiting agent sits in Blocked. Each assertion compares a computed
 * colour with the token's own computed colour, read from a probe element, so a
 * Tailwind utility left on the element fails it.
 */

const HOUR = 3_600_000;
const BOUND_SECONDS = 8 * 3600;

const fleetWithBars = (): Fleet => {
  const base = scenario('every-delivery-section').fleet;
  const now = Date.now();
  const startedAgo: Record<string, number> = { 's-rain-barrel': 1 * HOUR, 's-seed-trays': 7.5 * HOUR, 's-which-mulch': 1 * HOUR };
  return {
    ...base,
    bounds: { worker: BOUND_SECONDS, reviewer: 3600, fixer: 3600 },
    agents: (base.agents ?? []).map((a) =>
      startedAgo[a.session] === undefined ? a : { ...a, startedAt: new Date(now - startedAgo[a.session]!).toISOString() }),
  };
};

/** The computed background of `selector`'s first match. */
const background = (page: Page, selector: string): Promise<string> =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);

/** The computed colour a token resolves to, read from a probe element painted with it. */
const token = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => {
    const probe = document.createElement('span');
    probe.style.background = `var(${n})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, name);

describe('the Fleet section in the mockup look (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (colorScheme: 'light' | 'dark'): Promise<Page> => {
    const page = await cat.open('every-delivery-section', {
      tab: 'agents',
      over: { fleet: fleetWithBars() },
      viewport: { width: 1280, height: 900 },
      colorScheme,
    });
    await page.locator('[data-section="fleet"] [data-fleet-agent-row]').first().waitFor({ timeout: 10_000 });
    return page;
  };

  for (const scheme of ['light', 'dark'] as const) {
    it(`colours a Working row's dot green and a Blocked row's dot amber in ${scheme}`, async () => {
      const page = await open(scheme);
      try {
        const working = '[data-section="fleet"] [data-group="working"] [data-agent-cell="agent"] .delivery-dot';
        const blocked = '[data-section="fleet"] [data-group="blocked"] [data-agent-cell="agent"] .delivery-dot';
        expect(await background(page, working)).toBe(await token(page, '--hue-green-dot'));
        expect(await background(page, blocked)).toBe(await token(page, '--hue-amber-dot'));
        expect(await token(page, '--hue-green-dot')).not.toBe(await token(page, '--hue-amber-dot'));
        expect(await page.locator(working).first().getAttribute('aria-hidden')).toBe('true');
      } finally {
        await page.close();
      }
    });

    it(`fills a red bar with --hue-red-dot and a green one with --hue-green-dot in ${scheme}`, async () => {
      const page = await open(scheme);
      try {
        const red = '[data-section="fleet"] [data-time-left-red="true"] > [data-time-left-fill]';
        const green = '[data-section="fleet"] [data-time-left-red="false"] > [data-time-left-fill]';
        await page.locator(red).first().waitFor({ timeout: 10_000 });
        const redFill = await background(page, red);
        const greenFill = await background(page, green);
        expect(redFill).toBe(await token(page, '--hue-red-dot'));
        expect(greenFill).toBe(await token(page, '--hue-green-dot'));
        expect(redFill).not.toBe(greenFill);
        expect(await background(page, '[data-section="fleet"] [data-time-left-bar]')).toBe(await token(page, '--card-track'));
      } finally {
        await page.close();
      }
    });
  }

  it('keeps the fleet card switches disabled and faded, and the Fleet header switches live', async () => {
    const page = await open('light');
    try {
      await page.locator('[data-fleet-card]').waitFor({ timeout: 10_000 });
      const card = page.locator('[data-fleet-card-auto-switch]').first();
      const live = page.locator('[data-fleet-auto-switch]').first();
      expect(await card.isDisabled()).toBe(true);
      expect(await live.isDisabled()).toBe(false);
      const opacity = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).opacity);
      expect(Number(await opacity('[data-fleet-card-auto-switch]'))).toBeLessThan(1);
      expect(await opacity('[data-fleet-auto-switch]')).toBe('1');
    } finally {
      await page.close();
    }
  });

  it('wraps the Fleet header switches at 320 px with no horizontal scroll', async () => {
    const page = await cat.open('every-delivery-section', {
      tab: 'agents',
      over: { fleet: fleetWithBars() },
      viewport: { width: 320, height: 900 },
      colorScheme: 'dark',
    });
    try {
      const column = page.locator('[data-fleet-control-column]');
      await column.waitFor({ timeout: 10_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      const tops = await column.evaluate((el) => [...el.children].map((c) => Math.round(c.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBeGreaterThan(1);
    } finally {
      await page.close();
    }
  });
});
