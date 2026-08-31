import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { expandAgentFolds } from '../helpers.mjs';
import { type AgentRow, type Fleet, type Board } from '../../src/contract/schema.js';

/**
 * THE PLAN'S ACTS LIVE ON THE PLAN HEAD — what only a rendered page can settle.
 *
 * The unit suite owns the routing decisions (`classify`, `menuState`). This owns
 * the half a page states, and it is the half twelve green card tests missed for
 * weeks: a control that CANNOT RENDER passes every assertion that never mounts
 * it. `approve.browser.test.ts` exercises the CARD; these assertions exercise
 * the fleet's PLAN HEAD (`PlanActions`), the row that names the plan in WAITING
 * ON YOU — a different render entirely, and the one the defect lived in.
 *
 *   - a Draft plan's head offers BOTH Approve and Commission design — the pair
 *     catches the missing `commission` prop, which no UI-by-eye check would.
 *   - NO branch or wave row offers either — including a branch BLOCKED by an
 *     earlier wave, the row a "re-gate on the section" fix looks correct on.
 *   - a Draft branch row's menu still offers Start work and Open — the guard on
 *     an over-broad deletion that would empty the menu.
 *
 * Written against TODAY'S code first and watched to fail for the stated reason:
 * before the fix the plan head took no `commission` prop and its `⋯` gated on
 * `approve.available` alone, so "offers both" failed on the missing Commission
 * item. A test that passes before the fix is evidence of nothing.
 *
 * `/api/fleet` and `/api/board` are stubbed at the network boundary, the way the
 * sibling suites do it, so every claim is about what the tab RENDERS from a
 * pulse and a board — no child process to race. Route callbacks are SYNCHRONOUS:
 * the board polls on a timer and an awaited `route.fetch()` can still be in
 * flight when the page closes.
 */
const GH = 'https://github.com/tiny/garden';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'beans', planFile: 'p-beans.md',
  wave: 'w1', state: 'wip', phase: 'Draft', group: 'waiting-on-you', ageMinutes: 30,
  waitingOn: 'you', note: 'plan not approved yet — still in review', pr: null,
  branchUrl: `${GH}/tree/feature/x`, waitingDays: null, verdict: 'eligible',
  localDirty: false, localLocked: false, stuck: null, repair: null,
  // Default: wip state under a Draft plan → waiting-on-approval.
  startability: 'waiting-on-approval' as const,
  ...over,
});

/**
 * A Draft plan (`beans`) whose branches sit in WAITING ON YOU, wave-grouped so
 * the plan HEAD renders (`planHeads` requires every row wave-grouped). Two waves
 * of it: the first eligible, the second BLOCKED by the first — the blocked row
 * is the one a section-only re-gate would wrongly re-arm.
 *
 * A second Draft plan (`peas`) with a single startable branch, to prove a Draft
 * branch row's own menu still offers Start work and Open.
 */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    // `beans`, wave 1 — eligible, waiting on you (Draft plan → WAITING ON YOU).
    row({ branch: 'feature/beans-w1', wave: 'w1', waitingOn: 'you' }),
    // `beans`, wave 2 — BLOCKED by wave 1. Still WAITING ON YOU because the plan
    // is Draft, which is exactly the row a "re-gate on the section" fix re-arms.
    row({ branch: 'feature/beans-w2', wave: 'w2', waitingOn: 'time', verdict: 'blocked', startability: null }),
    // `peas` — a Draft plan with two startable branches in one wave, so each
    // renders as its own row with its own `⋯` menu (a sole-branch wave folds its
    // menu onto the wave row). Its OWN menu keeps Start work and Open; it must
    // not gain Approve or Commission.
    row({
      branch: 'feature/peas-a', plan: 'peas', planFile: 'p-peas.md',
      wave: 'w1', state: 'open', phase: 'Draft', group: 'not-started',
      waitingOn: 'click', ageMinutes: null, note: 'approved — nobody has taken it',
      branchUrl: `${GH}/tree/feature/peas-a`, verdict: 'eligible',
      startability: 'start-work' as const,
    }),
    row({
      branch: 'feature/peas-b', plan: 'peas', planFile: 'p-peas.md',
      wave: 'w1', state: 'open', phase: 'Draft', group: 'not-started',
      waitingOn: 'click', ageMinutes: null, note: 'approved — nobody has taken it',
      branchUrl: `${GH}/tree/feature/peas-b`, verdict: 'eligible',
      startability: 'start-work' as const,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 2, waves: 3, branches: rows.length, claimed: 0, eligible: 2, blocked: 1, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [], issueAnswer: 'unsupported', issueError: null,
    ...over,
  } as Fleet;
}

/** A Draft card for a plan, matched to a fleet row by `path` basename. */
function draftCard(slug: string, file: string) {
  return {
    slug, title: slug, type: 'feature', phase: 'Discovery', path: file, prs: [],
  };
}

/**
 * The board a stub answers with. `approve` and `commission` are BOTH available,
 * so the plan head can offer both; the cards are Draft (`phase: Discovery`), so
 * `isDraft` holds and the head renders its acts. `peas` is Draft too, and Start
 * work is available so its branch row's own menu is enabled.
 */
