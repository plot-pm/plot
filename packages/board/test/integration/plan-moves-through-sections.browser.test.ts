import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer, expandAgentFolds } from '../helpers.mjs';
import { ELIGIBLE_NOTE, DRAFT_PLAN_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * THE WHOLE OPERATOR PATH, WALKED ONCE — approve a plan, and it appears in NOT
 * STARTED where Start work takes it.
 *
 * Every existing test covers one LEG of this path and none walks it:
 * `approve.browser.test.ts` proves the card's Approve arms and posts,
 * `plan-head-controls.browser.test.ts` proves the plan head OFFERS Approve and
 * no row usurps it, `not-started-plans.browser.test.ts` proves NOT STARTED
 * renders approved plans, and `button-claims.browser.test.ts` proves Start work
 * dispatches. What none of them asserts is the CONNECTION: that the section an
 * approved plan lands in is the section that offers to start it, and that a
 * Draft plan is kept out of it. Wave 1 (`bug/the-plan-row-carries-the-plan-decisions`,
 * #325) deleted the two dead row controls and dropped `'draft'` from the
 * deferred allowlist; this wave proves the resulting path works end to end.
 *
 * A real approval is off the table here for the reason the whole harness is
 * built around: `plot-approve.sh` merges a plan PR on the git host, undoable
 * only by more git, so the tests stub the acting scripts and never run one. The
 * routing that a real approval would trigger — a Draft plan's branch OUT of NOT
 * STARTED, an approved plan's INTO it — is a pure function of the pulse, pinned
 * over its whole input space in `test/unit/fleet.test.ts`. So the walk asserts
 * the RENDERED path the operator sees: the board a stub answers with holds both
 * ends of the journey at once — a Draft plan still offering Approve and kept out
 * of NOT STARTED, and an approved plan sitting in NOT STARTED offering the Start
 * work that dispatches it.
 *
 * Three assertions exist because a naive implementation passes without them,
 * each named from the plan's `## Done when`:
 *   - the approved plan reaches NOT STARTED SPECIFICALLY, not merely a row
 *     somewhere — wave 1's admission fix is what that proves;
 *   - Start work DISPATCHES (a POST to `/api/dispatch`), not merely renders — a
 *     disabled-but-present control passes a presence check;
 *   - the Draft plan's shelved branch is ABSENT from NOT STARTED — the section
 *     means *approved — nobody has taken it*, and only a negative assertion
 *     catches the old `'draft'` allowlist returning.
 *
 * `/api/fleet` and `/api/board` are stubbed at the network boundary, the way the
 * sibling suites do it. Route callbacks are SYNCHRONOUS: the board polls on a
 * timer and an awaited `route.fetch()` can still be in flight when the page
 * closes. The client CASTS the fleet — a row's `group` is trusted, not
 * re-derived — so each fixture row carries the group the pulse would have put it
 * in, which is what the browser renders from.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden';

/** The plan the operator approves — Draft, so its card offers Approve. */
const DRAFT_SLUG = 'still-a-draft';
const DRAFT_FILE = 'p-still-a-draft.md';
/** The plan already approved — in NOT STARTED, offering Start work. */
const APPROVED_SLUG = 'approved-and-waiting';
const APPROVED_FILE = 'p-approved-and-waiting.md';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: APPROVED_SLUG, planFile: APPROVED_FILE,
  wave: 'w', state: 'open', phase: 'Design', group: 'not-started', ageMinutes: null,
  waitingOn: 'click', note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null, verdict: 'eligible',
  ...over,
});

/**
 * A board holding BOTH ends of the journey.
 *
 * The Draft card sits in Discovery (`isDraft` reads exactly `phase ===
 * 'Discovery'`), so its Approve renders. The approved card sits in a later
 * column — it carries no Approve, and its only job here is to be the `card` the
 * eligible wave row needs before `WaveActions` will mount Start work
 * (`group.verdict === 'eligible' && card && dispatch`). Both `approve` and
 * `dispatch` are available so neither control is disabled for a reason other
 * than the one under test.
 */
