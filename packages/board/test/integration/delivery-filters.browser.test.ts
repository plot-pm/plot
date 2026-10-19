import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, board as buildBoard, expandAgentFolds, type Catalogue } from '../catalogue/index.js';
import { type AgentRow, type Fleet, type FleetSprint } from '../../src/contract/schema.js';

/**
 * ONE CHIP ROW REPLACES THE DELIVERY TAB'S THREE CONTROLS — #2080, measured
 * in a browser.
 *
 * The old control was a sprint card and an `Only my work` checkbox in two
 * visual styles, roughly 200px tall; `DeliveryFilters` renders one row of
 * toggle chips (`This sprint`, `Mine`, `Waiting on me`) plus a sprint line and
 * the estate totals. Every chip's label/on/hiddenCount/disabledReason is a
 * domain property `chipRow()` computes (`@plot-pm/domain`) — this file checks
 * what reaches the DOM, not the rule itself, which `chip-row.test.ts` already
 * covers in the domain package.
 *
 * 375px IS A HARD REQUIREMENT, not a nice-to-have: a `shrink-0` chip caused a
 * real 26px horizontal overflow at this width before the fix. Both widths are
 * asserted from the SAME fixture so a regression that only shows up once rows
 * wrap cannot hide in a desktop-only assertion.
 */
const ME = 'gardener';
const SPRINT = 'the-leg';
const PLAN = 'member-plan';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', kind: 'pr', branch: 'feature/x', plan: PLAN, planFile: '2026-09-01-member-plan.md',
  wave: 'w', state: 'wip', phase: 'Development', group: 'waiting-on-you', ageMinutes: 10,
  waitingOn: 'you', note: 'PR green', pr: null, branchUrl: '', waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, deferredReason: '',
  ...over,
} as unknown as AgentRow);

const pr = (number: number, author: string) =>
  ({ number, url: `https://github.com/tiny/garden/pull/${number}`, draft: false, state: 'green', author });

const sprint: FleetSprint = {
  slug: SPRINT, title: 'The leg', release: 'v1.2', timebox: 'none', timeboxLabel: 'on track',
  counts: { total: 3, open: 1, wip: 1, done: 1, withdrawn: 0 },
  members: [{ slug: PLAN, text: '', tier: 'must', checked: false, known: true }],
} as unknown as FleetSprint;

function fleet(): Fleet {
  const rows: AgentRow[] = [
    row({ branch: 'feature/mine', pr: pr(11, ME) } as Partial<AgentRow>),
    row({ branch: 'feature/theirs', pr: pr(12, 'neighbour') } as Partial<AgentRow>),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows, sprints: [sprint],
    issues: [], issueAnswer: 'answered', issueError: null,
    summary: { plans: 1, waves: 1, branches: rows.length, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    estateTotals: { total: 485, open: 12, wip: 1, done: 458, withdrawn: 14 },
  } as unknown as Fleet;
}

describe('the delivery tab renders one chip row', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  async function open(width: number): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      viewport: { width, height: 900 },
      over: {
        fleet: fleet(),
        board: buildBoard({
          server: { restartCommand: 'pnpm board', port: 4711, branch: 'main', repo: 'garden', hostUser: ME },
        }),
      },
    });
    await page.getByText('Waiting on you').first().waitFor({ timeout: 15_000 });
    await expandAgentFolds(page);
    return page;
  }

  // `data-chip` carries the chip's full label, and Mine's includes the
  // identity once known (`Mine (gardener)`) — a prefix match for that one.
  const chip = (page: Page, label: string) =>
    label === 'Mine' ? page.locator('[data-chip^="Mine"]') : page.locator(`[data-chip="${label}"]`);

  it('shows the chip row, the sprint line and the estate totals at desktop width', async () => {
    const page = await open(1400);
    try {
      await chip(page, 'This sprint').waitFor({ timeout: 15_000 });

      expect(await chip(page, 'This sprint').getAttribute('data-chip-on')).toBe('0');
      expect(await chip(page, 'Mine').getAttribute('data-chip-on')).toBe('0');
      const waitingOnMe = chip(page, 'Waiting on me');
      expect(await waitingOnMe.getAttribute('disabled')).not.toBeNull();

      await chip(page, 'This sprint').click();
      await expect.poll(() => chip(page, 'This sprint').getAttribute('data-chip-on')).toBe('1');
      // A filled chip states its hidden count — one row (`feature/theirs`) sits
      // under a different plan than the sprint names.
      expect(await chip(page, 'This sprint').textContent()).toContain('hidden');

      const sprintLine = page.locator(`[data-sprint-report="${SPRINT}"]`);
      await expect.poll(() => sprintLine.count()).toBe(1);
      const sprintText = (await sprintLine.textContent()) ?? '';
      expect(sprintText).toContain('The leg');
      // Only the sprint's own items — 3 total — never the estate's 485.
      expect(sprintText).toContain('3 items');
      expect(sprintText).not.toContain('485');

      const totals = page.locator('[data-estate-totals]');
      await expect.poll(() => totals.count()).toBe(1);
      expect(await totals.textContent()).toContain('485 plans');
    } finally {
      await page.close();
    }
  });

  it('wraps at 375px with no horizontal scroll', async () => {
    const page = await open(375);
    try {
      await chip(page, 'This sprint').waitFor({ timeout: 15_000 });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      // Every chip still renders — wrapping onto further lines, never
      // dropped, never scrolled off.
      for (const label of ['This sprint', 'Mine', 'Waiting on me']) {
        await expect.poll(() => chip(page, label).count()).toBe(1);
      }
    } finally {
      await page.close();
    }
  });
});
