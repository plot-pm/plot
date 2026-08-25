import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { type AgentEntry, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * WORKING RENDERS THE WORKERS THAT ARE WORKING —
 * `working-lists-the-live-agents`, driven in a REAL browser against the shipped
 * artifact.
 *
 * `the-working-section-shows-every-worker` inverted a branch-derived section so
 * a live worker was never hidden by its branch's row being absent, scratch or
 * merged. It kept EVERY registry entry — and a registry entry for a session
 * that has ENDED is not a worker. WORKING now filters to the LIVE states
 * (`running`, `waiting`) so its subject (who is working) matches its contents:
 * the measured defect was `WORKING (16)` over four live workers and twelve
 * ended sessions. The `stalled`/`unknown` entries reach WAITING ON YOU as a
 * problem report (a separate wave); `finished` drains through reconciliation.
 *
 * These fixtures keep every awkward shape the inversion was for — a live worker
 * whose branch has no row, one whose branch merged into DONE — plus a worker in
 * every one of the five registry states, so the filter is proven against the
 * whole enum and not just the happy two.
 *
 * `/api/fleet` is stubbed at the network boundary: every claim here is about
 * what the tab RENDERS from a pulse.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const GH = 'https://github.com/tiny/garden/tree/';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/x', plan: 'plant-tomatoes',
  planFile: '2026-03-01-plant-tomatoes.md', wave: 'w', state: 'wip',
  phase: 'Development', group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: `${GH}feature/x`, waitingDays: null,
  startability: 'someone-is-on-it' as const,
  ...over,
});

const agent = (over: Partial<AgentEntry> = {}): AgentEntry => ({
  session: 'sess0000', branch: 'feature/x', worktree: '/wt/plot-wt-x',
  command: '', startedAt: '', pid: '', previousPid: '', relaunches: 0,
  state: 'running', ...over,
});

/**
 * A pulse whose REGISTRY names workers in every state — the branch rows in
 * WORKING are fewer, and three of the seven entries have ended.
 *
 * LIVE — must render in WORKING:
 * - `feature/running` — a plain WORKING branch, a worker on it.
 * - `feature/landed` — MERGED: its branch row sits in DONE, and its live worker
 *   must still show in WORKING. The join survives the filter.
 * - `main` — no branch row anywhere; the board is served from it.
 * - `idea/recut-a` — a scratch branch no plan lists, no row; state `waiting`,
 *   which is live: a worker mid-task that stopped to ask.
 *
 * ENDED — must NOT render in WORKING:
 * - `idea/recut-b` — `stalled`, work on the floor: belongs in WAITING ON YOU.
 * - `idea/recut-c` — `finished`: the PR carries it, no row of its own.
 * - `idea/recut-d` — `unknown`: the board cannot say; belongs in WAITING ON YOU.
 */
function fleet(over: Partial<Fleet> = {}): Fleet {
  const rows: AgentRow[] = [
    row({ branch: 'feature/running', plan: 'beans' }),
    // MERGED — its own row belongs in DONE, a true fact about the work.
    row({ branch: 'feature/landed', plan: 'beans', group: 'done', state: 'merged',
      ageMinutes: 120, note: 'merged', branchUrl: '' }),
  ];
  const agents: AgentEntry[] = [
    agent({ session: 'run00001', branch: 'feature/running', state: 'running' }),
    // A worker whose branch merged: joins the DONE row, renders in WORKING.
    agent({ session: 'lan00002', branch: 'feature/landed', state: 'running' }),
    // A worker the board is served from — `main` is in no pulse row.
    agent({ session: 'main0003', branch: 'main', worktree: '/wt/plot', state: 'running' }),
    // Live: a worker that stopped to ask a person, still mid-task.
    agent({ session: 'wait0004', branch: 'idea/recut-a', state: 'waiting' }),
    // Ended: the three non-live states, each on a branch with no row.
    agent({ session: 'stal0005', branch: 'idea/recut-b', state: 'stalled' }),
    agent({ session: 'fini0006', branch: 'idea/recut-c', state: 'finished' }),
    agent({ session: 'unkn0007', branch: 'idea/recut-d', state: 'unknown' }),
  ];
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null,
    rows, agents,
    summary: { plans: 1, waves: 1, branches: rows.length,
      claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    prAgeSeconds: 74, prNextInSeconds: 46, scanNextInSeconds: 3, prError: null,
    ...over,
  };
}

