import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Page } from 'playwright';
import { expandAgentFolds } from '../helpers.mjs';
import { openCatalogue, type Catalogue } from '../catalogue/index.js';
import { ELIGIBLE_NOTE, type AgentRow, type Fleet, type Board } from '../../src/contract/schema.js';

/**
 * THE BUTTON CLAIMS ONLY WHAT IT KNOWS, in a real browser against the artifact.
 *
 * Two things this file pins, both from the plan
 * `2026-08-20-the-agent-panel-shows-the-agent.md`:
 *
 *   1. The Start work button's transient message. A successful dispatch used to
 *      end at *no change — see log* — a FAILURE the button cannot know happened,
 *      plus a log path rendered as transient-only text that the next re-render
 *      destroyed. It now says only *Agent work will show up shortly*, and the
 *      row moving is the confirmation.
 *
 *   2. The `Status` entry. The dispatcher log — what *see log* pointed at — now
 *      has a durable home in the row's `...` menu, present whenever a dispatcher
 *      log exists, opening a panel that renders it.
 *
 * The dispatch itself is stubbed at the network boundary, so nothing creates a
 * worktree or pushes a claim; what is under test is what the PAGE says.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '../fixtures/tiny-garden');
const VIEWPORT = { width: 1280, height: 900 };

/** An approved, waved plan so the card carries a wave summary and a startable row. */
const WAVED_TITLE = 'Rebuild the raised beds';
const WAVED_PLAN = `# ${WAVED_TITLE}

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Frame

- \`feature/raised-beds-frame\` — new cedar sides
`;

/**
 * A copy of the garden OUTSIDE this repository, with one waved plan added.
 *
 * Outside for the reason the sibling refusal suite documents: `plot-config.sh`
 * locates config by `git rev-parse --show-toplevel`, so a fixture nested inside
 * the plot checkout would read plot's own `CLAUDE.md`.
 */
function gardenWithWaves(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-garden-claims-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/plans/2026-08-17-raised-beds.md'), WAVED_PLAN, 'utf8');
  return dir;
}

describe('the button claims only what it knows', () => {
  // THE STATE IS SERVED, capabilities included. This wrote a waved plan into a
  // temp garden and started a real board so the buttons would be available at
  // all; `a-board-that-can-act` states the card and the capability, and the
  // write routes stay intercepted, which is where a click's effect belongs.
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  const cardFor = (page: Page, title: string) => page.locator('article', { hasText: title });

  it('a successful dispatch shows the reassurance, not a failure, and no log path', async () => {
    // The garden is not a git repo, so no pulse lands and `Start work` refuses
    // on a WAVED plan (it cannot know which wave is eligible). A plan with NO
    // waves gets no summary and is left to `plot-dispatch.sh` — so that row's
    // button acts, which is the one this test needs.
    const page = await cat.open('a-board-that-can-act', { viewport: VIEWPORT });
    // 202 like a real dispatch, carrying the `log` path the server still sends —
    // the button must NOT surface it as transient text any more.
    await page.route('**/api/dispatch', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ slug: 'fix-leaky-hose', log: '/tmp/plot-dispatch-fix-leaky-hose.log' }),
      }));
    try {
      const card = cardFor(page, 'Fix the leaky soaker hose');
      const button = card.getByRole('button', { name: 'Start work' });
      await button.waitFor({ timeout: 10_000 });
      await button.click();

      // The button goes to `starting…` and stays there until the pulse resolves.
      // With no git pulse ever landing, it waits out PULSES_BEFORE_GIVING_UP and
      // then shows the reassurance — never a failure, never the log path.
      await card.getByText(/Agent work will show up shortly/).waitFor({ timeout: 10_000 });

      const text = (await card.textContent()) ?? '';
      // The old message and its two lies are both gone.
      expect(text).not.toMatch(/no change/i);
      expect(text).not.toContain('see log');
      // And the log path the 202 carried never reached the page as text.
      expect(text).not.toContain('/tmp/plot-dispatch-fix-leaky-hose.log');
    } finally {
      await page.close();
    }
  });

  it('the reassurance is not a failure colour', async () => {
    // Neutral (slate), not amber: an amber warning would re-assert the very
    // failure the old *no change* message wrongly implied.
    const page = await cat.open('a-board-that-can-act', { viewport: VIEWPORT });
    await page.route('**/api/dispatch', (route) =>
      route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ slug: 'fix-leaky-hose', log: 'x' }),
      }));
    try {
      const card = cardFor(page, 'Fix the leaky soaker hose');
      const button = card.getByRole('button', { name: 'Start work' });
      await button.waitFor({ timeout: 10_000 });
      await button.click();
      const note = card.locator('[data-dispatched]');
      await note.waitFor({ timeout: 10_000 });
      const className = (await note.getAttribute('class')) ?? '';
      expect(className).not.toMatch(/amber|red|rose/);
    } finally {
      await page.close();
    }
  });
});

/**
 * The `Status` entry, driven against a fully synthetic board + fleet.
 *
 * The presence bit `card.hasDispatchLog` is a server stat in the real board;
 * here both `/api/board` and `/api/fleet` are stubbed at the network boundary so
 * the card carries the bit directly and a matching row exists to hang the menu
 * on. `/api/dispatch-log` is stubbed too — the panel's content is the modal's
 * concern, and the DispatchLogModal unit-level rendering is exercised through
 * its own exported words; this asserts the wiring: the item appears, opens a
 * panel, and the panel fetches the dispatcher log.
 */
const STATUS_PLAN_FILE = '2026-08-19-with-a-dispatch-log.md';
const STATUS_SLUG = 'with-a-dispatch-log';

