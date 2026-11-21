import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, fleet as buildFleet, scenario, type Catalogue } from '../catalogue/index.js';
import { type Fleet } from '../../src/contract/schema.js';

/**
 * The Tickets section: header, five rows, a fold and the show all control, as the shipped artifact renders them.
 * Counts and labels are asserted in `tickets-section.test.ts`; this proves they reach the screen and that the folds are keyboard-operable buttons.
 */
const ME = 'gardener';
const THEM = 'neighbour';
const source = { service: 'github', match: 'host-login' as const };

const ticket = (number: number, title: string, assignees: string[], extra: Record<string, unknown> = {}) => ({
  kind: 'ticket' as const, number: String(number), title, url: '', ageMinutes: number,
  status: 'open', statusCategory: 'To Do', assignees, ...extra,
});

describe('the Tickets section (real browser renders the shipped artifact)', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const six = Array.from({ length: 6 }, (_, i) => ticket(i + 1, `Mine ${i + 1}`, [ME]));
  const others = [ticket(601, 'Nobody\'s ticket', []), ticket(602, 'Neighbour\'s ticket', [THEM])];

  const open = async () => {
    const { agents: _a, summary: _s, ...envelope } = scenario('ten-rows-one-kind-each').fleet;
    const fleet = buildFleet({
      ...envelope,
      issueAnswer: 'answered',
      issues: [...six, ...others],
      waiting: { tickets: six, shown: 6, hidden: 2, unassigned: 1, assignedToOthers: 1, complete: true, notice: null, source },
    } as unknown as Partial<Fleet>);
    const page = await cat.open('ten-rows-one-kind-each', {
      tab: 'agents',
      over: {
        fleet,
        board: buildBoard({
          server: {
            restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME,
            people: { [ME]: ME, [THEM]: THEM },
          },
        }),
      },
    });
    await page.locator('section#tickets').waitFor({ timeout: 15_000 });
    return page;
  };

  it('shows the header, five of six rows and a fold that opens the sixth', async () => {
    const page = await open();
    try {
      const section = page.locator('section#tickets');
      await expect.poll(() => section.locator('[data-tickets-header]').innerText())
        .toContain('6 assigned to you with no plan');
      await expect.poll(() => section.locator('li[data-issue-row]').count()).toBe(5);
      const fold = section.locator('button[data-tickets-fold]');
      await expect.poll(() => fold.innerText()).toBe('… 1 more · show');
      await expect.poll(() => fold.getAttribute('aria-expanded')).toBe('false');
      await fold.click();
      await expect.poll(() => section.locator('li[data-issue-row]').count()).toBe(6);
      await expect.poll(() => fold.getAttribute('aria-expanded')).toBe('true');
    } finally {
      await page.close();
    }
  }, 60_000);

  it.each(['Enter', 'Space'])('both fold buttons answer %s and flip aria-expanded', async (key) => {
    const page = await open();
    try {
      const section = page.locator('section#tickets');
      const keyName = key === 'Space' ? ' ' : 'Enter';
      const showAll = section.locator('button[data-tickets-show-all]');
      await showAll.focus();
      await page.keyboard.press(keyName);
      await expect.poll(() => showAll.getAttribute('aria-expanded')).toBe('true');
      const fold = section.locator('button[data-tickets-fold]');
      await fold.focus();
      await page.keyboard.press(keyName);
      await expect.poll(() => fold.getAttribute('aria-expanded')).toBe('true');
      await page.keyboard.press(keyName);
      await expect.poll(() => fold.getAttribute('aria-expanded')).toBe('false');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('keeps another reader\'s ticket behind show all', async () => {
    const page = await open();
    try {
      const section = page.locator('section#tickets');
      await section.locator('button[data-tickets-fold]').click();
      expect(await section.locator('[data-issue-row="602"]').count()).toBe(0);
      await section.locator('button[data-tickets-show-all]').click();
      await expect.poll(() => section.locator('[data-issue-row="602"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);
});

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

  it('draws each row\'s ⋯ menu in the last cell and the footer rule in --card-border', async () => {
    const page = await open(1280);
    try {
      const row = page.locator('section#tickets [data-issue-row]').first();
      await row.waitFor({ timeout: 10_000 });
      expect(await page.locator('section#tickets [data-tickets-do]').count()).toBe(0);
      expect(await row.evaluate((el) => el.lastElementChild?.getAttribute('data-row-cell'))).toBe('do');
      const trigger = row.locator('[data-row-cell="do"] [data-issue-actions]');
      expect(await trigger.count()).toBe(1);
      expect(await trigger.getAttribute('aria-disabled')).toBe(null);
      // An item that cannot run stays listed, its reason on `data-menu-reason`: this board cannot create plans.
      await trigger.click();
      const createPlan = row.locator('[data-menu-item="create-plan"]');
      await createPlan.waitFor({ timeout: 10_000 });
      expect(await createPlan.getAttribute('aria-disabled')).toBe('true');
      expect(await createPlan.getAttribute('data-menu-reason')).toBe('this board cannot create plans');
      const openIssue = row.locator('[data-menu-item="open-issue"]');
      expect(await openIssue.getAttribute('aria-disabled')).toBe(null);
      expect(await openIssue.locator('a').getAttribute('href')).toBe('https://github.com/tiny/garden/issues/41');
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
