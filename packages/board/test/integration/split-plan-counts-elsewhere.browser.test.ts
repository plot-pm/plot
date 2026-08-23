import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer, expandAgentFolds } from '../helpers.mjs';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet, type Wave } from '../../src/contract/schema.js';

/**
 * A PLAN SPREAD ACROSS SECTIONS SAYS HOW MANY OF ITS WAVES ARE NOT HERE — and
 * renders none of them.
 *
 * A plan may legitimately span sections: a wave merged into DONE while a later
 * wave waits in NOT STARTED. The board draws it one head per section, and until
 * now each head was SILENT about the waves the other section holds —
 * `waveSummaryFor` counts what its section has and says nothing of the rest. The
 * visible half of a two-wave plan therefore read indistinguishably from a plan
 * that only ever had one wave, which is the confusion `a-split-plan-says-it-is-split`
 * was filed for.
 *
 * The count itself is a pure function of `fleet.waves` — asserted over its whole
 * shape in `test/unit/agent-list.test.ts` (`wavesElsewhere`, `elsewhereNote`).
 * What only a rendered page can settle is the CONNECTION: that each section's
 * head STATES the count, and that the rows of a wave in another section do NOT
 * appear under the head here. The numerator was undefined until a wave had ONE
 * section (`a-wave-is-one-row`); this walk proves the head reads that answer.
 *
 * `/api/fleet` is stubbed at the network boundary, the sibling suites' way, and
 * the client CASTS the fleet — so the fixture carries the `waves` array the
 * server would have derived (`deriveWaves`), each entry naming its ONE section,
 * plus the branch rows already grouped the way the pulse would have grouped them.
 * Route callbacks are SYNCHRONOUS: the board polls on a timer and an awaited
 * `route.fetch()` can still be in flight when the page closes.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

/** The plan split across DONE and NOT STARTED — the whole subject of this suite. */
const SPLIT = 'harvest-plan';
const SPLIT_FILE = '2026-08-16-harvest-plan.md';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: SPLIT, planFile: SPLIT_FILE,
  wave: 'w', state: 'open', phase: 'Development', group: 'not-started', ageMinutes: null,
  waitingOn: 'click', note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, repair: null, verdict: 'eligible',
  ...over,
});

/** One derived wave, carrying its ONE section — what the server writes beside the rows. */
const wave = (name: string, section: Wave['section'], over: Partial<Wave> = {}): Wave => ({
  plan: SPLIT, name, branches: [], verdict: section === 'done' ? 'complete' : 'eligible',
  section, complete: section === 'done', ...over,
});

/**
 * A pulse holding ONE plan whose two waves sit in two sections.
 *
 *   - `Sown`  — every branch merged, so the wave is `done`; its branch renders in
 *               DONE, and the DONE head speaks for it.
 *   - `Grown` — an unstarted, eligible wave; its branch renders in NOT STARTED,
 *               and the NOT STARTED head speaks for it.
 *
 * Each head must state that ONE wave is elsewhere, and neither may render the
 * other's row.
 */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    // The merged wave — in DONE.
    row({
      branch: 'feature/sown', wave: 'Sown', state: 'merged', group: 'done',
      verdict: 'complete', waitingOn: 'time', note: 'delivered',
      ageMinutes: 200, waitingDays: null, branchUrl: `${GH}feature/sown`,
      pr: { number: 40, url: 'https://github.com/tiny/garden/pull/40', draft: false, state: 'merged' },
    }),
    // The unstarted wave — in NOT STARTED.
    row({
      branch: 'feature/grown', wave: 'Grown', state: 'open', group: 'not-started',
      verdict: 'eligible', waitingOn: 'click', note: ELIGIBLE_NOTE, waitingDays: 4,
    }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null, rows,
    waves: [wave('Sown', 'done'), wave('Grown', 'not-started')],
    summary: { plans: 1, waves: 2, branches: rows.length, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [], issueAnswer: 'unsupported', issueError: null,
    ...over,
  } as Fleet;
}

