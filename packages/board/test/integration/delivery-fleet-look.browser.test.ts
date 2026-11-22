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

  it('shows the header Fleet marks as text, and the Fleet section switches live', async () => {
    const page = await open('light');
    try {
      await page.locator('[data-tab-header] [data-header-marks]').waitFor({ timeout: 10_000 });
      expect(await page.locator('[data-tab-header] [data-header-mark]').count()).toBeGreaterThan(0);
      expect(await page.locator('[data-tab-header] input, [data-tab-header] [role="spinbutton"]').count()).toBe(0);
      const live = page.locator('[data-fleet-auto-switch]').first();
      expect(await live.isDisabled()).toBe(false);
      expect(await live.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    } finally {
      await page.close();
    }
  });

  it('leads a working agent\'s Doing now with the spinner, and turns one beside the header\'s Fleet label', async () => {
    const page = await open('light');
    try {
      const doing = (group: string) => page.locator(`[data-section="fleet"] [data-group="${group}"] [data-agent-cell="doing"]`).first();
      await expect.poll(() => doing('working').locator('[data-activity-spinner]').count()).toBe(1);
      const spinner = doing('working').locator('[data-activity-spinner]');
      expect(await spinner.isVisible()).toBe(true);
      expect(await spinner.evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe('activity-spinner');
      // A blocked agent keeps the slot, empty, so its text starts where a working one's does.
      expect(await doing('blocked').locator('[data-activity-spinner]').count()).toBe(0);
      const slotWidth = (group: string) => doing(group).locator('[data-activity-slot]').evaluate((el) => el.getBoundingClientRect().width);
      expect(await slotWidth('blocked')).toBe(await slotWidth('working'));
      const label = page.locator('[data-tab-header] [data-header-group="fleet"] [data-activity-spinner]');
      await expect.poll(() => label.count()).toBe(1);
      expect(await label.isVisible()).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('renders one row per agent, says a free loop waits for a slice, and lists the agents not working', async () => {
    const base = fleetWithBars();
    const stopped = (session: string, branch: string, state: string) =>
      ({ ...base.agents![0]!, session, branch, worktree: `/wt/desk-${session}`, state, startedAt: '' });
    const page = await cat.open('every-delivery-section', {
      tab: 'agents',
      over: {
        fleet: {
          ...base,
          agents: [...base.agents!, stopped('gone1', 'feature/old-a', 'stalled'), stopped('gone2', 'feature/old-b', 'elsewhere')],
          registry: { directory: '/very/long/path/to/the/agent/registry', manifestCount: 3, synthesizedCount: 14, checkoutCount: 0, unreadCount: 0 },
        } as Fleet,
      },
      viewport: { width: 1280, height: 900 },
    });
    try {
      const fleet = page.locator('[data-section="fleet"]');
      await fleet.locator('[data-fleet-agent-row]').first().waitFor({ timeout: 10_000 });
      // No Free line naming full ids, and no second row per agent.
      expect(await page.locator('[data-free-line]').count()).toBe(0);
      expect(await fleet.locator('li[data-agent-row]:not([data-fleet-agent-row])').count()).toBe(0);
      const ids = await fleet.locator('[data-fleet-agent-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-fleet-agent-row')));
      expect(new Set(ids).size).toBe(ids.length);
      // Free starts folded; open it the way a reader does.
      const toggle0 = page.locator('[data-group-toggle="free"]');
      if (await toggle0.count() > 0 && (await toggle0.getAttribute('aria-expanded')) === 'false') await toggle0.click();
      const free = fleet.locator('[data-group="free"] [data-fleet-agent-row]');
      await free.first().waitFor({ timeout: 5_000 });
      expect(await free.first().locator('[data-agent-cell="doing"]').innerText()).toContain('waiting for a slice');
      expect(await free.first().locator('[data-agent-cell="agent"]').innerText()).not.toContain('agent:');
      // The not-working count opens a list inside the card: desk, branch, why.
      const toggle = fleet.locator('[data-fleet-working]');
      expect((await toggle.innerText()).trim()).toBe('· 2 not working ▸');
      await toggle.click();
      const entries = fleet.locator('[data-fleet-not-working] [data-fleet-not-working-entry]');
      await expect.poll(() => entries.count()).toBe(2);
      expect(await entries.nth(0).getAttribute('data-fleet-not-working-entry')).toBe('stalled');
      expect(await entries.nth(0).innerText()).toContain('feature/old-a');
      expect(await entries.nth(1).getAttribute('data-fleet-not-working-entry')).toBe('gone');
      // The registry reads as one plain fact, and nothing overflows the card.
      expect((await fleet.locator('[data-fleet-registry-fact]').innerText()).trim()).toBe('· 14 of 17 agents have no registry file');
      expect(await page.locator('[data-fleet-details]').count()).toBe(0);
      const card = await fleet.boundingBox();
      const list = await fleet.locator('[data-fleet-not-working]').boundingBox();
      expect(list!.x).toBeGreaterThanOrEqual(card!.x);
      expect(list!.x + list!.width).toBeLessThanOrEqual(card!.x + card!.width + 1);
    } finally {
      await page.close();
    }
  });

  it('names desks whose state nobody read in their own amber sentence, and counts none of them as not working', async () => {
    const base = fleetWithBars();
    const unread = (n: number) =>
      ({ ...base.agents![0]!, session: '', identity: 'synthesized', branch: '', worktree: `/wt/hand-${n}`, state: 'unknown', startedAt: '' });
    const page = await cat.open('every-delivery-section', {
      tab: 'agents',
      over: {
        fleet: {
          ...base,
          agents: [...base.agents!, unread(1), unread(2), unread(3)],
          registry: { directory: '/reg', manifestCount: 3, synthesizedCount: 3, checkoutCount: 0, unreadCount: 3 },
        } as Fleet,
      },
      viewport: { width: 1280, height: 900 },
    });
    try {
      const fleet = page.locator('[data-section="fleet"]');
      const sentence = fleet.locator('[data-fleet-registry-unread]');
      await sentence.waitFor({ timeout: 10_000 });
      expect((await sentence.innerText()).trim()).toBe('· the board could not read the state of 3 worktrees');
      expect(await sentence.evaluate((el) => el.classList.contains('delivery-text-warn'))).toBe(true);
      expect(await fleet.locator('[data-fleet-registry-fact]').count()).toBe(0);
      expect(await fleet.locator('[data-fleet-working]').count()).toBe(0);
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
