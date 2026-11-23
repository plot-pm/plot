import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, fleet as buildFleet, scenario, type Catalogue } from '../catalogue/index.js';
import { type Fleet } from '../../src/contract/schema.js';

/**
 * The `⋯` column: every Delivery row's Do cell is its last cell and starts at one x in every section, as the shipped
 * artifact renders it. The scenario's free agent `s-free` has no branch and so no action; the test unfolds the free
 * group, and that agent's Do cell is empty and still holds the x. Every agent with a branch lists the `fleet-agent` items.
 */
const ME = 'gardener';
const SECTIONS = ['you', 'work-items', 'release-delivery', 'fleet', 'tickets'];

type Cell = { section: string; left: number; width: number; empty: boolean; last: boolean };

describe('the ⋯ column (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const open = async (width: number, colorScheme: 'light' | 'dark'): Promise<Page> => {
    const envelope = scenario('every-delivery-section').fleet;
    const { summary: _s, ...rest } = envelope;
    const ticket = { kind: 'ticket' as const, number: '7', title: 'Prune the hedge', url: '', ageMinutes: 5, status: 'open', statusCategory: 'To Do', assignees: [ME] };
    const fleet = buildFleet({
      ...rest,
      issueAnswer: 'answered',
      issues: [ticket],
      waiting: { tickets: [ticket], shown: 1, hidden: 0, unassigned: 0, assignedToOthers: 0, complete: true, notice: null, source: { service: 'github', match: 'host-login' } },
    } as unknown as Partial<Fleet>);
    const page = await cat.open('every-delivery-section', {
      tab: 'agents',
      over: {
        fleet,
        board: buildBoard({ server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME, people: { [ME]: ME } } }),
      },
    });
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width, height: 900 });
    await page.locator('section#tickets [data-issue-row]').waitFor({ timeout: 15_000 });
    const free = page.locator('[data-group-toggle="free"]');
    if (await free.count() > 0 && (await free.getAttribute('aria-expanded')) === 'false') await free.click();
    return page;
  };

  const cells = (page: Page): Promise<Cell[]> =>
    page.evaluate(() => [...document.querySelectorAll('[data-row-cell="do"]')].map((c) => {
      const r = c.getBoundingClientRect();
      return {
        section: c.closest('[data-section]')?.getAttribute('data-section') ?? '',
        left: Math.round(r.left),
        width: Math.round(r.width),
        empty: c.children.length === 0,
        last: c.parentElement?.lastElementChild === c,
      };
    }));

  it.each(['light', 'dark'] as const)('puts the Do cell of every row last, at one x in every section, in %s mode', async (colorScheme) => {
    const page = await open(1280, colorScheme);
    try {
      const all = await cells(page);
      expect([...new Set(all.map((c) => c.section))].sort()).toEqual([...SECTIONS].sort());
      expect(all.filter((c) => !c.last)).toEqual([]);
      expect(all.filter((c) => c.section === 'fleet' && c.empty)).toHaveLength(1);
      expect(new Set(all.map((c) => c.left)).size).toBe(1);
      expect(new Set(all.map((c) => c.width)).size).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);

  it.each(['light', 'dark'] as const)('scrolls no wider than a 320 px viewport in %s mode', async (colorScheme) => {
    const page = await open(320, colorScheme);
    try {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});
