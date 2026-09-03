import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { type AgentRow, type Fleet, type Board } from '../../src/contract/schema.js';

/**
 * SLICE THIS WAVE LIVES ON THE UNSLICED WAVE — what only a rendered page settles.
 *
 * The server suite (`reslice-route.test.ts`) owns the refusals and the spawn.
 * This owns the half a page states: the control reaches the `unsliced-wave` WAVE
 * ROW — the row that, before this feature, had no menu of any kind — and reaches
 * no other. That is the defect a card-only check misses: a control that cannot
 * render passes every assertion that never mounts it, and this row was the one
 * `WaveActions` (gated on `verdict === 'eligible'`) and `BranchMenu` (gated on a
 * sole branch) both declined to give a menu.
 *
 *   - a wave the board reports `unsliced-wave` offers *Slice this wave*.
 *   - a wave that is NOT tangled offers no such item — its branch menu is intact
 *     but carries nothing reslice-shaped.
 *   - where the server REFUSES (`reslice.available === false`), the item is still
 *     reachable and NAMES the refusal: a refusal is not an absence.
 *
 * `/api/fleet` and `/api/board` are stubbed at the network boundary, the way the
 * sibling suites do it. Route callbacks are SYNCHRONOUS: the board polls on a
 * timer and an awaited `route.fetch()` can still be in flight when the page
 * closes.
 */
const GH = 'https://github.com/tiny/garden';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'tangled', planFile: 'p-tangled.md',
  wave: 'Implementation', state: 'open', phase: 'Approved', group: 'waiting-on-you',
  ageMinutes: 30, waitingOn: 'you', note: 'PR #12 green', pr: null,
  branchUrl: `${GH}/tree/feature/x`, waitingDays: null, verdict: 'blocked',
  localDirty: false, localLocked: false, stuck: null, repair: null, ...over,
});

/** The wave-level stuck state, with every field the schema carries. */
function unslicedStuck(siblings: string[]): AgentRow['stuck'] {
  return {
    state: 'unsliced-wave', claimedBy: [], waveSiblings: siblings,
    conflicts: [], localAhead: 0, changedPaths: [], failingChecks: [],
    runHistory: [],
  };
}

/** A green PR, so a branch groups into a review section as a wave. */
function greenPr(number: number): AgentRow['pr'] {
  return { number, url: `${GH}/pull/${number}`, draft: false, state: 'green' };
}

/**
 * A plan (`tangled`) whose one wave holds TWO live branches the scan reports
 * `unsliced-wave` — the tangle this control exists to cut. Both carry PRs, so
 * the wave groups in a review section and renders as a single WAVE ROW (with the
 * branches foldable beneath) rather than two sole-branch rows.
 *
 * A second plan (`neat`) with a single clean branch — no `unsliced-wave`, no
 * reslice item — proves the control appears only where the tangle is.
 */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    row({
      branch: 'feature/tangled-a', wave: 'Implementation', pr: greenPr(12),
      note: 'PR #12 green', stuck: unslicedStuck(['feature/tangled-b']),
    }),
    row({
      branch: 'feature/tangled-b', wave: 'Implementation', pr: greenPr(13),
      note: 'PR #13 green', stuck: unslicedStuck(['feature/tangled-a']),
    }),
    // `neat` — one clean branch with a PR, its own single-branch wave. It gets a
    // BranchMenu (Open/Review), never a reslice item.
    row({
      branch: 'feature/neat', plan: 'neat', planFile: 'p-neat.md',
      wave: 'w1', pr: greenPr(20), note: 'PR #20 green', stuck: null,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 2, waves: 2, branches: rows.length, claimed: 0, eligible: 0, blocked: 2, deferred: 0 },
    stuck: { stuck: 2, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [], issueAnswer: 'unsupported', issueError: null,
    ...over,
  } as Fleet;
}

/** The board a stub answers with — `reslice` available unless a test overrides. */
function board(over: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    columns: [{ phase: 'Development', cards: [] }],
    checklist: [], sprints: [], stories: [],
    dispatch: { available: false, reason: '' },
    approve: { available: false, reason: '' },
    continue: { available: false, reason: '' },
    idea: { available: false, reason: '' },
    commission: { available: false, reason: '' },
    reslice: { available: true, reason: '' },
    server: { restartCommand: '', port: 0 },
    ...over,
  };
}

describe('the unsliced wave carries Slice this wave, and no other row does', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);

  afterAll(async () => {
    await cat?.close();
  });

  // THE STATE IS SERVED, NOT PATCHED OVER A REAL ONE. `startServer(FIXTURE)`
  // gave this file an origin and nothing else — both payloads were already
  // local, and every request to the real board was answered by a `page.route`
  // stub before it reached the estate. The mock answers them directly, so what
  // the page renders from is stated here rather than assembled from whatever
  // the fixture repo happened to hold.
  async function open(
    payload: Fleet = fleet(),
    boardPayload: Board = board() as Board,
  ): Promise<Page> {
    const page = await cat.open('an-empty-estate', {
      over: { fleet: payload, board: boardPayload },
      tab: 'agents',
      viewport: { width: 1400, height: 1200 },
    });
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  const resliceMenuButton = (page: Page, wave: string) =>
    page.locator(`[data-reslice-actions="${wave}"]`);

  it('offers Slice this wave on the unsliced wave row', async () => {
    // The `⋯` this row had none of before. Opening it reveals the one item the
    // tangle offers, its accessible name naming the act.
    const page = await open();
    try {
      const btn = resliceMenuButton(page, 'Implementation');
      await expect.poll(() => btn.count(), { timeout: 10_000 }).toBe(1);
      await btn.click();
      const menu = page.locator('[role="menu"]').filter({ has: page.locator('[data-reslice="tangled"]') });
      await expect.poll(() => menu.getByRole('button', { name: /Slice this plan/ }).count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('offers it NOWHERE the wave is not tangled', async () => {
    // `neat` is a clean single-branch wave: its own menu is intact (Open), but no
    // reslice control exists on it. The `data-reslice-actions` hook is the ONLY
    // DOM home for the item, so its absence off the tangle proves the scoping.
    const page = await open();
    try {
      // The tangle's control is present…
      await expect
        .poll(() => resliceMenuButton(page, 'Implementation').count(), { timeout: 10_000 })
        .toBe(1);
      // …and it is the ONLY reslice control on the page: `neat` offers none.
      expect(await page.locator('[data-reslice-actions]').count()).toBe(1);
      expect(await page.locator('[data-reslice-actions="w1"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('NAMES the refusal where the server will not reslice', async () => {
    // A refusal is not an absence. With `reslice.available === false` the `⋯`
    // still opens — the item always applies to a tangled wave — and the button
    // inside carries the server's reason rather than a dead control.
    const reason = 'reslicing runs the /plot-reslice SKILL, which no script can do';
    const page = await open(fleet(), board({ reslice: { available: false, reason } }));
    try {
      const btn = resliceMenuButton(page, 'Implementation');
      await expect.poll(() => btn.count(), { timeout: 10_000 }).toBe(1);
      await btn.click();
      const control = page.locator('[data-reslice="tangled"]');
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
