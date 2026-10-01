import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import {
  openCatalogue, board as buildBoard, card as buildCard, column,
  fleet as buildFleet, row as buildRow, slice as buildSlice,
  type Catalogue,
} from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type AgentRow, type Slice } from '../../src/contract/schema.js';

/**
 * A PLAN ROW SHOWS PLAN STATUS ONLY — the DOM half.
 *
 * A plan row's status cell holds the plan's phase, its rounds badge and its PR
 * fold. It never prints a slice's verdict: placed beside the phase, a verdict
 * reads as the plan's status. Measured 2026-10-01 in DONE with every head
 * collapsed: `a-plan-row-names-its-ticket` read `Testing complete`, for a plan
 * delivered and not released.
 *
 * Both plan-head paths are asserted, because they are asymmetric — the trap
 * `folded-plan-pr-fold.browser.test.ts` records costing a fix already:
 *
 *   - the PLAN-GROUP path (NOT STARTED);
 *   - the `planHeads` path (WAITING ON YOU, QUIET, DONE), where a collapsed head
 *     removes the slice row from the page.
 *
 * Where the slice row is on the page it states the verdict when it holds
 * several branches or one branch with no status word; a branch with a word of
 * its own states that word, and then the verdict appears on no row.
 */
const GH = 'https://github.com/tiny/garden/tree/';
const PR = 'https://github.com/tiny/garden/pull/';

const row = (over: Partial<AgentRow> = {}): AgentRow => buildRow({
  repo: 'garden', kind: 'branch', plan: 'a-plan', planFile: '2026-09-30-a-plan.md',
  state: 'open', phase: 'Development', ageMinutes: 30, note: '', pr: null,
  ...over,
} as Parameters<typeof buildRow>[0]);

/** A one-slice plan's slice — `planSliceCount: 1` is what makes it sole. */
const sole = (over: Partial<Slice> = {}): Slice => buildSlice({
  planSliceCount: 1, ...over,
} as Parameters<typeof buildSlice>[0]);

/**
 * SEVEN PLANS, ONE PER CASE, all in one page so every assertion reads the same
 * render. Each plan has exactly ONE slice (`planSliceCount: 1`), the population
 * that used to carry a verdict on its plan row.
 *
 *   DONE, `planHeads`:
 *     `unknown-pr`   one merged branch, `pr.state: 'unknown'` → the slice row
 *                    says the verdict; the plan row says the phase.
 *     `two-branches` a slice of two merged branches → the slice row says
 *                    `2 complete`; the plan row says the phase.
 *
 *   WAITING ON YOU, `planHeads`:
 *     `open-pr`      one branch with an open green PR → the slice row says
 *                    `green`; a green PR folds to nothing, so the plan row says
 *                    the phase alone, with the head open or collapsed.
 *     `pending-pr`   one branch whose PR checks are running → the plan row says
 *                    the `pending` fold and no verdict.
 *     `shut-head`    a `pr.state: 'unknown'` branch, collapsed by the reader
 *                    (`shut:`) → no slice row and no verdict on the plan row.
 *
 *   NOT STARTED, PLAN-GROUP:
 *     `unbegun`      one unbegun eligible branch → the slice row says the
 *                    verdict, and the plan row STILL carries *Start work*.
 *     `all-deferred` every branch deferred → no slice row is drawn, and the
 *                    plan row still says no verdict.
 */
