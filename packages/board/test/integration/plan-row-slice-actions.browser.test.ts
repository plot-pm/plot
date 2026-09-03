import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { type AgentRow, type Fleet, type Slice } from '../../src/contract/schema.js';

/**
 * WHERE A WAVE ROW IS HIDDEN, ITS CONTROL IS NOT — the half a rendered page
 * settles for `the-plan-row-carries-wave-actions`.
 *
 * `one-wave-renders-as-its-plan` (PR #360) removed the wave row for a plan that
 * declares exactly one wave: the plan row now carries the wave's VERDICT. But a
 * wave row also carried an ACTION — *Start work*, the wave's own control,
 * dispatching that single wave. Hiding the row must not hide the control.
 *
 * So a one-wave ELIGIBLE plan's row offers *Start work* (the `SliceActions` `⋯`,
 * `data-slice-actions`), exactly as its hidden wave row would have. A MULTI-wave
 * plan's row does NOT — its wave rows still render and still carry their own,
 * and a plan-row control would have to guess which wave it meant.
 *
 * This is the ADDITIONAL half of the plan: the plan-level acts Approve and
 * Commission (`data-plan-actions`, from PR #313's boundary) are unaffected by
 * the wave count — they reach the plan row whatever it is. `Start work` is a
 * wave act that rides ALONGSIDE them where there is one wave to act on.
 *
 * `/api/fleet` and `/api/board` are stubbed at the network boundary, the sibling
 * suites' pattern. Route callbacks are SYNCHRONOUS: the board polls on a timer
 * and an awaited `route.fetch()` can still be in flight when the page closes.
 */
const GH = 'https://github.com/tiny/garden';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'beans', planFile: 'p-beans.md',
  wave: 'w1', state: 'open', phase: 'Approved', group: 'not-started', ageMinutes: null,
  waitingOn: 'click', note: 'approved — nobody has taken it', pr: null,
  branchUrl: `${GH}/tree/feature/x`, waitingDays: 1, verdict: 'eligible',
  localDirty: false, localLocked: false, stuck: null, repair: null, ...over,
});

const slice = (over: Partial<Slice> = {}): Slice => ({
  plan: 'beans', name: 'w1', branches: [], verdict: 'eligible',
  section: 'not-started', complete: false, planSliceCount: 2, ...over,
});

/**
 * Two Approved plans in NOT STARTED:
 *   - `beans` declares ONE wave (`planSliceCount: 1`) — its wave row is hidden and
 *     the plan row carries the wave's verdict AND its *Start work*.
 *   - `peas` declares TWO waves — its wave rows render and carry their own
 *     controls, so the plan row must NOT offer *Start work*.
 */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    row({ branch: 'feature/beans-only', plan: 'beans', planFile: 'p-beans.md', wave: 'Solo' }),
    row({ branch: 'feature/peas-a', plan: 'peas', planFile: 'p-peas.md', wave: 'First',
      branchUrl: `${GH}/tree/feature/peas-a` }),
    row({ branch: 'feature/peas-b', plan: 'peas', planFile: 'p-peas.md', wave: 'Second',
      verdict: 'blocked', waitingOn: 'time', branchUrl: `${GH}/tree/feature/peas-b` }),
  ];
  const slices: Slice[] = [
    // ONE wave — the plan row must carry Start work.
    slice({ plan: 'beans', name: 'Solo', branches: ['feature/beans-only'], planSliceCount: 1 }),
    // TWO waves — the wave rows carry their own; the plan row must not.
    slice({ plan: 'peas', name: 'First', branches: ['feature/peas-a'], planSliceCount: 2 }),
    slice({ plan: 'peas', name: 'Second', branches: ['feature/peas-b'],
      verdict: 'blocked', planSliceCount: 2 }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows, slices,
    summary: { plans: 2, waves: 3, branches: rows.length, claimed: 0, eligible: 2, blocked: 1, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [], issueAnswer: 'unsupported', issueError: null,
    ...over,
  } as Fleet;
}

/** An Approved card for a plan, matched to a fleet row by `path` basename. */
function approvedCard(slug: string, file: string) {
  return {
    slug, title: slug, type: 'feature', phase: 'Approved', path: file, prs: [],
  };
}

/**
 * The board a stub answers with. `dispatch` is available so a *Start work*
 * control is enabled; the cards are Approved (not Draft), so the plan head does
 * NOT offer Approve/Commission — this suite is about the WAVE act, and keeping
 * the draft acts off keeps the two questions apart.
 */
function board(over: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    columns: [{ phase: 'Approved', cards: [approvedCard('beans', 'p-beans.md'), approvedCard('peas', 'p-peas.md')] }],
    checklist: [], sprints: [], stories: [],
    dispatch: { available: true, reason: '' },
    approve: { available: true, reason: '' },
    continue: { available: false, reason: '' },
    idea: { available: false, reason: '' },
    commission: { available: true, reason: '' },
    server: { restartCommand: '', port: 0 },
    ...over,
  };
}

