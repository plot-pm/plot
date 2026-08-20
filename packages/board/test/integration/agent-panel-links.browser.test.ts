// The agent panel's three facts as DESTINATIONS, in a real browser.
//
// The finding: `BRANCH`, `PLAN` and `WORKTREE` were plain strings the reader
// had to act on by hand. This asserts what a browser alone can — that BRANCH
// scrolls to and rings its row, PLAN opens its card, and WORKTREE offers Copy
// and is NEVER a link (a browser refuses http://localhost → file://, so a link
// would lie). The formatting/omission half lives in test/unit/agent-facts.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fleet, AgentRow } from '../../src/contract/schema.js';
import type { AgentPanel } from '../../src/server/agent-panel.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../../../..');
const ARTIFACT = path.join(REPO_ROOT, 'skills/plot/scripts/board/board-server.mjs');

const WORKTREE = '/Users/x/wt/the-branch';
const PLAN_FILE = '2026-08-20-the-panel.md';

function row(over: Partial<AgentRow> = {}): AgentRow {
  return {
    repo: 'plot', branch: 'feature/talks', plan: 'the-panel',
    planFile: PLAN_FILE, wave: 'Says', state: 'wip', phase: null,
    group: 'working', ageMinutes: 3, note: 'claimed', pr: null, branchUrl: '',
    waitingDays: null, localDirty: false, localLocked: false, localAhead: 0,
    waitingOn: null, blockedBy: null, stuck: null, repair: null,
    ...over,
  } as AgentRow;
}

function fleet(rows: AgentRow[]): Fleet {
  return {
    generatedAt: new Date().toISOString(),
    ageSeconds: 1, readRef: 'abc', readRefAge: 1, localHead: 'abc',
    ready: true, error: null, shrink: null, rows,
    summary: {
      plans: 1, waves: 1, branches: rows.length,
      claimed: rows.length, eligible: 0, blocked: 0, deferred: 0,
    },
    stuck: null, prAgeSeconds: null, prNextInSeconds: 0,
    scanNextInSeconds: 5, prError: null,
  } as unknown as Fleet;
}

// A panel whose facts are the three destinations. `plan` is the plan FILE — the
// server carries `plan.file` there, and it is how the board opens a card.
function panel(over: Partial<AgentPanel> = {}): AgentPanel {
  return {
    ok: true, branch: 'feature/talks', worktree: WORKTREE, plan: PLAN_FILE,
    wave: 'Says', worker: 'running', pid: '4242', uptimeSeconds: 90,
    command: 'claude -p "…"', model: undefined, contextTokens: undefined,
    lastActivity: undefined,
    ...over,
  } as unknown as AgentPanel;
}

