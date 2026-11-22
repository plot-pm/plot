import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet, type Slice } from '../../src/contract/schema.js';

/**
 * A PLAN SPREAD ACROSS SECTIONS SAYS HOW MANY OF ITS WAVES ARE NOT HERE — and
 * renders none of them.
 *
 * A plan may legitimately span sections: a wave merged into DONE while a later
 * wave waits in NOT STARTED. The board draws it one head per section, and until
 * now each head was SILENT about the waves the other section holds —
 * `sliceSummaryFor` counts what its section has and says nothing of the rest. The
 * visible half of a two-wave plan therefore read indistinguishably from a plan
 * that only ever had one wave, which is the confusion `a-split-plan-says-it-is-split`
 * was filed for.
 *
 * The count itself is a pure function of `fleet.waves` — asserted over its whole
 * shape in `test/unit/agent-list.test.ts` (`slicesElsewhere`, `elsewhereNote`).
 * What only a rendered page can settle is the CONNECTION: that each section's
 * head STATES the count, and that the rows of a wave in another section do NOT
 * appear under the head here. The numerator was undefined until a wave had ONE
 * section (`a-wave-is-one-row`); this walk proves the head reads that answer.
 *
 * `/api/fleet` is stubbed at the network boundary, the sibling suites' way, and
 * the client CASTS the fleet — so the fixture carries the `slices` array the
 * server would have derived (`deriveSlices`), each entry naming its ONE section,
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
  wave: 'w', state: 'open', phase: 'Development', planState: 'approved', group: 'not-started', ageMinutes: null,
  waitingOn: 'click', note: ELIGIBLE_NOTE, pr: null, branchUrl: '', waitingDays: 3,
  localDirty: false, localLocked: false, stuck: null, verdict: 'eligible',
  // The default is startable (open + click + eligible), so `startability: 'start-work'`.
  startability: 'start-work' as const,
  ...over,
});

/** One derived wave, carrying its ONE section — what the server writes beside the rows. */
const slice = (name: string, section: Slice['section'], over: Partial<Slice> = {}): Slice => ({
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
      startability: null, // merged branches have no startability
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
    slices: [slice('Sown', 'done'), slice('Grown', 'not-started')],
    summary: { plans: 1, waves: 2, branches: rows.length, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
    stuck: { stuck: 0, artifact: 0, conflict: 0, unpushed: 0, ci: 0 },
    prAgeSeconds: 1, prNextInSeconds: 59, scanNextInSeconds: 4, prError: null,
    issues: [], issueAnswer: 'unsupported', issueError: null,
    ...over,
  } as Fleet;
}

describe('a split plan counts what is elsewhere', () => {
  // THE STATE IS SERVED, NOT SPAWNED AND STUBBED.
  //
  // This file started `board-server.mjs` over the tiny-garden fixture only to
  // serve `index.html`: it never read `/api/board`, and stubbed `/api/fleet`
  // itself. The mock serves the same built client and answers both payloads by
  // name, so the test states its own input instead of inheriting an estate.
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
      over: { fleet: fleet() },
      viewport: { width: 1400, height: 1200 },
    });
    await page.locator('[data-delivery-section="work-items"]').waitFor({ timeout: 10_000 });
    return page;
  }

  const notStarted = (page: Page) => page.locator('ul[role="grid"][aria-label^="Queued"]');
  const planHead = (grid: ReturnType<typeof notStarted>, plan: string) =>
    grid.locator(`li[data-plan-row="${plan}"]`);

  it('states in the NOT STARTED head that a wave is elsewhere', async () => {
    // The head speaks for the one unstarted wave and says the other is elsewhere.
    // A test reading only the section-scoped `1 slice, first eligible` passes with
    // the OLD silent behaviour — this asserts the elsewhere clause specifically.
    const page = await open();
    try {
      await expect.poll(() =>
        planHead(notStarted(page), SPLIT).locator('[data-slice-summary]').textContent(),
        { timeout: 10_000 })
        .toMatch(/1 slice elsewhere/);
    } finally {
      await page.close();
    }
  });

  it('lists the split plan once under Release delivery, with its delivered slice counted', async () => {
    // The DONE half of the split is one Release row: the merged slice is a
    // strip segment, not a row of its own, and the unstarted slice is not
    // rendered under it.
    const page = await open();
    try {
      const row = page.locator(`[data-release-block] li[data-plan-row="${SPLIT}"]`);
      await row.waitFor({ timeout: 10_000 });
      await expect.poll(() => row.locator('[data-strip-segment="delivered"]').textContent(),
        { timeout: 10_000 }).toMatch(/1\s+delivered/);
      expect(await page.locator('[data-release-block] [data-slice-row]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('keeps the unstarted slice of the split plan in NOT STARTED, never as a Release row', async () => {
    const page = await open();
    try {
      await expect.poll(() =>
        notStarted(page).locator('[data-slice-row="Grown"]').count(), { timeout: 10_000 })
        .toBe(1);
      expect(await page.locator('[data-release-block] [data-slice-row="Grown"]').count()).toBe(0);
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
            slices: [
              { plan: 'whole-plan', name: 'One', branches: ['feature/a'], verdict: 'eligible', section: 'not-started', complete: false },
              { plan: 'whole-plan', name: 'Two', branches: ['feature/b'], verdict: 'blocked', section: 'not-started', complete: false },
            ],
            summary: { plans: 1, waves: 2, branches: 2, claimed: 0, eligible: 1, blocked: 1, deferred: 0 },
          })),
        }));
      await page.goto(`${cat.mock.baseURL}?tab=agents`);
      await page.locator('[data-delivery-section="work-items"]').waitFor({ timeout: 10_000 });
      const summary = planHead(notStarted(page), 'whole-plan').locator('[data-slice-summary]');
      await expect.poll(() => summary.textContent(), { timeout: 10_000 })
        .toBe('2 slices, first eligible');
      // No middot, no "elsewhere" — the whole plan says only what it holds.
      expect(await summary.textContent()).not.toMatch(/elsewhere/);
    } finally {
      await page.close();
    }
  });
});