describe('the plan row carries the sole wave’s actions', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  async function open(
    payload: Fleet = fleet(),
    boardPayload: Record<string, unknown> = board(),
  ): Promise<Page> {
    // SERVED, NOT INTERCEPTED. `startServer(FIXTURE)` gave this file an
    // origin and nothing more: both payloads were already local, and every
    // request was answered by a `page.route` stub before it reached the
    // estate. Serving them from the mock makes the assertion the one that
    // matters — the board ANSWERS this state, and the page shows it.
    const page = await cat.open('an-empty-estate', {
      over: { fleet: payload, board: boardPayload as Board },
      tab: 'agents',
      viewport: { width: 1400, height: 1200 },
    });
    await page.getByText('Not started').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  const planRow = (page: Page, slug: string) =>
    page.locator(`li[data-plan-row="${slug}"]`);

  it("carries the sole wave's Start work in ONE menu, in a labelled wave section", async () => {
    // `beans` declares one wave. Its wave row IS rendered — the wave's NAME
    // belongs there and a branch row cannot carry it — but it withholds *Start
    // work*: the plan row carries that act.
    //
    // THE PLAN ROW WEARS EXACTLY ONE `⋯`. This test asserted the opposite until
    // 2026-08-25: the plan row rendered `SliceActions` as a SIBLING of
    // `PlanActions`, so it grew two adjacent three-dot buttons — identical to
    // look at, different in what they held, and the operator had to open both
    // to find out which was which. The count below is the whole fix; without it
    // an implementation that merely ADDS the wave section passes every other
    // assertion here while leaving the second button in place.
    const page = await open();
    try {
      await expect.poll(() => planRow(page, 'beans').count(), { timeout: 10_000 }).toBe(1);
      // The wave row IS present — a one-wave plan's wave is still a wave.
      await expect.poll(() => page.locator('li[data-slice-row="Solo"]').count()).toBe(1);
      // The wave row has NO Start-work control — the plan row carries it.
      expect(await page.locator('li[data-slice-row="Solo"] [data-slice-actions]').count()).toBe(0);

      // ONE menu trigger on the plan row, not two.
      const triggers = planRow(page, 'beans').locator('button[aria-haspopup="menu"]');
      await expect.poll(() => triggers.count(), { timeout: 10_000 }).toBe(1);

      await triggers.click();
      const menu = planRow(page, 'beans').locator('[role="menu"]');
      // The wave's act is inside, under a section that NAMES the wave — so a
      // reader can tell which items act on the plan and which on the wave
      // without opening two controls to compare.
      await expect.poll(() => menu.locator('[data-slice-section="Solo"]').count()).toBe(1);
      await expect.poll(() => menu.getByRole('button', { name: /Start work/ }).count())
        .toBeGreaterThanOrEqual(1);
    } finally {
      await page.close();
    }
  });

  it('does NOT offer Start work on a multi-wave plan’s row — its wave rows keep their own', async () => {
    // `peas` declares two waves, so its wave rows render and carry their own
    // controls. A plan-row *Start work* would have to guess which wave it meant,
    // so the plan row offers none.
    const page = await open();
    try {
      await expect.poll(() => planRow(page, 'peas').count(), { timeout: 10_000 }).toBe(1);
      // The wave rows are present…
      await expect.poll(() => page.locator('li[data-slice-row="First"]').count()).toBe(1);
      // …and the plan row carries NO wave section, however many `⋯` it wears.
      //
      // NEVER MORE THAN ONE TRIGGER — the property this suite exists for. Not
      // "exactly one": a plan row with no acts at all wears none, and `peas` is
      // exactly that (Approved, no eligible count on its card, no sole wave).
      // Asserting 1 here made the test fail on correct behaviour.
      const triggers = planRow(page, 'peas').locator('button[aria-haspopup="menu"]');
      await expect.poll(() => triggers.count(), { timeout: 10_000 }).toBeLessThanOrEqual(1);
      // No wave section exists anywhere under this row — a multi-wave plan's
      // row cannot know which wave a *Start work* would mean, so it offers none.
      //
      // Asserted on the SECTION, not on `[data-slice-actions]`. That attribute
      // now lives only on real wave rows, so a plan-row query for it returns 0
      // however this component behaves — the assertion it used to make became
      // vacuous the moment the sibling menu went away.
      expect(await planRow(page, 'peas').locator('[data-slice-section]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('leaves the eligible wave row’s own Start work in place where a wave row still renders', async () => {
    // `peas`'s first wave is eligible, so its wave row keeps its `SliceActions`
    // control — hiding a plan's sole-wave control must not touch a real wave row.
    const page = await open();
    try {
      const firstSlice = page.locator('li[data-slice-row="First"]');
      await expect.poll(() => firstSlice.locator('[data-slice-actions]').count(), { timeout: 10_000 })
        .toBe(1);
    } finally {
      await page.close();
    }
  });
});
