// The worker-log panel, in a real browser against the shipped artifact.
//
// The data layer is covered elsewhere: `test/worker-log.test.mjs` drives the
// endpoint, `test/unit/worker-log.test.ts` the resolver and the tail. What only
// a browser can show is that the row OFFERS the log and the panel RENDERS the
// four outcomes as four different things — which is the half of "absence is not
// emptiness" that lives on screen. A server that tells three answers apart and
// a panel that paints them all blank has fixed nothing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fleet, AgentRow } from '../../src/contract/schema.js';
import { expandAgentFolds } from '../helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../../../..');
const ARTIFACT = path.join(REPO_ROOT, 'skills/plot/scripts/board/board-server.mjs');

function row(over: Partial<AgentRow> = {}): AgentRow {
  return {
    repo: 'plot', branch: 'feature/talks', plan: 'a-plan',
    planFile: '2026-08-16-a-plan.md', wave: 'Log', state: 'wip', phase: null,
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

describe('the worker log panel: offered by a WORKING row, four outcomes, four answers', () => {
  let browser: Browser;
  let server: ChildProcess;
  let baseURL: string;
  let tmp: string;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-log-ui-'));
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
  }, 40_000);

  afterAll(async () => {
    await browser?.close();
    server?.kill('SIGTERM');
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  /**
   * The Agents tab with a canned fleet and a canned log reply.
   *
   * `/api/worker-log` is stubbed rather than served for the reason the fleet is:
   * the panel's job is to render an answer, and pinning the answer is what lets
   * each outcome be asserted separately. That the SERVER produces these answers
   * from a real worktree is `test/worker-log.test.mjs`'s assertion, not this
   * one — two layers, each tested where it lives.
   */
  async function open(logBody: unknown, status = 200, rows = [row()]): Promise<Page> {
    const page = await browser.newPage();
    await page.route('**/api/fleet', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet(rows)) }));
    await page.route('**/api/worker-log*', (r) =>
      r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(logBody) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
    return page;
  }

  /**
   * Open the row's menu, click through to the log, and WAIT FOR THE ANSWER.
   *
   * The wait past the dialog is not incidental: the panel mounts showing
   * `Loading…` and fills in when the fetch resolves, so an assertion made on
   * mount reads the placeholder. Waiting for the body to stop saying `Loading…`
   * is what makes every assertion below about the rendered answer rather than
   * about a race this helper would otherwise lose intermittently.
   */
  async function openPanel(page: Page) {
    await page.locator('[data-row-actions]').first().click();
    await page.locator('[data-worker-log-open]').first().click();
    await page.locator('[data-worker-log]').waitFor({ timeout: 5_000 });
    await expect
      .poll(() => page.locator('[data-log-body]').innerText(), { timeout: 5_000 })
      .not.toMatch(/^Loading…$/);
  }

  const ok = (over: Record<string, unknown> = {}) => ({
    ok: true, branch: 'feature/talks', path: '/tmp/wt/.plot-worker.log',
    text: 'building the thing\ndone\n', bytes: 24, truncated: false,
    modifiedAt: new Date().toISOString(), ...over,
  });

  it('offers the log from a WORKING row and renders what the worker wrote', async () => {
    const page = await open(ok());
    try {
      await openPanel(page);
      expect(await page.locator('[data-log-body]').innerText()).toContain('building the thing');
      // The path is shown so a reader can open the whole file themselves.
      await expect
        .poll(() => page.getByText('/tmp/wt/.plot-worker.log').count())
        .toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  // A row that is not an agent has no console to read — WORKING lists agents,
  // every other section lists results or processes.
  it('offers nothing on a row outside WORKING', async () => {
    const page = await open(ok(), 200, [row({ group: 'waiting-on-you', branch: 'feature/done' })]);
    try {
      const menus = await page.locator('[data-row-actions]').count();
      if (menus > 0) await page.locator('[data-row-actions]').first().click();
      expect(await page.locator('[data-worker-log-open]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── FOUR OUTCOMES, FOUR ANSWERS ───────────────────────────────────────────
  //
  // The whole point of the wave on screen. Each of these would be one blank
  // panel under an implementation that only asked "did I get any text".

  it('says an EMPTY log is empty — a worker that has started and said nothing', async () => {
    const page = await open(ok({ text: '', bytes: 0 }));
    try {
      await openPanel(page);
      // `ok: true` with no text is a successful READ, so it must not render as
      // one of the misses.
      expect(await page.locator('[data-log-empty]').count()).toBe(1);
      expect(await page.locator('[data-log-miss]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('says NO LOG where the worktree is here and nothing wrote', async () => {
    const page = await open(
      { ok: false, branch: 'feature/talks', reason: 'no-log', path: '/tmp/wt/.plot-worker.log' },
    );
    try {
      await openPanel(page);
      expect(await page.locator('[data-log-miss]').getAttribute('data-log-miss')).toBe('no-log');
      // It says where to look — the answer that makes this actionable at all.
      expect(await page.locator('[data-log-body]').innerText()).toMatch(/worktree/i);
    } finally {
      await page.close();
    }
  });

  it('says NO WORKTREE where this machine holds none, and 404 is not an error', async () => {
    const page = await open(
      { ok: false, branch: 'feature/talks', reason: 'no-worktree', path: null }, 404,
    );
    try {
      await openPanel(page);
      // The 404 carries a real answer; rendering it as an HTTP failure would
      // replace the one useful sentence with a status code.
      expect(await page.locator('[data-log-miss]').getAttribute('data-log-miss'))
        .toBe('no-worktree');
      expect(await page.locator('[data-log-body]').innerText()).toMatch(/machine/i);
    } finally {
      await page.close();
    }
  });

  it('gives the three misses and the empty log four DIFFERENT sentences', async () => {
    // The pairing that matters, asserted as a pairing: a panel rendering all
    // four alike would pass every single-case test above.
    const said: string[] = [];
    for (const [body, status] of [
      [ok({ text: '', bytes: 0 }), 200],
      [{ ok: false, branch: 'b', reason: 'no-log', path: '/tmp/x' }, 200],
      [{ ok: false, branch: 'b', reason: 'no-worktree', path: null }, 404],
      [{ ok: false, branch: 'b', reason: 'unreadable', path: '/tmp/x' }, 200],
    ] as [unknown, number][]) {
      const page = await open(body, status);
      try {
        await openPanel(page);
        said.push((await page.locator('[data-log-body]').innerText()).trim());
      } finally {
        await page.close();
      }
    }
    expect(new Set(said).size).toBe(4);
  });

  // ── THE BOUND SAYS SO ─────────────────────────────────────────────────────

  it('states the truncation and names the full size', async () => {
    const page = await open(ok({ text: 'the tail\n', bytes: 5 * 1024 * 1024, truncated: true }));
    try {
      await openPanel(page);
      const notice = page.locator('[data-log-truncated]');
      expect(await notice.count()).toBe(1);
      // The full size, so the reader knows what they are NOT seeing. A tail
      // presented as a whole log is the defect this asserts against.
      expect(await notice.innerText()).toContain('5.0 MB');
    } finally {
      await page.close();
    }
  });

  it('shows no truncation notice for a whole log', async () => {
    const page = await open(ok());
    try {
      await openPanel(page);
      expect(await page.locator('[data-log-truncated]').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  // ── THE FOOTER PATH: COPYABLE, NEVER A LINK ───────────────────────────────
  //
  // The path names something OUTSIDE the browser, and a browser refuses to
  // navigate from http://localhost to file://. So the footer must not look like
  // a link it cannot follow, and the recourse it offers is Copy — the exact
  // string, for pasting into a terminal where a pager reads the whole file.

  it('renders the footer path as text, never as a link', async () => {
    const page = await open(ok());
    try {
      await openPanel(page);
      // The path is present…
      await expect
        .poll(() => page.getByText('/tmp/wt/.plot-worker.log').count())
        .toBeGreaterThan(0);
      // …and no anchor carries it. An affordance that cannot navigate must not
      // look like one — the rule this board already applies to a dead PR link.
      expect(await page.locator('footer a').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('copies the exact path when Copy is clicked', async () => {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    try {
      await page.route('**/api/fleet', (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet([row()])) }));
      await page.route('**/api/worker-log*', (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(ok()) }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
      await openPanel(page);

      await page.getByRole('button', { name: /copy path/i }).click();
      // The exact string the footer showed, byte for byte — not a re-derivation.
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe('/tmp/wt/.plot-worker.log');
    } finally {
      await page.close();
      await context.close();
    }
  });

  // ── LIVE, WITHOUT REOPENING ───────────────────────────────────────────────
  //
  // The panel already polls (LOG_POLL_MS). The claim of THIS branch is that a
  // line the worker appends shows up in the open panel within one interval —
  // the reader does not close and reopen to see the agent's newest output.

  it('shows an appended line within one poll, without reopening', async () => {
    const page = await browser.newPage();
    let text = 'first line\n';
    try {
      await page.route('**/api/fleet', (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet([row()])) }));
      // The log GROWS between polls, as a live worker's does.
      await page.route('**/api/worker-log*', (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(ok({ text })) }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
      await openPanel(page);
      expect(await page.locator('[data-log-body]').innerText()).toContain('first line');

      // The worker writes more; the panel is left open and untouched.
      text = 'first line\nsecond line\n';
      await expect
        .poll(() => page.locator('[data-log-body]').innerText(), { timeout: 7_000 })
        .toContain('second line');
    } finally {
      await page.close();
    }
  });

  // ── ON DEMAND, AND ONLY WHILE OPEN ────────────────────────────────────────

  it('fetches no log until asked, and stops when the panel closes', async () => {
    const page = await browser.newPage();
    let calls = 0;
    try {
      await page.route('**/api/fleet', (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet([row()])) }));
      await page.route('**/api/worker-log*', (r) => {
        calls++;
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify(ok()) });
      });
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    await expandAgentFolds(page);
      // THE POINT OF SERVING ON DEMAND: the board has been open and polling,
      // and not one log has been fetched.
      await page.waitForTimeout(500);
      expect(calls, 'a log was fetched before anyone asked').toBe(0);

      await openPanel(page);
      await expect.poll(() => calls).toBeGreaterThan(0);

      // Closing ends the traffic — the panel unmounts and its timer with it.
      await page.getByRole('button', { name: 'Close' }).click();
      await page.locator('[data-worker-log]').waitFor({ state: 'detached', timeout: 5_000 });
      const afterClose = calls;
      await page.waitForTimeout(1_200);
      expect(calls, 'the log kept polling after the panel closed').toBe(afterClose);
    } finally {
      await page.close();
    }
  });

  // ── THE OVERLAY KEEPS ITS PLACE ───────────────────────────────────────────
  //
  // An open panel is modal, and modality means the page behind it does not move.
  // The App scrolls the window (a `min-h-screen` document, no inner scroller), so
  // the panel must lock the body while open and hand the reader back to exactly
  // where they were on close. A wheel over the backdrop that scrolls the fleet
  // list, or a close that lands the reader somewhere else, is the overlay
  // asserting a modality it does not enforce.

  // Give the document something to scroll, and put the reader a little way down
  // it — small ON PURPOSE. The panel opens from a row menu at the top of the
  // list, and Playwright scrolls a control it clicks into view; a large offset
  // would put the ⋯ button off-screen and the click would reset scroll to 0
  // before the panel ever mounts, measuring the harness rather than the lock. A
  // 60px offset keeps the trigger visible, so the position the reader is at when
  // the panel opens is a real non-zero one the close has to restore.
  async function makeScrollable(page: Page, to = 60): Promise<void> {
    await page.evaluate((y) => {
      const spacer = document.createElement('div');
      spacer.id = '__scroll_spacer';
      spacer.style.height = '3000px';
      document.body.appendChild(spacer);
      window.scrollTo(0, y);
    }, to);
  }

  it('does not scroll the list behind it when the backdrop takes a wheel', async () => {
    const page = await open(ok());
    try {
      await makeScrollable(page);
      await openPanel(page);
      // With the page locked, the frozen document sits at the viewport top; the
      // reader's real offset is held in the lock, and a wheel must not change the
      // page underneath. Observe the visual scroll before and after the wheel.
      const before = await page.evaluate(() => window.scrollY);
      // A wheel delivered over the backdrop, outside the dialog itself.
      await page.mouse.move(20, 20);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => window.scrollY);
      expect(after, 'a wheel over the backdrop scrolled the page behind it').toBe(before);
    } finally {
      await page.close();
    }
  });

  it('restores the scroll position it opened at when it closes', async () => {
    const page = await open(ok());
    try {
      // Opened at 60 (see makeScrollable): a real, non-zero reader position that
      // survives the menu click. The round-trip the spec names is that closing
      // lands the reader back there, not at the top.
      await makeScrollable(page, 60);
      await openPanel(page);
      await page.getByRole('button', { name: 'Close' }).click();
      await page.locator('[data-worker-log]').waitFor({ state: 'detached', timeout: 5_000 });
      const after = await page.evaluate(() => window.scrollY);
      expect(after, 'closing the panel left the reader somewhere else').toBe(60);
    } finally {
      await page.close();
    }
  });

  // Agent output is arbitrary bytes and frequently includes markup the agent was
  // asked to write. Rendering it as HTML would execute whatever a log contained.
  it('renders log content as TEXT, never as markup', async () => {
    const page = await open(ok({ text: '<img src=x onerror="window.__pwned=1">\n' }));
    try {
      await openPanel(page);
      expect(await page.locator('[data-log-body]').innerText()).toContain('<img');
      expect(await page.locator('[data-log-body] img').count()).toBe(0);
      expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
    } finally {
      await page.close();
    }
  });
});
