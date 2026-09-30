import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import {
  openCatalogue, board as buildBoard, card as buildCard, column,
  fleet as buildFleet, row as buildRow, slice as buildSlice,
  type Catalogue,
} from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type AgentRow, type Slice } from '../../src/contract/schema.js';

/**
 * A PLAN ROW SAYS ITS VERDICT ONCE — the DOM half.
 *
 * `planRowShowsSoleVerdict` is pure and asserted in
 * `test/unit/stuck-display.test.ts`. What only a rendered page settles is that
 * the two call sites hand it the RIGHT inputs — and they are asymmetric, which
 * is the trap `folded-plan-pr-fold.browser.test.ts` records costing a fix
 * already:
 *
 *   - the PLAN-GROUP path (NOT STARTED), where the slice row never carries a
 *     `soleRow` and so always states the verdict, and the only question is
 *     whether a slice row is drawn at all;
 *   - the `planHeads` path (WAITING ON YOU, QUIET, DONE), where the slice row
 *     may state a branch's own status word instead, and where a collapsed head
 *     removes it from the page entirely.
 *
 * Measured 2026-09-30, the defect this ends:
 * `a-cold-bitbucket-board-buys-the-whole-list` (PR #1061) rendered `Testing`
 * `complete` on its plan row and `complete` on its slice row in DONE. The old
 * rule rested on a premise its own docstring stated — *"a plan with one slice
 * renders NO slice row"* — and `AgentList.tsx` made it false.
 *
 * Every case below exists because a naive implementation passes without it.
 * `soleRowStatus: ''` and `null` in particular mean the same thing by two
 * different routes, so an implementation reading `!== null` prints the verdict
 * twice for exactly the measured case.
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
 * SIX PLANS, ONE PER CASE, all in one page so every assertion reads the same
 * render. Each plan has exactly ONE slice (`planSliceCount: 1`), which is the
 * whole population the rule is about.
 *
 *   DONE, `planHeads`:
 *     `unknown-pr`   one merged branch, `pr.state: 'unknown'` → `soleRowStatus`
 *                    is `''`, so the SLICE row says the verdict and the plan row
 *                    must not. THE MEASURED DEFECT.
 *     `two-branches` a slice of two merged branches → `soleRowStatus` is `null`,
 *                    the slice row says `2 complete`, the plan row yields.
 *
 *   WAITING ON YOU, `planHeads`:
 *     `open-pr`      one branch with an open green PR → the slice row says
 *                    `green`, so the PLAN row says the verdict and NO fold.
 *     `shut-head`    the same shape, collapsed by the reader (`shut:`) → no
 *                    slice row on the page, so the plan row keeps the verdict.
 *
 *   NOT STARTED, PLAN-GROUP:
 *     `unbegun`      one unbegun eligible branch → a slice row is drawn and
 *                    states the verdict, so the plan row yields it — while
 *                    STILL carrying *Start work*.
 *     `all-deferred` every branch deferred → `isUnbegun` filters them all out,
 *                    no slice row is drawn, and the plan row keeps the verdict.
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
    // ── WAITING ON YOU: the COLLAPSED-head case ──
    //
    // `pr.state: 'unknown'` DELIBERATELY, so `soleRowStatus` is '' and the fold
    // is the ONLY thing that can put the verdict on the plan row. Given a branch
    // with a word of its own, the verdict would sit there whether the head were
    // folded or not, and the assertion would pass against a `sliceRowVisible`
    // that ignored the `shut:` override entirely — measured, it did.
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
    'unknown-pr', 'two-branches', 'open-pr', 'shut-head', 'unbegun', 'all-deferred',
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

describe('a one-slice plan states its verdict once per section', () => {
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

  // ── DONE, the measured defect ───────────────────────────────────────────

  it('DONE, an `unknown` PR: the verdict is on the SLICE row and nowhere else', async () => {
    const page = await open();
    try {
      // The slice row states it, because `soleRowStatus` is '' — `prStatus`
      // returns the empty string for `unknown` rather than the word *unknown*.
      await expect.poll(() => sliceStatus(page, 'unknown-pr', 'Only').textContent(),
        { timeout: 10_000 }).toContain('complete');
      // And the plan row does NOT. This is the exact shape measured on PR #1061:
      // `Testing complete` over `complete`.
      expect(await planVerdict(page, 'unknown-pr').count()).toBe(0);
      // ONCE ON THE PAGE for this plan — asserted by counting, because an
      // attribute check alone passes for an implementation that prints the word
      // without the attribute.
      const planText = (await planRow(page, 'unknown-pr').textContent()) ?? '';
      expect(planText).not.toContain('complete');
      // The phase still stands beside it — the verdict left, the phase did not.
      expect(await planRow(page, 'unknown-pr').locator('[data-phase]')
        .getAttribute('data-phase')).toBe('Testing');
    } finally {
      await page.close();
    }
  });

  it('DONE, a slice of TWO branches: the verdict is on the slice row only', async () => {
    const page = await open();
    try {
      // `soleRowStatus` is `null` here — there is no single row to ask — and the
      // slice row prints the verdict WITH a count. An implementation reading
      // `soleRowStatus !== null` prints it on the plan row too.
      await expect.poll(() => sliceStatus(page, 'two-branches', 'Both').textContent(),
        { timeout: 10_000 }).toMatch(/2\s+\S/);
      // The word is the slice's own — `2 complete` here. What the rule needs is
      // only that the row states SOMETHING for itself, which is why the function
      // takes `null` rather than the word.
      expect(await sliceStatus(page, 'two-branches', 'Both').textContent()).toContain('complete');
      expect(await planVerdict(page, 'two-branches').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── WAITING ON YOU ──────────────────────────────────────────────────────

  it('WAITING ON YOU, an open PR: the verdict is on the PLAN row and the PR word on the slice row', async () => {
    const page = await open();
    try {
      // The slice row has a word of its own, so the verdict is the plan row's.
      await expect.poll(() => planVerdict(page, 'open-pr').getAttribute('data-sole-wave-verdict'),
        { timeout: 10_000 }).toBe('blocked');
      expect(await sliceStatus(page, 'open-pr', 'Review').textContent()).toContain('green');
      // AND NO FOLD. The verdict and the fold are exclusive: an implementation
      // that prints both puts two status words in one cell.
      expect(await planFold(page, 'open-pr').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('WAITING ON YOU, a COLLAPSED one-slice head: the plan row keeps the verdict', async () => {
    const page = await open();
    try {
      // A one-slice head is OPEN by default and shuts on the `shut:` override.
      const toggle = page.locator('[data-slice-toggle="shut-head"]');
      await toggle.waitFor({ timeout: 10_000 });
      if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
      await expect.poll(() => toggle.getAttribute('aria-expanded')).toBe('false');
      // The slice row is off the page, so nothing beneath states the verdict.
      await expect.poll(() =>
        page.locator('[data-slice-list="shut-head"] [data-slice-row="Folded"]').count()).toBe(0);
      // A `sliceRowVisible` that ignored the `shut:` override would drop it here,
      // leaving the verdict nowhere at all.
      expect(await planVerdict(page, 'shut-head').getAttribute('data-sole-wave-verdict'))
        .toBe('blocked');
      // THE OTHER DIRECTION, and it is what makes the fold the subject: OPEN the
      // head again and the slice row states the verdict (its branch's PR is
      // `unknown`, so `soleRowStatus` is ''), and the plan row yields it. Only
      // the fold changed between the two assertions.
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
      // NOT STARTED folds a plan by default — open it to see the slice row.
      const toggle = page.locator('[data-plan-toggle="unbegun"], [data-slice-toggle="unbegun"]').first();
      if (await toggle.count() > 0
        && (await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      await expect.poll(() => sliceStatus(page, 'unbegun', 'Start').textContent(),
        { timeout: 10_000 }).toContain('eligible');
      // The plan row yields the verdict…
      expect(await planVerdict(page, 'unbegun').count()).toBe(0);
      // …and STILL carries *Start work*. `soleSlice` has two jobs and only one
      // moved: a change removing the verdict and the dispatch gate together
      // would pass every assertion above.
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

  it('NOT STARTED, an ALL-DEFERRED plan: the plan row keeps the verdict', async () => {
    const page = await open();
    try {
      // `isUnbegun` filters every deferred row out, so this section draws no
      // slice row — and the plan row is the only place the verdict can appear. A
      // `sliceRowVisible` hardcoded to `true` in NOT STARTED loses it.
      await expect.poll(() => planVerdict(page, 'all-deferred').getAttribute('data-sole-wave-verdict'),
        { timeout: 10_000 }).toBe('eligible');
      expect(await page.locator('[data-slice-list="all-deferred"] [data-slice-row]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
