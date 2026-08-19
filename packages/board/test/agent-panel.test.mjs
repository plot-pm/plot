// GET /api/agent-panel — the route contract, against the BUILT artifact.
//
// The unit suites (test/unit/agent-panel.test.ts, test/unit/transcript.test.ts)
// cover the resolver, the uptime reading and the transcript's omission rules.
// This covers what only the running server can show: that the route is wired,
// that the branch travels as a query parameter, that a real transcript on disk
// reaches the payload and an unreadable one silently does not — and, the
// load-bearing one, that none of this leaked into the pulse.
//
// A stub `plot-fleet-scan.sh` supplies the pulse, so the worktrees the server
// believes in are the temp directories this file made. `HOME` is redirected the
// same way, so the transcript the server reads is one this test wrote rather
// than the developer's own.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, makeRepo, request, rmTree, SCRIPTS_DIR } from './helpers.mjs';

const PLAN = `# The agent panel
## Status
- **Phase:** Approved
- **Type:** feature
`;

/** A scripts dir whose `plot-fleet-scan.sh` prints the pulse we hand it. */
function stubScan(pulse) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-panelstub-'));
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (name === 'plot-fleet-scan.sh') continue;
    fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(dir, name));
  }
  const json = path.join(dir, 'pulse.json');
  fs.writeFileSync(json, JSON.stringify(pulse));
  fs.writeFileSync(
    path.join(dir, 'plot-fleet-scan.sh'),
    `#!/usr/bin/env bash\ncat ${JSON.stringify(json)}\n`,
    { mode: 0o755 },
  );
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** The pulse shape `plot-fleet-scan.sh --json` really emits. */
function pulse(branches) {
  return {
    main: 'main',
    read_ref: 'abc123',
    local_head: 'abc123',
    head: 'abc123',
    fetch_failed: false,
    fetch_error: '',
    plan_source: 'ref',
    plans: [
      {
        file: '2026-08-17-working-shows-the-agent.md',
        phase: 'approved',
        waves: [{ name: 'Panel', verdict: 'eligible', branches }],
      },
    ],
    summary: {
      plans: 1,
      waves: 1,
      branches: branches.length,
      claimed: branches.length,
      eligible: 0,
      blocked: 0,
      deferred: 0,
      merge_detect: 'pr-merge',
    },
  };
}

function branch(name, worktree, over = {}) {
  return {
    branch: name,
    state: 'wip',
    deferred: false,
    claimed: 'claimed: someone',
    local_dirty: false,
    local_locked: false,
    local_worktree: worktree,
    local_ahead: 0,
    worker: 'running',
    worker_pid: String(process.pid),
    worker_exit: '',
    worker_dirty_paths: [],
    conflicts_known: false,
    conflicts: [],
    changed_paths: [],
    ...over,
  };
}

/**
 * A fake `$HOME` holding one transcript for `worktree`.
 *
 * The slug is the worktree path with `/` and `.` replaced by `-`, which is the
 * derivation the server performs — restated here rather than imported, so a
 * change to it fails this test instead of being silently mirrored.
 */
function fakeHome(worktree, lines) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-home-'));
  const slug = worktree.replace(/[/.]/g, '-');
  const dir = path.join(home, '.claude', 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sess-1.jsonl'), lines);
  return home;
}

/** One assistant line, shaped as the runtime writes it (measured 2026-08-19). */
function assistantLine(over = {}) {
  return `${JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-19T08:23:10.298Z',
    sessionId: 'sess-1',
    version: '2.1.235',
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      usage: { cache_read_input_tokens: 103_619 },
    },
    ...over,
  })}\n`;
}

async function getPanel(port, branchName) {
  const res = await request(port, {
    method: 'GET',
    path: `/api/agent-panel?branch=${encodeURIComponent(branchName)}`,
  });
  return { status: res.status, body: JSON.parse(res.body) };
}

/** Wait for the first scan to land — a cold cache answers a different question. */
async function settle(port) {
  let last = '';
  for (let i = 0; i < 50; i++) {
    const res = await request(port, { method: 'GET', path: '/api/fleet' });
    const body = JSON.parse(res.body);
    if (body.ready) return;
    last = body.error ?? '';
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`fleet never became ready${last ? `: ${last}` : ''}`);
}

describe('GET /api/agent-panel: the run, assembled on demand', () => {
  let tmp, server, stub, wt, home;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-17-working-shows-the-agent.md', content: PLAN }] });
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wt-panel-'));
    home = fakeHome(wt, assistantLine());
    stub = stubScan(pulse([branch('feature/the-agent-panel', wt)]));
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir, HOME: home });
    await settle(server.port);
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (wt) rmTree(wt);
    if (home) rmTree(home);
    if (tmp) rmTree(tmp);
  });

  it('reports pid, worktree, plan and wave from the scan', async () => {
    const { status, body } = await getPanel(server.port, 'feature/the-agent-panel');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.pid, String(process.pid));
    assert.equal(body.worktree, wt);
    assert.equal(body.wave, 'Panel');
    assert.equal(body.worker, 'running');
    assert.ok(body.plan.includes('working-shows-the-agent'));
  });

  it('derives uptime from the pid, and the pid it was handed is alive', async () => {
    // The stub names THIS test process, which is certainly running — so a
    // number here proves the derivation reached the process table rather than
    // echoing a stored value (there is none to echo).
    const { body } = await getPanel(server.port, 'feature/the-agent-panel');
    assert.equal(typeof body.uptimeSeconds, 'number');
    assert.ok(body.uptimeSeconds >= 0);
  });

  it('reads model, context and last activity from the transcript', async () => {
    const { body } = await getPanel(server.port, 'feature/the-agent-panel');
    assert.equal(body.model, 'claude-opus-5');
    assert.equal(body.contextTokens, 103_619);
    assert.equal(body.lastActivity, '2026-08-19T08:23:10.298Z');
  });

  it('requires a branch', async () => {
    const res = await request(server.port, { method: 'GET', path: '/api/agent-panel' });
    assert.equal(res.status, 400);
  });

  // The security boundary: these name no branch the pulse reported, so they are
  // answered rather than read. Nothing here becomes a path segment.
  for (const evil of ['../../etc/passwd', '/etc/passwd', 'feature/../../x']) {
    it(`refuses ${evil} — the pulse never named it`, async () => {
      const { status, body } = await getPanel(server.port, evil);
      assert.equal(status, 404);
      assert.equal(body.ok, false);
      assert.equal(body.reason, 'unknown-branch');
    });
  }
});

