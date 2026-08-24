import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../helpers.mjs';
import { type AgentEntry, type AgentRow, type Fleet } from '../../src/contract/schema.js';

/**
 * WORKING RENDERS FROM THE REGISTRY — `the-working-section-shows-every-worker`,
 * wave 1 (Shown), driven in a REAL browser against the shipped artifact.
 *
 * The section used to render one row per BRANCH row `classify` put in WORKING,
 * joined to a registry entry. This inverts it: one row per REGISTRY entry,
 * joined BACK to a branch row where one exists. The measured defect was 23
 * registry entries and 0 rows; these fixtures are the awkward shapes behind
 * that — a worker whose branch has no row at all, a worker whose branch merged
 * into DONE, and workers in every one of the five registry states.
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
 * A pulse whose REGISTRY names more workers than the branch rows in WORKING.
 *
 * - `feature/running` — a plain WORKING branch, a worker on it.
 * - `feature/landed` — MERGED: its branch row sits in DONE, and its worker must
 *   still show in WORKING. Done when #3.
 * - `main` — no branch row anywhere; the board is served from it. Done when #2.
 * - `feature/idle` — a scratch branch no plan lists, no row; state `waiting`.
 * - one worker in each remaining registry state, so all five render. #5.
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
    // The four non-running states, each on a branch with no row.
    agent({ session: 'wait0004', branch: 'idea/recut-a', state: 'waiting' }),
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

describe('WORKING renders one row per registry entry', () => {
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

  it('renders a row for every registry entry, not just the branch rows in WORKING', async () => {
    // Done when #1: N entries → N rows. Seven agents here; only ONE of their
    // branches (`feature/running`) is a WORKING branch row, so the old code
    // rendered one. Every agent row carries `data-agent-row`.
    const page = await openAgents();
    try {
      await expect.poll(() => group(page, 'Working').locator('[data-agent-row]').count())
        .toBe(7);
    } finally {
      await page.close();
    }
  });

  it('renders a worker whose branch has no row anywhere', async () => {
    // Done when #2: the `main` worker and the `idea/recut-*` scratch branches
    // have no pulse row at all. A branch-join fix silently misses exactly these.
    const page = await openAgents();
    try {
      const working = group(page, 'Working');
      await expect.poll(() => working.locator('[data-branch="main"]').count()).toBe(1);
      await expect.poll(() => working.locator('[data-branch="idea/recut-a"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('renders a merged worker in WORKING while its branch keeps its DONE row', async () => {
    // Done when #3: both are true and asserted together. `feature/landed`
    // merged, so its branch row is in DONE — a fact about the work — and its
    // worker is in WORKING — a fact about the fleet.
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

  it('reads *someone is on it* only for a running worker', async () => {
    // Done when #5: the running workers say it, the four other states each say
    // their own condition instead. A row whose usual state is a lie teaches its
    // reader to ignore the row.
    const page = await openAgents();
    try {
      const working = group(page, 'Working');
      const rowText = (branch: string) =>
        working.locator('li').filter({ has: page.locator(`[data-branch="${branch}"]`) })
          .last().textContent();

      await expect.poll(() => rowText('feature/running')).toContain('someone is on it');

      const waiting = await rowText('idea/recut-a');
      expect(waiting).toContain('waiting on you');
      expect(waiting).not.toContain('someone is on it');

      const stalled = await rowText('idea/recut-b');
      expect(stalled).toContain('stalled');
      expect(stalled).not.toContain('someone is on it');
    } finally {
      await page.close();
    }
  });
});
