// The COMMAND field, in a real browser: SIZED collapsed, SIZED expanded, and
// copyable to the exact string the worker was launched with in both.
//
// What the field collapses to is a pure decision and is asserted without a page
// in `test/unit/command-fact.test.ts`. What only a browser can show is the
// SIZE, and the size is the whole defect: the field had none in either
// direction. Collapsed it was one line clipped inside `.plot/briefs/`, so the
// reader could not see which brief was named. Expanded it was fifteen unbounded
// lines that squeezed the log pane below it to a strip — the panel's other half
// pushed out by the half that expanded.
//
// So these assertions are MEASUREMENTS, not string comparisons. A clamp that
// silently failed to clamp, or a `max-h` a later refactor dropped, would leave
// every text assertion passing while the panel looked exactly as broken as it
// did before. Heights are read off the rendered boxes with
// `getBoundingClientRect`, and the log pane is measured in both states because
// "the command is bounded" and "the log keeps its pane" are the same fact seen
// from two sides.
//
// `/api/agent-panel` is stubbed rather than served: the panel's job is to render
// the command it is handed, and pinning the payload is what lets each size be
// asserted against a known input. That the SERVER assembles this panel from a
// worktree is `test/agent-panel.test.mjs`'s assertion, not this one.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fleet, AgentRow } from '../../src/contract/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../../../..');
const ARTIFACT = path.join(REPO_ROOT, 'skills/plot/scripts/board/board-server.mjs');

// A realistic worker command: the dispatcher launches `claude -p` with a prose
// brief that spans lines and names the brief path. This is the value that, once
// truncated to one line, stopped inside `.plot/briefs/` — and that, once
// expanded without a bound, ran to fifteen lines.
//
// LONG ON PURPOSE, and long in the way the real one is: ~1,400 characters of
// prose with spaces throughout. A short fixture would fit inside three lines
// and inside any `max-h`, so every size assertion below would pass against a
// field with no size at all — the exact defect, undetected. The brief path sits
// in the SECOND line of prose so the three-line assertion has something to
// prove: one clipped line does not reach it.
const COMMAND = [
  'PLOT_UNATTENDED=1 claude -p "You are implementing the branch $PLOT_BRANCH in',
  'this worktree, alone. Read .plot/briefs/the-command-can-be-read-in-full.md',
  'first — it is the specification, and its decisions were settled during plan',
  'interrogation: do not re-derive them, do not widen the scope. If you find',
  'something it did not anticipate, implement what you can and report the',
  'discovery rather than improvising. If you must stop and ask a person',
  'something, write PLOT-BLOCKED: followed by the question into a file in this',
  'worktree before you exit — the fleet scan reads that marker from the tree,',
  'not from your log, and without it a stopped worker is indistinguishable from',
  'a finished one and gets restarted into the same question. Delete the marker',
  'once it is answered. Follow CLAUDE.md: pnpm install if node_modules is',
  'missing, never skip tests, run pnpm build:board in THIS worktree and commit',
  'the artifact, add a changeset with its bumps block, never edit versions by',
  'hand, use trash not rm. Open a PR to main when done, then append the PR',
  'number to this branch line in the plan Branches section on main.',
  '" --permission-mode bypassPermissions',
].join('\n');

const BRANCH = 'feature/talks';

function row(over: Partial<AgentRow> = {}): AgentRow {
  return {
    repo: 'plot', branch: BRANCH, plan: 'a-plan',
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

// A successful panel carrying the long command. The transcript fields are left
// off — each omits independently (see AgentPanelFacts), and this test is about
// the command alone.
const panel = {
  ok: true, branch: BRANCH, worktree: '/tmp/wt', plan: 'a-plan', wave: 'Log',
  worker: 'wip', pid: '4242', uptimeSeconds: 180, command: COMMAND,
};

/**
 * A rendered element → how many LINES of text it is showing, and its box.
 *
 * Lines are derived from the painted height over the computed `line-height`
 * rather than counted in the string, because that is the thing under test: a
 * `line-clamp` is a paint-time bound, and the full text stays in the DOM
 * underneath it by design (that is what keeps Copy honest). `innerText` would
 * report every line the string wraps to and never see the clamp at all.
 *
 * `scrollHeight` against `clientHeight` is how "bounded" is told from "grew":
 * a box that scrolls has more content than height, and one that simply expanded
 * to fit has exactly as much.
 */
async function boxOf(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight);
    const height = el.getBoundingClientRect().height;
    return {
      height,
      lineHeight,
      lines: Math.round(height / lineHeight),
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      overflowY: style.overflowY,
      wordBreak: style.wordBreak,
      overflowWrap: style.overflowWrap,
    };
  });
}

