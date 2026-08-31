import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import {
  openCatalogue, board as buildBoard, card as buildCard, column, fleet as buildFleet,
  row as buildRow, type Catalogue,
} from '../catalogue/index.js';
import { type AgentRow, type Board, type Fleet } from '../../src/contract/schema.js';

/**
 * DELIVER LIVES ON A DELIVERABLE PLAN — what only a rendered page settles.
 *
 * The server suite (`deliver-route.test.ts`) owns the refusals and the spawn.
 * This owns the half a page states: the control reaches the PLAN HEAD of a plan
 * the board marked `deliverable` — every non-deferred branch merged, not yet
 * delivered — and reaches no other. That is the defect a card-only check misses:
 * a control that cannot render passes every assertion that never mounts it.
 *
 *   - a plan whose card is `deliverable` offers *Deliver* on its plan-head menu.
 *   - a plan that is NOT deliverable (no `deliverable` bit) offers no such item —
 *     its plan row is intact but its menu carries nothing deliver-shaped, and on
 *     a plan with no draft act it has no `⋯` at all.
 *   - where the server REFUSES (`deliver.available === false`), the item is still
 *     reachable and NAMES the refusal: a refusal is not an absence.
 *
 * The DELIVERABLE PLAN IS ALL MERGED, so its branches land in DONE and render as
 * WAVE ROWS under a plan head — the `data-plan-actions` menu this control joins.
 * Two merged branches per plan, so the group is unambiguously a wave-grouped plan
 * head (the shape `planHeads` requires), matching how `agents-tab` proves DONE
 * grouping.
 *
 * `/api/fleet` and `/api/board` are stubbed at the network boundary, the way the
 * sibling suites do it. Route callbacks are SYNCHRONOUS: the board polls on a
 * timer and an awaited `route.fetch()` can still be in flight when the page
 * closes.
 */
const GH = 'https://github.com/tiny/garden';

/**
 * TWO FIELDS THIS FIXTURE HAD WRONG, both surfaced by the move to a PARSING
 * builder and neither of them an assertion change:
 *
 *   `phase: 'Approved'`   a PLAN phase. `AgentRow.phase` carries one of the
 *                         five BOARD phases, and `Approved` is not among them.
 *   `waitingOn: 'nobody'` not in the enum, which admits `you|click|time|null`.
 *
 * Neither is read by anything below — these rows are asserted on for their plan
 * grouping and the card's `deliverable` bit — which is exactly why a cast let
 * them sit here. They are corrected to the values the schema actually admits,
 * and named here so the diff is not read as an edited expectation.
 */
const row = (over: Partial<AgentRow> = {}): AgentRow => buildRow({
  repo: 'garden', branch: 'feature/x', plan: 'landed', planFile: 'p-landed.md',
  wave: 'Implementation', state: 'merged', phase: 'Development', group: 'done',
  // `waitingOn: null` — the schema's own spelling of "nothing is waiting".
  // This fixture said `'nobody'`, which the enum does not admit; the client
  // CAST its payload, so it reached the renderer as a word no branch reads.
  ageMinutes: 120, waitingOn: null, note: 'merged', pr: null,
  branchUrl: '', waitingDays: null, verdict: 'blocked',
  localDirty: false, localLocked: false, stuck: null, repair: null, ...over,
});

/**
 * Two plans, each rendering a proper DONE plan head (two merged branches apiece,
 * so both are unambiguously wave-grouped). They differ ONLY in the board: the
 * `landed` card carries the `deliverable` bit and the `other` card does not. That
 * is the whole point — the control keys on the card flag the server sets, not on
 * a plan merely sitting in DONE, so a plan the board did not mark deliverable
 * (e.g. one already delivered) offers nothing even with every branch merged.
 */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    row({ branch: 'feature/landed-a', plan: 'landed', planFile: 'p-landed.md' }),
    row({ branch: 'feature/landed-b', plan: 'landed', planFile: 'p-landed.md' }),
    row({ branch: 'feature/other-a', plan: 'other', planFile: 'p-other.md' }),
    row({ branch: 'feature/other-b', plan: 'other', planFile: 'p-other.md' }),
  ];
  return buildFleet({ rows, ...over });
}