// THE WAVE'S MAIN RISK, at the route. A transcript the server cannot read must
// cost the panel those three fields and nothing else — no error, no placeholder,
// and above all no stale value.
describe('an unreadable transcript omits its fields silently', () => {
  let tmp, server, stub, wt, home;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-17-working-shows-the-agent.md', content: PLAN }] });
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wt-notrans-'));
    // A transcript whose `model` sits where an older format put it — the exact
    // shape "the format changed under the board" takes.
    home = fakeHome(wt, `${JSON.stringify({ type: 'assistant', model: 'claude-opus-5' })}\n`);
    stub = stubScan(pulse([branch('feature/no-transcript', wt)]));
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir, HOME: home });
    await settle(server.port);
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (wt) rmTree(wt);
    if (home) rmTree(home);
    if (tmp) rmTree(tmp);
  });

  it('still answers 200 with everything Plot itself knows', async () => {
    const { status, body } = await getPanel(server.port, 'feature/no-transcript');
    assert.equal(status, 200, 'an unreadable transcript is not an error');
    assert.equal(body.ok, true);
    assert.equal(body.worktree, wt, 'the facts Plot owns are unaffected');
  });

  it('omits model, context and last activity rather than guessing', async () => {
    const { body } = await getPanel(server.port, 'feature/no-transcript');
    // ABSENT KEYS, not null or "" ones: a client rendering `body.model` gets
    // nothing to print, which is the whole accepted failure mode.
    assert.ok(!('model' in body), 'no model may be invented');
    assert.ok(!('contextTokens' in body), 'no context may be invented');
    assert.ok(!('lastActivity' in body), 'no activity may be invented');
  });

  it('carries no error field — showing less is not failing', async () => {
    const { body } = await getPanel(server.port, 'feature/no-transcript');
    assert.ok(!('error' in body));
  });
});

// A worker that has exited has NO uptime. A stored launch timestamp would still
// be here and would still be counting; this asserts the number is a reading.
describe('a worker that has exited shows no fabricated uptime', () => {
  let tmp, server, stub, wt, home;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-17-working-shows-the-agent.md', content: PLAN }] });
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wt-dead-'));
    home = fakeHome(wt, assistantLine());
    stub = stubScan(
      pulse([
        // A pid in the valid range that nothing is running, and a worker state
        // that says so.
        branch('feature/gone', wt, { worker: 'finished', worker_pid: '99998', worker_exit: '0' }),
        // The same, for a worker the scan never recorded a pid for.
        branch('feature/nopid', wt, { worker: 'none', worker_pid: '' }),
      ]),
    );
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir, HOME: home });
    await settle(server.port);
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (wt) rmTree(wt);
    if (home) rmTree(home);
    if (tmp) rmTree(tmp);
  });

  it('reports null uptime for a pid nobody is running', async () => {
    const { body } = await getPanel(server.port, 'feature/gone');
    assert.equal(body.ok, true);
    assert.equal(body.uptimeSeconds, null, 'a dead worker has no uptime — not 0, not a memory');
  });

  it('reports null uptime when no pid was recorded', async () => {
    const { body } = await getPanel(server.port, 'feature/nopid');
    assert.equal(body.uptimeSeconds, null);
  });
});

// THE POINT OF SERVING ON DEMAND. The plan's argument is that a 4 s pulse
// carrying every agent's state is a different product — and that argument is
// kept only by the pulse staying exactly as it was.
describe('the pulse carries no panel', () => {
  let tmp, server, stub, wt, home;
  const SECRET_MODEL = 'SENTINEL-MODEL-THAT-MUST-NOT-TRAVEL';

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-17-working-shows-the-agent.md', content: PLAN }] });
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wt-pulse-'));
    home = fakeHome(wt, assistantLine({ message: { model: SECRET_MODEL, usage: {} } }));
    fs.writeFileSync(path.join(wt, '.plot-worker.log'), 'SENTINEL-LOG\n');
    stub = stubScan(pulse([branch('feature/quiet', wt)]));
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir, HOME: home });
    await settle(server.port);
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (wt) rmTree(wt);
    if (home) rmTree(home);
    if (tmp) rmTree(tmp);
  });

  it('serves transcript facts from /api/agent-panel and from nowhere else', async () => {
    // First prove the sentinel is genuinely readable — otherwise the absences
    // below would pass against a broken endpoint.
    const { body } = await getPanel(server.port, 'feature/quiet');
    assert.equal(body.model, SECRET_MODEL, 'the endpoint should serve it');

    for (const route of ['/api/fleet', '/api/board']) {
      const res = await request(server.port, { method: 'GET', path: route });
      assert.equal(res.status, 200);
      // The CONTENT, not the key: a payload that started shipping the model
      // under any name at all fails here, which is the drift worth catching.
      assert.ok(!res.body.includes(SECRET_MODEL), `${route} must not carry transcript facts`);
      assert.ok(!res.body.includes('uptimeSeconds'), `${route} must not carry uptime`);
    }
  });
});