const scenario = () => {
  const rows: AgentRow[] = [
    // ── DONE: the measured defect — one branch whose PR state is `unknown` ──
    row({
      plan: 'unknown-pr', planFile: '2026-09-30-unknown-pr.md',
      branch: 'feature/up-one', wave: 'Only', state: 'merged', group: 'done',
      phase: 'Testing', verdict: 'complete', branchUrl: `${GH}feature/up-one`,
      pr: { number: 1061, url: `${PR}1061`, draft: false, state: 'unknown' },
    }),
    // ── DONE: a slice of TWO branches — `soleRowStatus` is null ──
    row({
      plan: 'two-branches', planFile: '2026-09-30-two-branches.md',
      branch: 'feature/tb-one', wave: 'Both', state: 'merged', group: 'done',
      phase: 'Testing', verdict: 'complete', branchUrl: `${GH}feature/tb-one`,
    }),
    row({
      plan: 'two-branches', planFile: '2026-09-30-two-branches.md',
      branch: 'feature/tb-two', wave: 'Both', state: 'merged', group: 'done',
      phase: 'Testing', verdict: 'complete', branchUrl: `${GH}feature/tb-two`,
    }),
    // ── WAITING ON YOU: an open PR, so the slice row says `green` ──
    row({
      plan: 'open-pr', planFile: '2026-09-30-open-pr.md',
      branch: 'feature/op-one', wave: 'Review', state: 'wip', group: 'waiting-on-you',
      phase: 'Development', note: 'PR #900', verdict: 'blocked',
      branchUrl: `${GH}feature/op-one`,
      pr: { number: 900, url: `${PR}900`, draft: false, state: 'green' },
    }),
    // ── WAITING ON YOU: checks running, so the plan row has a fold to say ──
    row({
      plan: 'pending-pr', planFile: '2026-09-30-pending-pr.md',
      branch: 'feature/pp-one', wave: 'Checks', state: 'wip', group: 'waiting-on-you',
      phase: 'Development', note: 'PR #902', verdict: 'blocked',
      branchUrl: `${GH}feature/pp-one`,
      pr: { number: 902, url: `${PR}902`, draft: false, state: 'pending' },
    }),
    // ── WAITING ON YOU: the COLLAPSED-head case ──
    //
    // `pr.state: 'unknown'` DELIBERATELY: under #1109's rule a collapsed head
    // with an empty slice status was the one case that moved the verdict onto
    // the plan row, so it is the case most likely to bring it back.
    row({
      plan: 'shut-head', planFile: '2026-09-30-shut-head.md',
      branch: 'feature/sh-one', wave: 'Folded', state: 'wip', group: 'waiting-on-you',
      phase: 'Development', note: 'PR #901', verdict: 'blocked',
      branchUrl: `${GH}feature/sh-one`,
      pr: { number: 901, url: `${PR}901`, draft: false, state: 'unknown' },
    }),
    // ── NOT STARTED: one unbegun branch, eligible ──
    row({
      plan: 'unbegun', planFile: '2026-09-30-unbegun.md',
      branch: 'feature/ub-one', wave: 'Start', state: 'open', group: 'not-started',
      phase: 'Development', note: ELIGIBLE_NOTE, verdict: 'eligible',
      waitingDays: 3, branchUrl: `${GH}feature/ub-one`,
    }),
    // ── NOT STARTED: every branch DEFERRED, so no slice row is drawn ──
    row({
      plan: 'all-deferred', planFile: '2026-09-30-all-deferred.md',
      branch: 'feature/ad-one', wave: 'Given up', state: 'deferred', group: 'not-started',
      phase: 'Development', verdict: 'eligible', waitingDays: 4,
      branchUrl: `${GH}feature/ad-one`,
    }),
  ];
  const slices: Slice[] = [
    sole({ plan: 'unknown-pr', name: 'Only', branches: ['feature/up-one'], verdict: 'complete', section: 'done', complete: true }),
    sole({ plan: 'two-branches', name: 'Both', branches: ['feature/tb-one', 'feature/tb-two'], verdict: 'complete', section: 'done', complete: true }),
    sole({ plan: 'open-pr', name: 'Review', branches: ['feature/op-one'], verdict: 'blocked', section: 'not-started' }),
    sole({ plan: 'pending-pr', name: 'Checks', branches: ['feature/pp-one'], verdict: 'blocked', section: 'not-started' }),
    sole({ plan: 'shut-head', name: 'Folded', branches: ['feature/sh-one'], verdict: 'blocked', section: 'not-started' }),
    sole({ plan: 'unbegun', name: 'Start', branches: ['feature/ub-one'], verdict: 'eligible', section: 'not-started' }),
    sole({ plan: 'all-deferred', name: 'Given up', branches: ['feature/ad-one'], verdict: 'eligible', section: 'not-started' }),
  ];
  /**
   * THE CARDS AND THE DISPATCH BINDING, for the *Start work* half.
   *
   * `rows.tsx` gates the plan row's sole-slice action on `verdict === 'eligible'
   * && card && dispatch`, so a scenario with no board serves no card, the gate
   * is false, and a test asserting the control is absent would pass while
   * proving nothing. The cards are Approved rather than Draft to keep the draft
   * acts off — this file's subject is the verdict, not the plan's own acts.
   *
   * A card joins its rows by `path` matching `planFile`, and written twice the
   * two drift: the symptom is a row rendering its plain link instead of opening
   * the card, which is a REAL state and so indistinguishable from the bug.
   *
   * `phase` is a BOARD COLUMN, not the plan's lifecycle state — `CardSchema`
   * admits the five column names and refuses `Approved`, which is the word the
   * State field takes. `Development` is where an approved plan under way sits.
   */
  const cards = [
    'unknown-pr', 'two-branches', 'open-pr', 'pending-pr', 'shut-head', 'unbegun', 'all-deferred',
  ].map((slug) => buildCard({
    slug, title: slug, phase: 'Development', path: `2026-09-30-${slug}.md`,
  }));
  return {
    board: buildBoard({
      columns: [column({ phase: 'Development', cards })],
      dispatch: { available: true, reason: '' },
    }),
    fleet: buildFleet({ rows, slices }),
  };
};