describe('the command can be read in full: one line, then the whole thing, copied exactly', () => {
  let browser: Browser;
  let server: ChildProcess;
  let baseURL: string;
  let tmp: string;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-cmd-ui-'));
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

  // The Agents tab with a canned fleet, a canned panel, and an empty log — the
  // log's content is another wave's concern. Clipboard permission is granted so
  // the Copy assertion can read back what was written.
  async function openPanel(): Promise<Page> {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await page.route('**/api/fleet', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet([row()])) }));
    await page.route('**/api/agent-panel*', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify(panel) }));
    await page.route('**/api/worker-log*', (r) =>
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({
        ok: true, branch: BRANCH, path: '/tmp/wt/.plot-worker.log',
        text: '', bytes: 0, truncated: false, modifiedAt: new Date().toISOString(),
      }) }));
    await page.goto(`${baseURL}?tab=agents`);
    await page.getByText('Working').first().waitFor({ timeout: 10_000 });
    await page.locator('[data-row-actions]').first().click();
    await page.locator('[data-worker-log-open]').first().click();
    await page.locator('[data-command-fact]').waitFor({ timeout: 5_000 });
    return page;
  }

  it('shows THREE lines collapsed — not one, and not all of them', async () => {
    const page = await openPanel();
    try {
      const box = await boxOf(page, '[data-command-value]');
      // Three. The measured defect was one; the unbounded failure was fifteen.
      expect(box.lines).toBe(3);
      // And three because the clamp says so, not because the text happened to
      // be short: there is more of it underneath than the box paints.
      expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
    } finally {
      await page.context().close();
    }
  });

  it('reaches the brief path collapsed — the fact one clipped line buried', async () => {
    const page = await openPanel();
    try {
      // The reason the number is three. `Read .plot/briefs/…` sits in the
      // second line of prose, so one line cannot reach it and three can. The
      // string is asserted rather than the paint because the path is the
      // CONTENT of the promise; that three lines are painted is the assertion
      // above.
      const text = await page.locator('[data-command-value]').innerText();
      expect(text).toContain('.plot/briefs/the-command-can-be-read-in-full.md');
      // Still the collapsed preview, not the raw string: the brief's own
      // newlines are gone so the browser decides where the three lines break.
      expect(text).not.toEqual(COMMAND);
    } finally {
      await page.context().close();
    }
  });

  it('expands to the whole command, including the brief path and the trailing flags', async () => {
    const page = await openPanel();
    try {
      await page.locator('[data-command-toggle]').click();
      const text = await page.locator('[data-command-value]').innerText();
      // The whole brief, end to end — the path AND the flags after it, which is
      // what "nothing is hidden" means for a value read top to bottom.
      expect(text).toContain('.plot/briefs/the-command-can-be-read-in-full.md');
      expect(text).toContain('--permission-mode bypassPermissions');
      // And it is the multi-line original, not the preview.
      expect(text).toContain('\n');
    } finally {
      await page.context().close();
    }
  });

  it('is BOUNDED and scrolls when expanded, rather than growing to fifteen lines', async () => {
    const page = await openPanel();
    try {
      const collapsed = await boxOf(page, '[data-command-value]');
      await page.locator('[data-command-toggle]').click();
      const expandedBox = await boxOf(page, '[data-command-value]');

      // Expanding shows MORE — otherwise the control does nothing.
      expect(expandedBox.height).toBeGreaterThan(collapsed.height);
      // But it stops. The unbounded render was fifteen lines and had no
      // scroller; a bounded one has more content than box and scrolls to it.
      expect(expandedBox.scrollHeight).toBeGreaterThan(expandedBox.clientHeight);
      expect(expandedBox.overflowY).toBe('auto');
      // And the bound is a real ceiling, not "whatever the text came to".
      expect(expandedBox.lines).toBeLessThanOrEqual(12);
    } finally {
      await page.context().close();
    }
  });

  it('leaves the log its pane in BOTH states — the half that expanded stops pushing the other out', async () => {
    const page = await openPanel();
    try {
      // The modal is a fixed-height column: the facts block is `shrink-0` and
      // the log is `flex-1`, so every line the command grows is a line taken
      // from the log. Fifteen of them squeezed it to a strip. This is that
      // defect stated as a measurement, and it is the reason the expanded
      // state is bounded at all.
      const before = await boxOf(page, '[data-log-body]');
      await page.locator('[data-command-toggle]').click();
      const after = await boxOf(page, '[data-log-body]');

      // The log keeps most of its height. Some give is honest — the command
      // did grow — but it must remain a PANE, not a strip.
      expect(after.height).toBeGreaterThan(before.height * 0.6);
      expect(after.height).toBeGreaterThan(120);
    } finally {
      await page.context().close();
    }
  });

  it('breaks at spaces, not mid-word — `break-all` is gone', async () => {
    const page = await openPanel();
    try {
      // `break-all` split this command mid-syllable: `im`/`mediately`,
      // `5`/`03`. It exists for strings with no spaces; this one has spaces
      // throughout. Asserted as the computed style because the defect IS the
      // property — a screenshot diff would catch it, but not say why.
      const collapsed = await boxOf(page, '[data-command-value]');
      expect(collapsed.wordBreak).not.toBe('break-all');
      await page.locator('[data-command-toggle]').click();
      const expandedBox = await boxOf(page, '[data-command-value]');
      expect(expandedBox.wordBreak).not.toBe('break-all');
      // And the long unbreakable token still gets to wrap whole rather than
      // overflow its box.
      expect(expandedBox.overflowWrap).toBe('break-word');
    } finally {
      await page.context().close();
    }
  });

  it('Copy puts the EXACT launched command on the clipboard in BOTH states', async () => {
    const page = await openPanel();
    try {
      // The contract of the wave that shipped this field, and a bounded render
      // is exactly the case where it must hold: the reader who copies gets the
      // command the worker was launched with, byte for byte — including the
      // newlines the collapsed preview removed and the lines the clamp hides.
      await page.locator('[data-command-copy]').click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(COMMAND);

      // Expanded, the same bytes. Copy follows the VALUE, never the render.
      await page.locator('[data-command-toggle]').click();
      await page.evaluate(() => navigator.clipboard.writeText('cleared'));
      await page.locator('[data-command-copy]').click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(COMMAND);
    } finally {
      await page.context().close();
    }
  });

  it('renders nothing for a command the fleet never configured', async () => {
    // `command: ""` is the shape a fleet with no `Worker command` takes. The
    // omission rule holds: no preview, no Show more, no Copy — there is nothing
    // to read.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.route('**/api/fleet', (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify(fleet([row()])) }));
      await page.route('**/api/agent-panel*', (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...panel, command: '' }) }));
      await page.route('**/api/worker-log*', (r) =>
        r.fulfill({ contentType: 'application/json', body: JSON.stringify({
          ok: true, branch: BRANCH, path: '/tmp/wt/.plot-worker.log',
          text: '', bytes: 0, truncated: false, modifiedAt: new Date().toISOString(),
        }) }));
      await page.goto(`${baseURL}?tab=agents`);
      await page.getByText('Working').first().waitFor({ timeout: 10_000 });
      await page.locator('[data-row-actions]').first().click();
      await page.locator('[data-worker-log-open]').first().click();
      await page.locator('[data-worker-log]').waitFor({ timeout: 5_000 });
      expect(await page.locator('[data-command-fact]').count()).toBe(0);
    } finally {
      await context.close();
    }
  });
});