describe('WORKING renders one row per LIVE registry entry', () => {
  let server: { port: number; kill: () => void };
  let browser: Browser;
  let baseURL: string;

  beforeAll(async () => {
    server = await startServer(FIXTURE);
    baseURL = `http://localhost:${server.port}/`;
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    server?.kill();
  });

  async function openAgents(payload: Fleet = fleet()): Promise<Page> {
    const page = await browser.newPage();
    await page.route('**/api/fleet', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    return page;
  }

  /** The section for one waiting-group, by its heading text. */
  const group = (page: Page, label: string) =>
    page.locator('section').filter({
      has: page.getByRole('heading', { level: 2, name: new RegExp(label) }),
    });

  it('renders a row for every LIVE registry entry and none of the ended ones', async () => {
    // Done when #1: seven entries, four live (`running`×3 + `waiting`), three
    // ended (`stalled`, `finished`, `unknown`). WORKING renders the four and no
    // more. Every agent row carries `data-agent-row`.
    const page = await openAgents();
    try {
      await expect.poll(() => group(page, 'Working').locator('[data-agent-row]').count())
        .toBe(4);
    } finally {
      await page.close();
    }
  });

  it('renders a live worker whose branch has no row anywhere', async () => {
    // The `main` worker and the `idea/recut-a` scratch branch (state `waiting`,
    // live) have no pulse row at all. A branch-join fix silently misses exactly
    // these.
    const page = await openAgents();
    try {
      const working = group(page, 'Working');
      await expect.poll(() => working.locator('[data-branch="main"]').count()).toBe(1);
      await expect.poll(() => working.locator('[data-branch="idea/recut-a"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('renders a merged live worker in WORKING while its branch keeps its DONE row', async () => {
    // Both are true and asserted together. `feature/landed` merged, so its
    // branch row is in DONE — a fact about the work — and its running worker is
    // in WORKING — a fact about the fleet. The filter passes it because the
    // worker is `running`, and the join is not rewritten.
    const page = await openAgents();
    try {
      const working = group(page, 'Working');
      const done = group(page, 'Done');
      await expect.poll(() => working.locator('[data-branch="feature/landed"]').count()).toBe(1);
      // DONE starts folded; open it and the branch's own row is still there.
      const toggle = page.locator('[data-group-toggle="done"]');
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      await expect.poll(() => done.locator('[data-branch="feature/landed"]').count())
        .toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  it('does NOT render an ended session — stalled, finished or unknown — in WORKING', async () => {
    // Done when #1: the three ended entries are absent from WORKING. This is the
    // measured defect the plan exists to fix — a section whose subject is *who
    // is working* listing sessions that have ended. Their destinations belong to
    // other waves; here we only assert they have left WORKING.
    const page = await openAgents();
    try {
      const working = group(page, 'Working');
      await expect.poll(() => working.locator('[data-branch="idea/recut-b"]').count()).toBe(0);
      await expect.poll(() => working.locator('[data-branch="idea/recut-c"]').count()).toBe(0);
      await expect.poll(() => working.locator('[data-branch="idea/recut-d"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('reads *someone is on it* for a running worker', async () => {
    // A running worker names its own condition; the label is the live one.
    const page = await openAgents();
    try {
      const working = group(page, 'Working');
      const rowText = (branch: string) =>
        working.locator('li').filter({ has: page.locator(`[data-branch="${branch}"]`) })
          .last().textContent();

      await expect.poll(() => rowText('feature/running')).toContain('someone is on it');
    } finally {
      await page.close();
    }
  });
});
