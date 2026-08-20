// The COMMAND field, in a real browser: collapsed to one line, expandable to the
// whole brief, and copyable to the exact string the worker was launched with.
//
// The collapse itself is a pure decision and is asserted without a page in
// `test/unit/command-fact.test.ts`. What only a browser can show is the half
// that is interaction: that the default IS one line, that Show more reveals the
// rest including the brief path, and that Copy puts the ORIGINAL command on the
// clipboard rather than the collapsed render — the defect the wave removes,
// measured on screen.
//
// `/api/agent-panel` is stubbed rather than served: the panel's job is to render
// the command it is handed, and pinning the payload is what lets "one line",
// "the whole thing", and "the exact bytes" each be asserted separately. That the
// SERVER assembles this panel from a worktree is `test/agent-panel.test.mjs`'s
// assertion, not this one.
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
// truncated to one line, stopped inside `.plot/briefs/`.
const COMMAND = [
  'PLOT_UNATTENDED=1 claude -p "You are implementing the branch $PLOT_BRANCH in',
  'this worktree, alone. Read .plot/briefs/the-command-can-be-read-in-full.md',
  'first — it is the specification, and its decisions were settled during plan',
  'interrogation." --permission-mode bypassPermissions',
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

  it('shows one line collapsed, and it is the collapsed preview not the raw command', async () => {
    const page = await openPanel();
    try {
      const value = page.locator('[data-command-value]');
      const text = await value.innerText();
      // One line: the newlines that make COMMAND four lines are gone.
      expect(text).not.toMatch(/\n/);
      // And it is genuinely collapsed rather than the raw string with the
      // browser hiding the overflow — the raw string still contains newlines.
      expect(text).not.toEqual(COMMAND);
    } finally {
      await page.context().close();
    }
  });

  it('expands to the whole command, including the brief path the truncation buried', async () => {
    const page = await openPanel();
    try {
      await page.locator('[data-command-toggle]').click();
      const text = await page.locator('[data-command-value]').innerText();
      // The whole brief, with the path that the one-line render clipped inside of.
      expect(text).toContain('.plot/briefs/the-command-can-be-read-in-full.md');
      expect(text).toContain('--permission-mode bypassPermissions');
      // And it is the multi-line original, not the preview.
      expect(text).toContain('\n');
    } finally {
      await page.context().close();
    }
  });

  it('Copy puts the EXACT launched command on the clipboard, not the truncated render', async () => {
    const page = await openPanel();
    try {
      await page.locator('[data-command-copy]').click();
      // The contract of this wave: the reader who copies gets the command the
      // worker was launched with, byte for byte — including the newlines the
      // collapsed preview removed.
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toBe(COMMAND);
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