describe('a plan row shows plan status only', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  async function open(): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: scenario(),
      viewport: { width: 1400, height: 2000 },
    });
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    // DONE is folded by default — unfold it, or its rows are not on the page and
    // every assertion about them passes for the wrong reason.
    const done = page.locator('[data-group-toggle]').filter({ hasText: 'Done' });
    if ((await done.getAttribute('aria-expanded')) === 'false') await done.click();
    return page;
  }

  const planRow = (page: Page, plan: string) => page.locator(`li[data-plan-row="${plan}"]`);
  const planVerdict = (page: Page, plan: string) =>
    planRow(page, plan).locator('[data-sole-wave-verdict]');
  const planFold = (page: Page, plan: string) =>
    planRow(page, plan).locator('[data-plan-pr-fold]');
  /** The slice row's status cell, scoped to its plan's slice list. */
  const sliceStatus = (page: Page, plan: string, slice: string) =>
    page.locator(`[data-slice-list="${plan}"] [data-slice-row="${slice}"]`)
      .locator('[data-tuple-status]');

  it('no plan row on the page carries a slice verdict', async () => {
    const page = await open();
    try {
      await planRow(page, 'unknown-pr').waitFor({ timeout: 10_000 });
      // Counted across the whole page, so a third call site added later is held
      // to the rule without a case of its own.
      expect(await page.locator('li[data-plan-row] [data-sole-wave-verdict]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── DONE ────────────────────────────────────────────────────────────────

  it('DONE, an `unknown` PR: the plan row says the phase, the slice row the verdict', async () => {
    const page = await open();
    try {
      await expect.poll(() => sliceStatus(page, 'unknown-pr', 'Only').textContent(),
        { timeout: 10_000 }).toContain('complete');
      expect(await planVerdict(page, 'unknown-pr').count()).toBe(0);
      // Asserted on the text too: an implementation could print the word
      // without the attribute.
      const planText = (await planRow(page, 'unknown-pr').textContent()) ?? '';
      expect(planText).not.toContain('complete');
      expect(await planRow(page, 'unknown-pr').locator('[data-phase]')
        .getAttribute('data-phase')).toBe('Testing');
    } finally {
      await page.close();
    }
  });

  it('DONE, a slice of TWO branches: the verdict is on the slice row only', async () => {
    const page = await open();
    try {
      await expect.poll(() => sliceStatus(page, 'two-branches', 'Both').textContent(),
        { timeout: 10_000 }).toMatch(/2\s+\S/);
      expect(await sliceStatus(page, 'two-branches', 'Both').textContent()).toContain('complete');
      expect(await planVerdict(page, 'two-branches').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── WAITING ON YOU ──────────────────────────────────────────────────────

  it('WAITING ON YOU, a green PR: no verdict on the plan row, head open or collapsed', async () => {
    const page = await open();
    try {
      await expect.poll(() => sliceStatus(page, 'open-pr', 'Review').textContent(),
        { timeout: 10_000 }).toContain('green');
      expect(await planVerdict(page, 'open-pr').count()).toBe(0);
      // A green PR folds to nothing, so the cell holds the phase alone.
      expect(await planFold(page, 'open-pr').count()).toBe(0);
      const toggle = page.locator('[data-slice-toggle="open-pr"]');
      await toggle.waitFor({ timeout: 10_000 });
      if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      expect(await planVerdict(page, 'open-pr').count()).toBe(0);
      expect((await planRow(page, 'open-pr').textContent()) ?? '').not.toContain('blocked');
    } finally {
      await page.close();
    }
  });

  it('WAITING ON YOU, checks running: the plan row says the fold and no verdict', async () => {
    const page = await open();
    try {
      await expect.poll(() => planFold(page, 'pending-pr').getAttribute('data-plan-pr-fold'),
        { timeout: 10_000 }).toBe('pending');
      expect(await planVerdict(page, 'pending-pr').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('WAITING ON YOU, a COLLAPSED head: the verdict goes with the slice row', async () => {
    const page = await open();
    try {
      const toggle = page.locator('[data-slice-toggle="shut-head"]');
      await toggle.waitFor({ timeout: 10_000 });
      if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      await expect.poll(() =>
        page.locator('[data-slice-list="shut-head"] [data-slice-row="Folded"]').count()).toBe(0);
      expect(await planVerdict(page, 'shut-head').count()).toBe(0);
      expect((await planRow(page, 'shut-head').textContent()) ?? '').not.toContain('blocked');
      // Open again: the slice row states the verdict, the plan row still does not.
      await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('true');
      await expect.poll(() =>
        sliceStatus(page, 'shut-head', 'Folded').textContent(),
        { timeout: 10_000 }).toContain('blocked');
      expect(await planVerdict(page, 'shut-head').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── NOT STARTED, the PLAN-GROUP path ────────────────────────────────────

  it('NOT STARTED, an unbegun branch: the verdict is on the slice row, and *Start work* stays on the plan row', async () => {
    const page = await open();
    try {
      const toggle = page.locator('[data-plan-toggle="unbegun"], [data-slice-toggle="unbegun"]').first();
      if (await toggle.count() > 0
        && (await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      await expect.poll(() => sliceStatus(page, 'unbegun', 'Start').textContent(),
        { timeout: 10_000 }).toContain('eligible');
      expect(await planVerdict(page, 'unbegun').count()).toBe(0);
      // `soleSlice` keeps its one job: the slice's *Start work* on the plan row.
      const menu = planRow(page, 'unbegun').locator('[data-plan-actions="unbegun"]');
      await menu.waitFor({ timeout: 5_000 });
      await menu.click();
      await expect.poll(() =>
        page.getByText('Start work', { exact: false }).count(),
        { timeout: 5_000 }).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('NOT STARTED, an ALL-DEFERRED plan: no slice row and no verdict on the plan row', async () => {
    const page = await open();
    try {
      await planRow(page, 'all-deferred').waitFor({ timeout: 10_000 });
      expect(await page.locator('[data-slice-list="all-deferred"] [data-slice-row]').count()).toBe(0);
      expect(await planVerdict(page, 'all-deferred').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