/** A card, defaulted to the deliverable `landed` plan in Testing. */
function card(over: Record<string, unknown> = {}) {
  return buildCard({
    slug: 'landed', title: 'A landed plan', type: 'feature', phase: 'Testing',
    path: 'p-landed.md', prs: [], phaseDate: '', deliverable: true, ...over,
  });
}

/** The board a stub answers with — `deliver` available, one deliverable card. */
function board(over: Partial<Board> = {}): Board {
  return buildBoard({
    columns: [
      column({ phase: 'Discovery', cards: [] }),
      column({ phase: 'Design', cards: [] }),
      column({ phase: 'Development', cards: [] }),
      // `landed` is deliverable; `other` is a Testing card with NO bit — e.g. a
      // plan already delivered, which lands in Testing too and must offer nothing.
      column({
        phase: 'Testing',
        cards: [
          card(),
          card({ slug: 'other', title: 'Another plan', path: 'p-other.md', deliverable: undefined }),
        ],
      }),
      column({ phase: 'Released', cards: [] }),
    ],
    deliver: { available: true, reason: '' },
    ...over,
  });
}

describe('a deliverable plan carries Deliver, and no other plan does', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  async function open(
    payload: Fleet = fleet(),
    boardPayload: Board = board(),
  ): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      tab: 'agents',
      over: { fleet: payload, board: boardPayload },
    });
    await page.getByText('Done').first().waitFor({ timeout: 10_000 });
    // DONE is collapsed by default — the same click a reader makes to see inside.
    const doneToggle = page.locator('[data-group-toggle="done"]');
    await doneToggle.waitFor({ timeout: 10_000 });
    if ((await doneToggle.getAttribute('aria-expanded')) === 'false') await doneToggle.click();
    return page;
  }

  const planMenuButton = (page: Page, plan: string) =>
    page.locator(`[data-plan-actions="${plan}"]`);

  it('offers Deliver on the deliverable plan head', async () => {
    const page = await open();
    try {
      const btn = planMenuButton(page, 'landed');
      await expect.poll(() => btn.count(), { timeout: 10_000 }).toBe(1);
      await btn.click();
      const menu = page.locator('[role="menu"]').filter({ has: page.locator('[data-deliver="landed"]') });
      await expect.poll(() => menu.getByRole('button', { name: /Deliver/ }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers it NOWHERE the plan is not deliverable', async () => {
    // `other` carries no `deliverable` bit and has no draft act, so it has no
    // plan-actions menu at all — even though every branch merged and it sits in
    // DONE beside `landed`. `data-deliver` is the ONLY DOM home for the control,
    // so its absence off the deliverable plan proves the scoping.
    const page = await open();
    try {
      // `landed` has the menu button; `other` has none at all — no draft act and
      // no `deliverable` bit means no `⋯`.
      await expect
        .poll(() => planMenuButton(page, 'landed').count(), { timeout: 10_000 })
        .toBe(1);
      expect(await page.locator('[data-plan-actions="other"]').count()).toBe(0);
      // Opening `landed`'s menu reveals its deliver control; and it is the ONLY
      // deliver control on the page — `other` has no menu to hold one.
      await planMenuButton(page, 'landed').click();
      await expect.poll(() => page.locator('[data-deliver="landed"]').count()).toBe(1);
      expect(await page.locator('[data-deliver="other"]').count()).toBe(0);
      expect(await page.locator('[data-deliver]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('NAMES the refusal where the server will not deliver', async () => {
    // A refusal is not an absence. With `deliver.available === false` the plan is
    // still deliverable — the card's bit is unchanged — so the `⋯` still opens and
    // the button inside carries the server's reason rather than a dead control.
    const reason = 'delivering runs the /plot-deliver SKILL, which no script can do';
    const page = await open(fleet(), board({ deliver: { available: false, reason } }));
    try {
      const btn = planMenuButton(page, 'landed');
      await expect.poll(() => btn.count(), { timeout: 10_000 }).toBe(1);
      await btn.click();
      const control = page.locator('[data-deliver="landed"]');
      await expect.poll(() => control.count()).toBe(1);
      // Disabled for assistive tech, and its refusal is stated — the sr-only span
      // and the title both carry the reason a dimmed control would otherwise hide.
      await expect.poll(() => control.getAttribute('aria-disabled')).toBe('true');
      await expect.poll(() => control.getAttribute('title')).toBe(reason);
      await expect.poll(() => control.textContent()).toContain(reason);
    } finally {
      await page.close();
    }
  });
});