describe('a split plan counts what is elsewhere', () => {
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
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet()) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Not started').first().waitFor({ timeout: 10_000 });
    return page;
  }

  const notStarted = (page: Page) => page.locator('ul[role="grid"][aria-label^="Not started"]');
  const done = (page: Page) => page.locator('ul[role="grid"][aria-label^="Done"]');
  const planHead = (grid: ReturnType<typeof notStarted>, plan: string) =>
    grid.locator(`li[data-plan-row="${plan}"]`);

  /**
   * DONE is `COLLAPSED_BY_DEFAULT`, so the section itself is folded on load and
   * its rows are removed from the tree — `expandAgentFolds` opens plan/wave
   * folds, not section folds. Open the DONE section first, the way a reader does,
   * then open every plan/wave fold inside it.
   */
  async function openDone(page: Page): Promise<void> {
    if (await done(page).count() === 0) {
      await page.locator('[data-group-toggle]').filter({ hasText: 'Done' }).click();
    }
    await done(page).first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
  }

  it('states in the NOT STARTED head that a wave is elsewhere', async () => {
    // The head speaks for the one unstarted wave and says the other is elsewhere.
    // A test reading only the section-scoped `1 wave, first eligible` passes with
    // the OLD silent behaviour — this asserts the elsewhere clause specifically.
    const page = await open();
    try {
      await expect.poll(() =>
        planHead(notStarted(page), SPLIT).locator('[data-wave-summary]').textContent(),
        { timeout: 10_000 })
        .toMatch(/1 wave elsewhere/);
    } finally {
      await page.close();
    }
  });

  it('states in the DONE head that a wave is elsewhere', async () => {
    // The other end of the split. The DONE head's own wave has no unbegun summary
    // to lead with, so the elsewhere clause stands alone — which the join in
    // `PlanRow` must handle without a stray leading middot.
    const page = await open();
    try {
      await openDone(page);
      const summary = planHead(done(page), SPLIT).locator('[data-wave-summary]');
      await expect.poll(() => summary.textContent(), { timeout: 10_000 })
        .toBe('1 wave elsewhere');
    } finally {
      await page.close();
    }
  });

  it('renders NONE of the elsewhere waves\' rows under the head here', async () => {
    // The second half of the spec: the head says how many are elsewhere and shows
    // none of them. Each section renders its own waves ONLY — a wave is one row in
    // one section — so the merged wave's row belongs to DONE and the unstarted
    // wave's row to NOT STARTED, and neither appears under the other's head. The
    // rows are WAVE rows (`data-wave-row`) here, not branch rows: a plan head
    // groups its branches by wave, so `data-branch` is gone and the wave name is
    // the hook. Open every fold first, so this is not passing merely because a row
    // sits behind a shut one.
    const page = await open();
    try {
      await openDone(page);
      // The merged wave lives in DONE, never NOT STARTED.
      await expect.poll(() =>
        done(page).locator('[data-wave-row="Sown"]').count(), { timeout: 10_000 })
        .toBe(1);
      expect(await notStarted(page).locator('[data-wave-row="Sown"]').count()).toBe(0);
      // The unstarted wave lives in NOT STARTED, never DONE.
      await expect.poll(() =>
        notStarted(page).locator('[data-wave-row="Grown"]').count(), { timeout: 10_000 })
        .toBe(1);
      expect(await done(page).locator('[data-wave-row="Grown"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('says nothing about elsewhere for a plan that has not split', async () => {
    // The guard against noise. A plan wholly within one section — the common case
    // — must not grow an `elsewhere` clause. This is the negative that a naive
    // `waves.length - here` gets wrong by counting a plan's own waves as elsewhere.
    const page = await open();
    try {
      // Add a whole plan sitting entirely in NOT STARTED, both waves here.
      await page.route('**/api/fleet', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(fleet({
            rows: [
              row({ plan: 'whole-plan', planFile: 'w.md', branch: 'feature/a', wave: 'One', group: 'not-started', verdict: 'eligible' }),
              row({ plan: 'whole-plan', planFile: 'w.md', branch: 'feature/b', wave: 'Two', group: 'not-started', verdict: 'blocked', waitingOn: 'time', note: 'blocked by One' }),
            ],
            waves: [
              { plan: 'whole-plan', name: 'One', branches: ['feature/a'], verdict: 'eligible', section: 'not-started', complete: false },
              { plan: 'whole-plan', name: 'Two', branches: ['feature/b'], verdict: 'blocked', section: 'not-started', complete: false },
            ],
            summary: { plans: 1, waves: 2, branches: 2, claimed: 0, eligible: 1, blocked: 1, deferred: 0 },
          })),
        }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Not started').first().waitFor({ timeout: 10_000 });
      const summary = planHead(notStarted(page), 'whole-plan').locator('[data-wave-summary]');
      await expect.poll(() => summary.textContent(), { timeout: 10_000 })
        .toBe('2 waves, first eligible');
      // No middot, no "elsewhere" — the whole plan says only what it holds.
      expect(await summary.textContent()).not.toMatch(/elsewhere/);
    } finally {
      await page.close();
    }
  });
});