function boardWith(cardOver: Record<string, unknown>): Record<string, unknown> {
  const card = {
    slug: STATUS_SLUG,
    title: 'A plan someone has dispatched',
    type: 'feature',
    phase: 'Development',
    path: STATUS_PLAN_FILE,
    prs: [],
    phaseDate: '2026-08-19',
    ...cardOver,
  };
  return {
    columns: [
      { phase: 'Backlog', cards: [] },
      { phase: 'Design', cards: [] },
      { phase: 'Development', cards: [card] },
      { phase: 'Testing', cards: [] },
      { phase: 'Released', cards: [] },
    ],
    sprints: [],
    stories: [],
    dispatch: { available: true, reason: '' },
    approve: { available: true, reason: '' },
    continue: { available: true, reason: '' },
    idea: { available: true, reason: '' },
    server: { pid: 1, startedAt: new Date().toISOString(), url: baseURLHolder.url },
  };
}

// The stub board needs the server URL, known only after startServer. A tiny
// holder lets the pure `boardWith` above read it without threading it through.
const baseURLHolder: { url: string } = { url: '' };

const statusRow = (over: Partial<AgentRow> = {}): AgentRow => ({
  repo: 'garden', branch: 'feature/dispatched', plan: STATUS_SLUG,
  planFile: STATUS_PLAN_FILE, wave: 'w', state: 'wip', phase: 'Development',
  group: 'working', ageMinutes: 3, note: 'last commit 3 min ago',
  pr: null, branchUrl: 'https://x/feature/dispatched', waitingDays: null,
  localDirty: false, localLocked: false, ...over,
});

function statusFleet(): Fleet {
  const rows = [statusRow()];
  return {
    repo: 'garden', main: 'main', generatedAt: new Date().toISOString(),
    ageSeconds: 1, ready: true, error: null,
    rows,
    // WORKING renders from the registry since
    // `the-working-section-shows-every-worker`, so the dispatched WORKING row
    // appears only where an agent names its branch.
    agents: rows
      .filter((r) => r.group === 'working')
      .map((r) => ({
        session: `s-${r.branch}`, branch: r.branch, worktree: `/wt/plot-wt-${r.branch}`,
        command: '', startedAt: '', pid: '', previousPid: '', relaunches: 0,
        state: 'running' as const,
      })),
    summary: { plans: 1, waves: 1, branches: 1, claimed: 1, eligible: 0, blocked: 0, deferred: 0 },
    prAgeSeconds: 74, prNextInSeconds: 46, scanNextInSeconds: 3, prError: null,
  } as unknown as Fleet;
}

describe('the Status entry — the dispatcher log gets a durable home', () => {
  let cat: Catalogue;

  beforeAll(async () => {
    cat = await openCatalogue();
    // The fixture reports the board's own URL back to itself; the mock has one
    // for the same reason the real server does.
    baseURLHolder.url = cat.mock.baseURL;
  }, 60_000);
  afterAll(async () => {
    await cat?.close();
  });

  async function openAgents(opts: {
    hasDispatchLog?: boolean;
    dispatchLogBody?: unknown;
  }): Promise<Page> {
    // SERVED, NOT INTERCEPTED — the board answers with this state, which is
    // what the row is asserted against. `/api/dispatch-log` stays a route: it
    // is a read of a FILE the dispatcher wrote, not part of the board's state.
    const page = await cat.open('an-empty-estate', {
      over: {
        board: boardWith(opts.hasDispatchLog ? { hasDispatchLog: true } : {}) as Board,
        fleet: statusFleet(),
      },
      tab: 'agents',
      viewport: VIEWPORT,
    });
    if (opts.dispatchLogBody !== undefined) {
      await page.route('**/api/dispatch-log**', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(opts.dispatchLogBody),
        }));
    }
    await page.getByText(/Working/).first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  const rowFor = (page: Page, branch: string) =>
    page.locator('li[data-agent-row]').filter({ has: page.locator(`[data-branch="${branch}"]`) });

  it('is present whenever a dispatcher log exists, and opens the log', async () => {
    const page = await openAgents({
      hasDispatchLog: true,
      dispatchLogBody: {
        ok: true, slug: STATUS_SLUG, path: `/tmp/plot-dispatch-${STATUS_SLUG}.log`,
        text: 'dispatched=1 started=1\nworker pid 5501\n', bytes: 40,
        truncated: false, modifiedAt: new Date().toISOString(),
      },
    });
    try {
      const dots = rowFor(page, 'feature/dispatched').locator('[data-row-actions]');
      await dots.waitFor({ timeout: 10_000 });
      await dots.click();
      const status = page.locator('[data-dispatch-log-open]');
      await status.waitFor({ timeout: 10_000 });
      await status.click();
      // The panel opened and rendered the dispatcher's own words.
      const panel = page.locator('[data-dispatch-log]');
      await panel.waitFor({ timeout: 10_000 });
      await expect.poll(() => panel.textContent()).toContain('dispatched=1 started=1');
      // And it named the path — the durable route the button's message could not.
      expect(await panel.textContent()).toContain(`plot-dispatch-${STATUS_SLUG}.log`);
    } finally {
      await page.close();
    }
  });

  it('is absent when no dispatcher log exists', async () => {
    // The item is not a permanent fixture of the menu: a plan nobody has
    // dispatched has no log, so the entry is simply not there. Here the row is
    // WORKING and carries a worker log, so the menu still opens — but the Status
    // entry inside it is absent.
    const page = await openAgents({ hasDispatchLog: false });
    try {
      const dots = rowFor(page, 'feature/dispatched').locator('[data-row-actions]');
      await dots.waitFor({ timeout: 10_000 });
      await dots.click();
      // The menu opened (the worker log item is there), but no Status entry.
      await page.locator('[role="menu"]').waitFor({ timeout: 10_000 });
      expect(await page.locator('[data-dispatch-log-open]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });
});