function board(over: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    columns: [{ phase: 'Discovery', cards: [draftCard('beans', 'p-beans.md'), draftCard('peas', 'p-peas.md')] }],
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

describe('the plan head carries the plan decisions, and no row does', () => {
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
    // matters — the board ANSWERS this state, and the page shows exactly it.
    const page = await cat.open('an-empty-estate', {
      over: { fleet: payload, board: boardPayload as Board },
      tab: 'agents',
      viewport: { width: 1400, height: 1200 },
    });
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  const planHead = (page: Page, slug: string) =>
    page.locator(`li[data-plan-row="${slug}"]`);
  const planMenuButton = (page: Page, slug: string) =>
    page.locator(`[data-plan-actions="${slug}"]`);

  async function openPlanMenu(page: Page, slug: string): Promise<void> {
    const btn = planMenuButton(page, slug);
    await btn.waitFor({ timeout: 10_000 });
    await btn.click();
  }

  it('offers BOTH Approve and Commission design on a Draft plan head', async () => {
    // The pair is the assertion. A missing `commission` prop leaves Approve alone
    // and passes any test that only asks for Approve — so both are demanded, and
    // the plan head is where a control that could not render is finally rendered.
    const page = await open();
    try {
      await expect.poll(() => planHead(page, 'beans').count(), { timeout: 10_000 }).toBe(1);
      await openPlanMenu(page, 'beans');
      const menu = planHead(page, 'beans').locator('[role="menu"]');
      await expect.poll(() => menu.getByRole('button', { name: 'Approve' }).count()).toBe(1);
      await expect
        .poll(() => menu.getByRole('button', { name: 'Commission design' }).count())
        .toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers NEITHER act on any branch or wave row, blocked ones included', async () => {
    // The row a section-only re-gate looks correct on is `feature/beans-w2`: a
    // branch BLOCKED by an earlier wave, in `waiting-on-you` because its plan is
    // Draft. No branch row and no wave row may carry the plan-actions control —
    // the acts belong to the plan, and its head is the only honest place. This is
    // structural rather than click-driven: `data-plan-actions` is the ONLY DOM
    // home for Approve and Commission on this tab (`PlanActions` renders both
    // behind it), so proving it appears only on plan heads proves no branch or
    // wave row can offer either.
    const page = await open();
    try {
      // Both blocked and eligible branch/wave rows are present…
      await expect
        .poll(() => page.locator('li[data-wave-row]').count(), { timeout: 10_000 })
        .toBeGreaterThan(0);
      await expect.poll(() => page.locator('li[data-agent-row]').count()).toBeGreaterThan(0);
      // …and NONE of them exposes the plan-actions control.
      expect(await page.locator('li[data-wave-row] [data-plan-actions]').count()).toBe(0);
      expect(await page.locator('li[data-agent-row] [data-plan-actions]').count()).toBe(0);
      // Every plan-actions control that exists sits on a plan head.
      const total = await page.locator('[data-plan-actions]').count();
      const onHeads = await page.locator('li[data-plan-row] [data-plan-actions]').count();
      expect(total).toBeGreaterThan(0);
      expect(onHeads).toBe(total);
    } finally {
      await page.close();
    }
  });

  it('keeps Start work on a startable Draft branch row — the menu is not emptied', async () => {
    // The over-broad-deletion guard: removing the two plan acts must not take the
    // branch-level ones with them. `feature/peas-a` is startable, so its own menu
    // offers Start work, and it must not gain Approve or Commission.
    const page = await open();
    try {
      const peas = page.locator('li[data-agent-row]')
        .filter({ has: page.locator('[data-branch="feature/peas-a"]') });
      const menuBtn = peas.locator('[data-row-actions]');
      await menuBtn.waitFor({ timeout: 10_000 });
      await menuBtn.click();
      const menu = peas.locator('[role="menu"]');
      await expect.poll(() => menu.getByRole('button', { name: /Start work/ }).count())
        .toBeGreaterThanOrEqual(1);
      // And it does NOT carry the plan acts.
      expect(await menu.getByRole('button', { name: 'Approve' }).count()).toBe(0);
      expect(await menu.getByRole('button', { name: 'Commission design' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('keeps Open/Review on a WAITING ON YOU branch row — the menu is not emptied', async () => {
    // The other branch-level act the deletion must leave alone. `feature/beans-w1`
    // sits in WAITING ON YOU with an address, so its menu offers Open (navigation
    // to the branch on the host) — and still no plan act.
    const page = await open();
    try {
      const w1 = page.locator('li[data-wave-row]')
        .filter({ has: page.locator('[data-branch="feature/beans-w1"]') });
      const menuBtn = w1.locator('[data-row-actions]');
      await menuBtn.waitFor({ timeout: 10_000 });
      await menuBtn.click();
      const menu = w1.locator('[role="menu"]');
      await expect.poll(() => menu.locator('a[data-open-link]').count())
        .toBeGreaterThanOrEqual(1);
      expect(await menu.getByRole('button', { name: 'Approve' }).count()).toBe(0);
      expect(await menu.getByRole('button', { name: 'Commission design' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
