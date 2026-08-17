import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import type { AgentRow, Fleet, Stuck } from '../../src/contract/schema.js';

/**
 * WHERE THE STUCK LINE STARTS, and WHEN THE CUE MOVES — the two halves only a
 * real page can settle.
 *
 * Both were reported from a screenshot of the running board rather than found by
 * a test, and both are the same kind of defect: code that is right about the
 * state and wrong about the row.
 *
 * *The line started at the grid's left edge.* `col-span-full` begins at the
 * PHASE track, which is `6rem` wide and frequently empty — so on a row with no
 * phase the evidence hung flush left under nothing while the branch it describes
 * started `6rem` in. It read as a foreign element rather than as a continuation
 * of the row.
 *
 * *The cue pointed at an action that was not there.* `showsCue` keyed on the
 * state, but `StuckAction` falls back to plain words in three places — so an
 * animated dot sat immediately before *no dispatch available for this plan*.
 * Motion marks an unanswered request; where nothing can be asked, no request was
 * made.
 *
 * The decisions live in exported pure functions and are asserted in
 * `test/unit/stuck-display.test.ts`. What is here is what only geometry and a
 * rendered DOM can answer.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const stuck = (over: Partial<Stuck> = {}): Stuck => ({
  state: 'conflict',
  conflicts: [],
  localAhead: 0,
  changedPaths: [],
  failingChecks: [],
  runHistory: [],
  ...over,
});

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'plant-tomatoes',
  planFile: '2026-03-01-plant-tomatoes.md', wave: 'w', state: 'wip',
  phase: 'Development', group: 'waiting-on-you', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null,
  localDirty: false, localLocked: false, stuck: null, repair: null, ...over,
});

/**
 * Two conflicting rows differing ONLY in whether they carry a phase — which is
 * the whole claim about the alignment. The reported row had none, and that is
 * exactly the case `col-span-full` got wrong while looking correct on rows that
 * did.
 */
function fleet(): Fleet {
  const rows: AgentRow[] = [
    row({
      branch: 'feature/has-phase',
      phase: 'Development',
      stuck: stuck({ state: 'conflict', conflicts: ['packages/board/src/app/App.tsx'] }),
      branchUrl: `${GH}feature/has-phase`,
    }),
    row({
      branch: 'feature/no-phase',
      // The reported row: an EMPTY phase cell, under which the evidence used to
      // hang flush left.
      phase: null,
      stuck: stuck({ state: 'conflict', conflicts: ['packages/board/src/app/App.tsx'] }),
      branchUrl: `${GH}feature/no-phase`,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 1, waves: 1, branches: rows.length, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    stuck: { stuck: 2, artifact: 0, conflict: 2, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
  } as Fleet;
}

describe('the stuck line begins where the row does', () => {
  let browser: Browser;
  let server: { kill: () => void; port: number };
  let baseURL: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  async function open(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').waitFor({ timeout: 10_000 });
    return page;
  }

  const rowFor = (page: Page, branch: string) =>
    page.locator('li[data-agent-row]').filter({ has: page.locator(`[data-branch="${branch}"]`) });

  const leftOf = async (page: Page, branch: string, selector: string) =>
    (await rowFor(page, branch).locator(selector).first().boundingBox())!.x;

  it('starts the evidence where the row content starts, not at the grid edge', async () => {
    const page = await open();
    try {
      // The claim, stated in geometry: the stuck line begins at the PLAN track,
      // which is where a row's own content begins — never under the phase.
      const stuckX = await leftOf(page, 'feature/no-phase', '[data-stuck]');
      const rowX = (await rowFor(page, 'feature/no-phase').boundingBox())!.x;

      // Strictly right of the row's left edge, by about the phase track's
      // `6rem` (96 px). A tolerant lower bound rather than an exact number:
      // the assertion is *not at the edge*, and pinning the pixel would make
      // this fail on an unrelated padding change.
      expect(stuckX - rowX).toBeGreaterThan(50);
    } finally {
      await page.close();
    }
  });

  it('lines up identically whether or not the row has a phase', async () => {
    // The property the FIXED tracks exist for, and the one the defect broke:
    // an empty cell must leave a gap rather than shift its neighbours.
    const page = await open();
    try {
      const withPhase = await leftOf(page, 'feature/has-phase', '[data-stuck]');
      const withoutPhase = await leftOf(page, 'feature/no-phase', '[data-stuck]');
      expect(Math.abs(withPhase - withoutPhase)).toBeLessThan(1);
    } finally {
      await page.close();
    }
  });

  it('starts the evidence past the phase track, not under it', async () => {
    // Read off the rendered row rather than assumed from the track list: the
    // stuck line begins at or after the phase cell's right edge, which is what
    // "column 2" means in pixels. Anchored on `[data-phase]` because that cell
    // is the one the defect hid the line beneath.
    const page = await open();
    try {
      const phase = await rowFor(page, 'feature/has-phase')
        .locator('[data-phase]').first().boundingBox();
      const stuckX = await leftOf(page, 'feature/has-phase', '[data-stuck]');
      // `>=` rather than `>`: the phase cell's own text may be narrower than
      // its 6rem track, so the line starts at the TRACK boundary, which is at
      // or beyond where the text ends.
      expect(stuckX).toBeGreaterThanOrEqual(phase!.x + phase!.width - 1);
    } finally {
      await page.close();
    }
  });

  // THE ASSERTION THAT WOULD HAVE CAUGHT THE SECOND DEFECT, on a real page: the
  // rows in this fixture carry no card, so `StuckAction` falls back to the
  // words *no dispatch available for this plan* — and the animated dot used to
  // sit immediately before that sentence. Motion marks an unanswered request;
  // there is no request here to leave unanswered.
  it('shows the words and NO cue where the action fell back to text', async () => {
    const page = await open();
    try {
      const stuckRow = rowFor(page, 'feature/no-phase');
      // The action element is present — the row still says what it cannot do…
      const action = stuckRow.locator('[data-stuck-action]');
      expect(await action.count()).toBe(1);
      expect(await action.innerText()).toMatch(/no dispatch available/i);
      // …and nothing beside it is moving.
      expect(await stuckRow.locator('[data-stuck-cue]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