function board(over: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    columns: [
      { phase: 'Discovery', cards: [card(DRAFT_SLUG, DRAFT_FILE, 'Discovery')] },
      { phase: 'Development', cards: [card(APPROVED_SLUG, APPROVED_FILE, 'Development')] },
    ],
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

/** A board card, matched to a fleet row by `path` basename === the row's `planFile`. */
function card(slug: string, file: string, phase: string) {
  return { slug, title: slug, type: 'feature', phase, path: file, prs: [] };
}

/**
 * The pulse the operator's board shows AFTER one plan is approved and before
 * anyone has taken it — the two ends of the path held at once.
 *
 *   - `approved-and-waiting`: one eligible, unbegun wave in NOT STARTED. This is
 *     where an approval lands, and the row Start work acts on.
 *   - `still-a-draft`: a shelved (`deferred`) branch of a plan still under
 *     review. `classify` routes it to WAITING ON YOU — the act it waits on is
 *     the approval, which lives on the plan head — so it must NOT appear in NOT
 *     STARTED. This is the row the old `'draft'` allowlist wrongly admitted.
 */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    // The approved plan's unbegun wave — in NOT STARTED, eligible, startable.
    row({
      plan: APPROVED_SLUG, planFile: APPROVED_FILE,
      branch: 'feature/approved-w1', wave: 'Sown', waitingDays: 3,
      group: 'not-started', state: 'open', waitingOn: 'click',
      note: ELIGIBLE_NOTE, verdict: 'eligible',
    }),
    // The Draft plan's shelved branch — WAITING ON YOU, never NOT STARTED.
    row({
      plan: DRAFT_SLUG, planFile: DRAFT_FILE,
      branch: 'feature/draft-shelved', wave: 'Set aside', state: 'deferred',
      group: 'waiting-on-you', ageMinutes: 400, waitingDays: 2,
      waitingOn: 'you', note: DRAFT_PLAN_NOTE, verdict: 'eligible',
      branchUrl: `${GH}/tree/feature/draft-shelved`,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    summary: { plans: 2, waves: 2, branches: rows.length, claimed: 0, eligible: 1, blocked: 0, deferred: 1 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [], issueAnswer: 'unsupported', issueError: null,
    ...over,
  } as Fleet;
}

describe('a plan moves through the sections — approve it, and Start work takes it', () => {
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

  /** The Discovery tab — where the card's Approve lives. */
  async function openBoard(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    // SYNCHRONOUS route callbacks — an awaited `route.fetch()` can still be in
    // flight when the page closes and fails a test that already passed.
    await page.route('**/api/board', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(board()) }));
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.goto(baseURL);
    return page;
  }

  /** The Agents tab — where the fleet's rows and NOT STARTED live. */
  async function openAgents(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    await page.route('**/api/board', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(board()) }));
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Not started').first().waitFor({ timeout: 10_000 });
    return page;
  }

  const notStarted = (page: Page) =>
    page.locator('ul[role="grid"][aria-label^="Not started"]');
  const cardFor = (page: Page, title: string) => page.locator('article', { hasText: title });

  it('offers Approve on the Draft plan card — the operator\'s first act', async () => {
    // LEG 1. The path begins on the card in Discovery: a Draft plan offers
    // Approve, and it is a real <button> — never an anchor, since it writes and
    // must not be openable in a new tab. `approve.browser.test.ts` walks the
    // arm-then-post; here it is only the entrance to the walk.
    const page = await openBoard();
    try {
      const button = cardFor(page, DRAFT_SLUG).getByRole('button', { name: 'Approve' });
      await button.waitFor({ timeout: 10_000 });
      expect(await button.evaluate((el) => el.tagName)).toBe('BUTTON');
    } finally {
      await page.close();
    }
  });

  it('shows the approved plan in NOT STARTED — the section its approval lands in', async () => {
    // LEG 2, AND WAVE 1'S ADMISSION FIX. The plan must reach NOT STARTED
    // SPECIFICALLY — a test that only counts rows somewhere passes with the old
    // routing intact. The section is located by its own accessible name, and the
    // plan is found by its `data-plan-row`.
    const page = await openAgents();
    try {
      await expect
        .poll(() => notStarted(page).locator(`li[data-plan-row="${APPROVED_SLUG}"]`).count(), { timeout: 10_000 })
        .toBe(1);
    } finally {
      await page.close();
    }
  });

  it('keeps the Draft plan\'s shelved branch OUT of NOT STARTED', async () => {
    // THE NEGATIVE JUNCTION, and the only assertion that catches the old
    // `'draft'` allowlist returning. NOT STARTED means *approved — nobody has
    // taken it*; a Draft plan's shelved branch waits on the approval, so it
    // belongs in WAITING ON YOU. It must be reachable SOMEWHERE (grouping moves
    // a row, never loses it) and it must not be HERE.
    const page = await openAgents();
    try {
      // Present on the board — this is an absence, not an empty page.
      await expect
        .poll(() => page.locator('[data-branch="feature/draft-shelved"]').count(), { timeout: 10_000 })
        .toBeGreaterThan(0);
      // …but nowhere inside NOT STARTED, folded or not. Open every fold first, so
      // this is not passing merely because the branch sits behind a shut one.
      await expandAgentFolds(page);
      expect(await notStarted(page).locator('[data-branch="feature/draft-shelved"]').count()).toBe(0);
      expect(await notStarted(page).locator(`li[data-plan-row="${DRAFT_SLUG}"]`).count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('offers Start work in NOT STARTED, and the click DISPATCHES', async () => {
    // LEG 3, THE END OF THE PATH. Start work must DISPATCH, not merely render: a
    // disabled-but-present control passes a presence check. The dispatch is
    // stubbed at the network boundary — nothing creates a worktree or pushes a
    // claim — and what is asserted is that the POST to `/api/dispatch` is made.
    //
    // The wave row's `⋯` opens the menu; `StartWorkButton` posts on the click —
    // it goes to `starting…` and the pulse, not a second click, confirms.
    const page = await openAgents();
    let dispatched: string | null = null;
    // Record the POST, then fulfil it like a real 202 so the button settles.
    await page.route('**/api/dispatch', (route) => {
      dispatched = new URL(route.request().url()).pathname;
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ slug: APPROVED_SLUG, log: `/tmp/plot-dispatch-${APPROVED_SLUG}.log` }),
      });
    });
    try {
      await expandAgentFolds(page);
      // The eligible wave's menu — `WaveActions` renders `data-wave-actions` for
      // an eligible wave once a card and a dispatch verdict exist.
      const menuButton = notStarted(page).locator('[data-wave-actions="Sown"]');
      await menuButton.waitFor({ timeout: 10_000 });
      await menuButton.click();

      const start = page.getByRole('button', { name: 'Start work' });
      await start.waitFor({ timeout: 10_000 });
      // ONE click dispatches. `StartWorkButton` posts on the click and goes to
      // `starting…`; the row moving on a later pulse is the confirmation, so
      // there is no second click to make.
      await start.click();

      // THE assertion: a POST reached `/api/dispatch`, so the click dispatched.
      await expect.poll(() => dispatched, { timeout: 10_000 }).toBe('/api/dispatch');
    } finally {
      await page.close();
    }
  });
});
