import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * A ROW WITH NO PLAN IS NOT A PLAN — what only a rendered page can settle.
 *
 * Measured on Plot 2.20.0: two pushed branches no plan names rendered as
 * `NOT STARTED (1 plan · 2 slices)` under a `PLAN (2)` head with no name. The
 * server now sends such a branch to WAITING ON YOU (`test/unit/
 * branch-with-work-is-seen.test.ts`), and `sectionTally` counts it as its own
 * line (`test/unit/agent-list.test.ts`). This file asserts the render: given
 * plan-less rows in NOT STARTED, no nameless head is drawn and the header
 * counts the lines the reader sees.
 *
 * The rows are STATED in NOT STARTED rather than classified there, because the
 * classifier no longer puts them there. The render guard holds on its own.
 *
 * TWO plan-less rows, not one: a bucket of one never shows the merge. And a
 * real plan with two slices beside them, whose head must not change.
 */
const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: 'Approved', group: 'not-started', ageMinutes: null,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null,
  startability: 'start-work' as const,
  ...over,
});

const planless = (branch: string): AgentRow => row({
  branch, plan: '', planFile: '', wave: '', state: 'wip', phase: null,
  ageMinutes: 5, waitingDays: null, waitingOn: null, startability: null,
  note: 'last commit 5 min ago',
});

const fleet = (): Fleet => {
  const rows: AgentRow[] = [
    row({ plan: 'real-plan', planFile: '2026-09-24-real-plan.md', branch: 'feature/real-one', wave: 'One', verdict: 'eligible' }),
    row({ plan: 'real-plan', planFile: '2026-09-24-real-plan.md', branch: 'feature/real-two', wave: 'Two', verdict: 'eligible' }),
    planless('bug/nobody-planned-this'),
    planless('bug/nor-this'),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 1, waves: 2, branches: rows.length, claimed: 0, eligible: 2, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as Fleet;
};

describe('NOT STARTED draws no plan head for rows no plan names', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  const open = async (): Promise<Page> => {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: fleet() },
      viewport: { width: 1400, height: 1200 },
    });
    await page.getByText('Not started').first().waitFor({ timeout: 10_000 });
    return page;
  };

  const section = (page: Page) => page.locator('ul[role="grid"][aria-label^="Not started"]');

  it('renders no nameless plan head or plan group', async () => {
    const page = await open();
    try {
      await expect.poll(() => section(page).locator('li[data-plan-row="real-plan"]').count()).toBe(1);
      expect(await section(page).locator('li[data-plan-row=""]').count()).toBe(0);
      expect(await section(page).locator('li[data-plan-group=""]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('shows each plan-less branch as its own row', async () => {
    // Not hidden: a pushed branch nobody planned is worth seeing.
    const page = await open();
    try {
      for (const branch of ['bug/nobody-planned-this', 'bug/nor-this']) {
        await expect.poll(() =>
          section(page).locator(`[data-branch="${branch}"]`).count(), { timeout: 5_000 }).toBe(1);
      }
    } finally {
      await page.close();
    }
  });

  it('counts the lines it shows — one plan head plus each plan-less row', async () => {
    // The real plan is one head over two slices; each plan-less row is one line.
    // The bug read `(1 plan · 2 slices)` for the two plan-less rows alone.
    const page = await open();
    try {
      const heading = page.getByRole('heading', { name: /Not started/i }).first();
      await heading.waitFor({ timeout: 5_000 });
      await expect.poll(() => heading.textContent()).toContain('(3 plans · 4 slices)');
    } finally {
      await page.close();
    }
  });
});
