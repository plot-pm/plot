import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * THE ROUNDS RIDE BESIDE THE PHASE — a badge, not another count.
 *
 * `rounds` is how many times `/challenge-the-plan` interrogated a plan. It used
 * to render inside the plan head's summary run, as `2 waves · 2 branches ·
 * 2 rounds` — where it read as a third tally of the plan's PARTS. It is not
 * one: it is the STATE of the discovery work, so it belongs beside the phase.
 * `Discovery` says a plan is being thought about; the badge says how far that
 * thinking got.
 *
 * Three things only a rendered page settles, and each is here because a naive
 * implementation passes without it:
 *
 *   1. BOTH plan-head paths carry it. They are asymmetric — the PLAN-GROUP path
 *      (NOT STARTED) and the `planHeads` path (WAITING ON YOU) — and a test on
 *      one passes while half the boards stay wrong. This is the trap
 *      `folded-plan-pr-fold.browser.test.ts` records costing a fix already.
 *   2. It does NOT replace the phase, and does not evict the verdict or the PR
 *      fold from the same cell. All of them are siblings; a plan in Discovery
 *      with an eligible wave must say both.
 *   3. It leaves the summary run. A badge that also stayed in `2 waves · …`
 *      would satisfy 1 and 2 and still not be the change.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'a-plan', planFile: '2026-08-16-a-plan.md',
  wave: 'w', state: 'open', phase: 'Discovery', group: 'not-started', ageMinutes: null,
  waitingOn: 'click' as const, note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null,
  ...over,
});

/**
 * Two plans on the two paths, plus one with no rounds at all.
 *
 *   `interrogated`  PLAN-GROUP (NOT STARTED), 2 rounds  → badge reads `2 rounds`
 *   `reviewed`      planHeads  (WAITING ON YOU), 1 round → badge reads `1 round`
 *   `untouched`     PLAN-GROUP, no metadata block        → NO badge at all
 */
function fleet(): Fleet {
  const rows: AgentRow[] = [
    row({ plan: 'interrogated', planFile: '2026-08-16-interrogated.md',
          branch: 'feature/i-one', wave: 'One', group: 'not-started' }),
    row({ plan: 'interrogated', planFile: '2026-08-16-interrogated.md',
          branch: 'feature/i-two', wave: 'Two', group: 'not-started' }),
    row({ plan: 'untouched', planFile: '2026-08-16-untouched.md',
          branch: 'feature/u-one', wave: 'One', group: 'not-started' }),
    row({ plan: 'reviewed', planFile: '2026-08-16-reviewed.md',
          branch: 'feature/r-one', wave: 'One', group: 'waiting-on-you',
          waitingOn: 'review' as const }),
    // PAST DISCOVERY, and interrogated twice. The badge must NOT appear.
    row({ plan: 'shipped', planFile: '2026-08-16-shipped.md',
          branch: 'feature/s-one', wave: 'One', group: 'not-started',
          phase: 'Testing' }),
  ];
  return {
    generatedAt: new Date(0).toISOString(), ageSeconds: 0, ready: true, complete: true,
    error: null, rows, waves: [], summary: null, stuck: [], agents: [], issues: [],
  } as unknown as Fleet;
}

/** The card side — where `rounds` actually comes from. */
const CARDS: { slug: string; planFile: string; rounds?: number; phase?: string }[] = [
  { slug: 'interrogated', planFile: '2026-08-16-interrogated.md', rounds: 2 },
  { slug: 'reviewed', planFile: '2026-08-16-reviewed.md', rounds: 1 },
  { slug: 'untouched', planFile: '2026-08-16-untouched.md', rounds: undefined },
  // Carries rounds AND is past Discovery — the pair the phase gate is about.
  { slug: 'shipped', planFile: '2026-08-16-shipped.md', rounds: 3, phase: 'Testing' },
];

describe('the rounds ride beside the phase', () => {
  let browser: Browser;
  let server: Awaited<ReturnType<typeof startServer>>;
  let baseURL: string;
  // Fetched ONCE and served statically: proxying per request with
  // `route.fetch()` races the background poll against teardown, and the route
  // callback must stay synchronous — the rule this repo already learned.
  let boardWithCards: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
    const board = await (await fetch(`${baseURL}api/board`)).json();
    const col = board.columns[0];
    for (const c of CARDS) {
      col.cards.push({
        slug: c.slug, title: c.slug, type: 'bug', phase: c.phase ?? col.phase,
        path: `docs/plans/${c.planFile}`, prs: [], phaseDate: '2026-08-16',
        ...(c.rounds === undefined ? {} : { rounds: c.rounds }),
      });
    }
    boardWithCards = JSON.stringify(board);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  async function open(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.route('**/api/board', (route) =>
      route.fulfill({ contentType: 'application/json', body: boardWithCards }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Waiting on you').first().waitFor({ timeout: 10_000 });
    return page;
  }

  const planRow = (page: Page, plan: string) => page.locator(`li[data-plan-row="${plan}"]`);
  const badge = (page: Page, plan: string) => planRow(page, plan).locator('[data-plan-rounds]');

  it('PLAN-GROUP PATH: a plan interrogated twice says `2 rounds` beside its phase', async () => {
    const page = await open();
    try {
      await expect.poll(() => badge(page, 'interrogated').count(), { timeout: 10_000 }).toBe(1);
      expect(await badge(page, 'interrogated').textContent()).toContain('2 rounds');
      // THE PHASE IS STILL THERE. The badge rides beside it, never replacing it
      // — the defect the PR fold's own test exists to keep shut.
      const cell = planRow(page, 'interrogated').locator('[data-phase]');
      expect(await cell.getAttribute('data-phase')).toBe('Discovery');
    } finally { await page.close(); }
  });

  it('planHeads PATH: the other plan-head path carries it too', async () => {
    const page = await open();
    try {
      // The asymmetric second path. A fix on one only leaves half the boards
      // silent, which is why this assertion is separate rather than a loop.
      await expect.poll(() => badge(page, 'reviewed').count(), { timeout: 10_000 }).toBe(1);
      expect(await badge(page, 'reviewed').textContent()).toContain('1 round');
      // SINGULAR. `1 rounds` is the tell that the count was interpolated raw.
      expect(await badge(page, 'reviewed').textContent()).not.toContain('1 rounds');
    } finally { await page.close(); }
  });

  it('a plan that was never interrogated wears NO badge', async () => {
    const page = await open();
    try {
      await expect.poll(() => planRow(page, 'untouched').count(), { timeout: 10_000 })
        .toBeGreaterThan(0);
      // Absent, not `0 rounds` — which would read as *interrogated and found
      // nothing*, the rule `roundsBadgeText` owns.
      expect(await badge(page, 'untouched').count()).toBe(0);
    } finally { await page.close(); }
  });

  it('DOES NOT RENDER PAST DISCOVERY, even with rounds recorded', async () => {
    const page = await open();
    try {
      await expect.poll(() => planRow(page, 'shipped').count(), { timeout: 10_000 })
        .toBeGreaterThan(0);
      // `roundsBadgeText` gates on `isDraft` — phase === 'Discovery' — and this
      // plan is in Testing with `rounds: 3`. The badge is a DISCOVERY-phase
      // reading: it says how far the thinking got while the thinking is the
      // work. Once a plan is being built, its rounds are history.
      //
      // THIS IS THE ASSERTION A REIMPLEMENTATION FAILS. Every other test here
      // uses a Discovery plan, so a version that read `card.rounds` directly and
      // skipped the gate passes all of them and lights the badge up across three
      // more phases.
      expect(await badge(page, 'shipped').count()).toBe(0);
      // The phase itself is untouched — this is about the badge, not the cell.
      const cell = planRow(page, 'shipped').locator('[data-phase]');
      expect(await cell.getAttribute('data-phase')).toBe('Testing');
    } finally { await page.close(); }
  });

  it('LEAVES THE SUMMARY RUN — it is not a third count of the plan\'s parts', async () => {
    const page = await open();
    try {
      await expect.poll(() => badge(page, 'interrogated').count(), { timeout: 10_000 }).toBe(1);
      // The wave summary still says what the plan holds, and says nothing about
      // rounds. A badge that ALSO stayed in the run passes every test above.
      const aside = planRow(page, 'interrogated').locator('[data-wave-summary]');
      if (await aside.count()) {
        expect(await aside.textContent()).not.toContain('round');
      }
    } finally { await page.close(); }
  });
});