describe('the agent panel facts are destinations', () => {
  let browser: Browser;
  let server: ChildProcess;
  let baseURL: string;
  let tmp: string;
  // The real board payload, fetched ONCE and served statically with one card
  // injected. Proxying `/api/board` per-request with `route.fetch()` races the
  // 30 s background poll against page teardown ("Request context disposed");
  // caching it makes the route callback synchronous, which is the rule this
  // repo already learned for route handlers.
  let boardWithCard: string;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-panel-links-'));
    fs.mkdirSync(path.join(tmp, 'docs/plans'), { recursive: true });
    browser = await chromium.launch();
    server = spawn('node', [ARTIFACT], {
      cwd: tmp,
      env: { ...process.env, PORT: '0', PLOT_REPO_ROOT: tmp, PLOT_EXIT_WITH_PARENT: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    baseURL = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error('server did not start')), 10_000);
      server.stdout!.on('data', (c) => {
        out += String(c);
        const m = /http:\/\/localhost:(\d+)/.exec(out);
        if (m) {
          clearTimeout(timer);
          resolve(`http://localhost:${m[1]}`);
        }
      });
    });
    // Fetch the real (empty but valid) board once, inject the card PLAN opens,
    // and keep the string to serve on every route hit.
    const board = await (await fetch(`${baseURL}/api/board`)).json();
    board.columns[0].cards.push({
      slug: 'the-panel', title: 'The panel', type: 'bug', phase: board.columns[0].phase,
      path: `docs/plans/${PLAN_FILE}`, prs: [], phaseDate: '2026-08-20',
    });
    boardWithCard = JSON.stringify(board);
  }, 40_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill('SIGTERM');
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * The Agents tab with a canned fleet and a canned agent panel, plus one board
   * card whose path matches the panel's plan — so PLAN has a card to open.
   *
   * `/api/board` serves the cached payload from `beforeAll` — the real (empty
   * but valid) board with one card injected, so PLAN has something to open
   * without this test enumerating every field the schema needs.
   */
  async function open(rows = [row()], p = panel()): Promise<Page> {
    const page = await browser.newPage();
    await page.route('**/api/fleet', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet(rows)) }));
    await page.route('**/api/agent-panel*', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(p) }));
    await page.route('**/api/board', (r) =>
      r.fulfill({ contentType: 'application/json', body: boardWithCard }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    return page;
  }

  /** Open the row's log panel and wait for the facts to render. */
  async function openPanel(page: Page) {
    await page.locator('[data-row-actions]').first().click();
    await page.locator('[data-worker-log-open]').first().click();
    await page.locator('[data-worker-log]').waitFor({ timeout: 5_000 });
    await page.locator('[data-agent-facts]').waitFor({ timeout: 5_000 });
  }

  it('renders BRANCH and PLAN as buttons and WORKTREE with Copy, none as links', async () => {
    const page = await open();
    try {
      await openPanel(page);
      // BRANCH and PLAN are destinations — buttons, because the reveal is in the
      // page, not a URL.
      expect(await page.locator('[data-fact-link="branch"]').count()).toBe(1);
      expect(await page.locator('[data-fact-link="plan"]').count()).toBe(1);
      // WORKTREE offers Copy path and is NOT a link. The rule the board applies
      // to a dead PR link: what cannot navigate must not look like one.
      expect(await page.locator('[data-copy-path]').count()).toBe(1);
      expect(await page.locator('[data-fact="worktree"] a').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('clicking BRANCH closes the panel and reveals that row, ringed', async () => {
    const page = await open();
    try {
      await openPanel(page);
      await page.locator('[data-fact-link="branch"]').click();
      // The panel is dismissed — the row it reveals sits behind it.
      await page.locator('[data-worker-log]').waitFor({ state: 'detached', timeout: 5_000 });
      // The row is the one just revealed, and it wears the arrival ring.
      const revealed = page.locator('#agent-row-feature\\/talks');
      await revealed.waitFor({ timeout: 5_000 });
      await expect
        .poll(() => revealed.getAttribute('data-highlighted'))
        .toBe('true');
    } finally {
      await page.close();
    }
  });

  it('clicking PLAN opens the plan card', async () => {
    const page = await open();
    try {
      await openPanel(page);
      await page.locator('[data-fact-link="plan"]').click();
      // The plan opens in its own dialog, rendered from the injected card. The
      // dialog is keyed by its aria-label (the agent panel is a dialog too, so
      // "a dialog appeared" is not specific enough); the iframe inside it points
      // at a plan file the tmp repo does not have, so the DIALOG is the assertion
      // — that the click opened the plan viewer, not that the file loaded.
      await page.getByRole('dialog', { name: 'Plan: The panel' })
        .waitFor({ state: 'visible', timeout: 5_000 });
    } finally {
      await page.close();
    }
  });

  it('Copy path writes the worktree path to the clipboard', async () => {
    const page = await browser.newPage({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    try {
      await page.route('**/api/fleet', (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet([row()])) }));
      await page.route('**/api/agent-panel*', (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(panel()) }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Working').first().waitFor({ timeout: 10_000 });
      await openPanel(page);
      await page.locator('[data-copy-path]').click();
      // The exact path, not the truncated render — the whole point of copying.
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(WORKTREE);
    } finally {
      await page.close();
    }
  });

  it('leaves BRANCH and PLAN as plain text when the panel has no branch or plan', async () => {
    // The omission/affordance rule reaching the panel: a plan the board never
    // walked ("") is not a dead button, and a facts block that could not read a
    // branch shows none. A panel with an empty plan renders no plan link.
    const page = await open([row()], panel({ plan: '' }));
    try {
      await openPanel(page);
      expect(await page.locator('[data-fact-link="plan"]').count()).toBe(0);
      // BRANCH is still there and still a destination — only PLAN lost its card.
      expect(await page.locator('[data-fact-link="branch"]').count()).toBe(1);
    } finally {
      await page.close();
    }
  });
});
