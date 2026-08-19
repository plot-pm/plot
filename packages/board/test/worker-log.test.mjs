// GET /api/worker-log — the route contract, against the BUILT artifact.
//
// The unit suite (test/unit/worker-log.test.ts) covers the resolver and the
// tail. This covers what only the running server can show: that the route is
// wired, that the branch travels as a query parameter, that the three-way
// distinction survives serialisation, and — the load-bearing one — that none of
// this leaked into the pulse.
//
// A stub `plot-fleet-scan.sh` supplies the pulse, so the worktrees the server
// believes in are the temp directories this file made. That is the only way to
// assert the derivation: a real scan reports the worktrees this checkout
// actually has, and a test cannot put a known log in one of those without
// writing into the repo it is running from.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, makeRepo, request, rmTree, SCRIPTS_DIR } from './helpers.mjs';

const PLAN = `# Serve the log
## Status
- **Phase:** Approved
- **Type:** feature
`;

/** The tail bound the server compiled in — kept in step with worker-log.ts. */
const TAIL_BYTES = 64 * 1024;

/**
 * A scripts dir whose `plot-fleet-scan.sh` prints the pulse we hand it.
 *
 * Everything else is symlinked to the real thing, so the board still builds its
 * cards from the genuine helpers — only the fleet's view of what is checked out
 * where is under this test's control.
 */
function stubScan(pulse) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-scanstub-'));
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (name === 'plot-fleet-scan.sh') continue;
    fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(dir, name));
  }
  // Emitted in the `--stream` shape the server asks for: one `plan` line per
  // plan, then the terminal `pulse` line carrying the whole document. The
  // terminal line is what says the scan FINISHED — a stub that printed only the
  // document would look to the server exactly like a scan killed midway, which
  // is the distinction the streaming scan exists to draw.
  const json = path.join(dir, 'pulse.json');
  const lines = [
    ...pulse.plans.map((plan) => JSON.stringify({ kind: 'plan', plan })),
    JSON.stringify({ kind: 'pulse', pulse }),
  ];
  fs.writeFileSync(json, `${lines.join('\n')}\n`);
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
        file: '2026-08-16-serve-the-log.md',
        phase: 'approved',
        waves: [{ name: 'Log', verdict: 'eligible', branches }],
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
    worker_pid: '4242',
    worker_exit: '',
    worker_dirty_paths: [],
    conflicts_known: false,
    conflicts: [],
    changed_paths: [],
    ...over,
  };
}

/** GET the endpoint for a branch and parse the reply. */
async function getLog(port, branchName) {
  const res = await request(port, {
    method: 'GET',
    path: `/api/worker-log?branch=${encodeURIComponent(branchName)}`,
  });
  return { status: res.status, body: JSON.parse(res.body) };
}

/**
 * Wait for the first scan to land. The cache is filled by an async execFile on
 * the server's own timer, so an immediate request would see a cold cache and
 * report `no-worktree` for every branch — a true answer to a different question
 * than the one these tests ask.
 */
async function settle(port) {
  let last = '';
  for (let i = 0; i < 50; i++) {
    const res = await request(port, { method: 'GET', path: '/api/fleet' });
    const body = JSON.parse(res.body);
    if (body.ready) return;
    // Carry the fleet's own error forward. A stub pulse that fails the contract
    // leaves `ready` false forever, and a bare timeout reports the symptom while
    // the reason — the zod complaint — sits one field away.
    last = body.error ?? '';
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`fleet never became ready${last ? `: ${last}` : ''}`);
}

describe('GET /api/worker-log: derived server-side, bounded, three answers', () => {
  let tmp, server, stub, wtWithLog, wtNoLog, wtEmptyLog;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-serve-the-log.md', content: PLAN }] });
    wtWithLog = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wt-live-'));
    wtNoLog = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wt-nolog-'));
    wtEmptyLog = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wt-empty-'));
    fs.writeFileSync(path.join(wtWithLog, '.plot-worker.log'), 'first line\nsecond line\n');
    fs.writeFileSync(path.join(wtEmptyLog, '.plot-worker.log'), '');
    stub = stubScan(
      pulse([
        branch('feature/live', wtWithLog),
        branch('feature/nolog', wtNoLog),
        branch('feature/empty', wtEmptyLog),
        // Known to the plan, checked out nowhere here — a detached worker, or a
        // teammate's machine.
        branch('feature/elsewhere', '', { worker: 'elsewhere' }),
      ]),
    );
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
    await settle(server.port);
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    for (const d of [wtWithLog, wtNoLog, wtEmptyLog]) if (d) rmTree(d);
    if (tmp) rmTree(tmp);
  });

  it('serves a running worker log, found from the branch alone', async () => {
    const { status, body } = await getLog(server.port, 'feature/live');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.branch, 'feature/live');
    assert.equal(body.text, 'first line\nsecond line\n');
    assert.equal(body.truncated, false);
    // The path is REPORTED (the reader needs somewhere to look) but was never
    // ACCEPTED — the request above carried only a branch.
    assert.equal(body.path, path.join(wtWithLog, '.plot-worker.log'));
  });

  // THE THREE ANSWERS, asserted as three rather than as "not ok". Each pair
  // below would pass a test that only checked `ok === false`.
  it('distinguishes no worktree from no log', async () => {
    const nowhere = await getLog(server.port, 'feature/elsewhere');
    const nolog = await getLog(server.port, 'feature/nolog');
    assert.equal(nowhere.status, 404);
    assert.equal(nowhere.body.reason, 'no-worktree');
    // A worktree with no log is a successful OBSERVATION, not a missing row:
    // 200, so the client keeps offering the log rather than concluding the
    // branch is unknown here.
    assert.equal(nolog.status, 200);
    assert.equal(nolog.body.reason, 'no-log');
    assert.notEqual(nowhere.body.reason, nolog.body.reason);
  });

  it('reports an empty log as read-and-empty, not as absent', async () => {
    const { status, body } = await getLog(server.port, 'feature/empty');
    assert.equal(status, 200);
    // The distinction the whole endpoint exists for: `ok` is TRUE. The file was
    // read; it holds nothing. An implementation folding this into `no-log`
    // would tell a reader no worker had written when one had started.
    assert.equal(body.ok, true);
    assert.equal(body.text, '');
    assert.equal(body.bytes, 0);
    assert.equal(body.truncated, false);
  });

  it('requires a branch', async () => {
    const res = await request(server.port, { method: 'GET', path: '/api/worker-log' });
    assert.equal(res.status, 400);
  });

  // NO REQUEST-SUPPLIED PATH REACHES THE FILESYSTEM. Each of these is a branch
  // name that IS a path to a file that exists; a server joining the request
  // onto a directory would serve one of them.
  for (const evil of [
    '../../../../etc/passwd',
    '/etc/passwd',
    'feature/live/../../../../etc/hosts',
    './feature/live',
  ]) {
    it(`refuses ${evil} — it names no branch the pulse reported`, async () => {
      const { status, body } = await getLog(server.port, evil);
      assert.equal(status, 404);
      assert.equal(body.reason, 'no-worktree');
      assert.equal(body.path, null);
    });
  }

  // A branch name that is a PREFIX of a real one, and one the real one is a
  // prefix of. An implementation matching with `startsWith` or `includes`
  // instead of equality would serve the live log for both.
  it('matches the branch exactly, not by prefix', async () => {
    for (const near of ['feature/liv', 'feature/live2', 'live']) {
      const { body } = await getLog(server.port, near);
      assert.equal(body.reason, 'no-worktree', `${near} should match nothing`);
    }
  });
});

describe('GET /api/worker-log: the bound, and saying so', () => {
  let tmp, server, stub, wt;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-serve-the-log.md', content: PLAN }] });
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wt-big-'));
    // Distinctive at both ends, so the assertion is about WHICH end came back.
    fs.writeFileSync(
      path.join(wt, '.plot-worker.log'),
      `FIRSTLINE\n${'x'.repeat(TAIL_BYTES * 2)}\nLASTLINE\n`,
    );
    stub = stubScan(pulse([branch('feature/big', wt)]));
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
    await settle(server.port);
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (wt) rmTree(wt);
    if (tmp) rmTree(tmp);
  });

  it('returns the tail, bounded, and SAYS it truncated', async () => {
    const { status, body } = await getLog(server.port, 'feature/big');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    // A truncated log presented as whole is the defect this asserts against —
    // the flag is what separates "the worker printed this much" from "the
    // worker printed far more and here is the end".
    assert.equal(body.truncated, true);
    assert.ok(Buffer.byteLength(body.text, 'utf8') <= TAIL_BYTES);
    assert.ok(body.text.includes('LASTLINE'));
    assert.ok(!body.text.includes('FIRSTLINE'));
    // The FULL size travels, so the notice can say what is missing.
    assert.ok(body.bytes > TAIL_BYTES);
  });
});

// THE POINT OF THE WAVE. The plan's argument for serving on demand is that a
// 4 s pulse carrying every agent's console output is a different product — and
// that argument is kept only by the pulse staying as it was.
describe('the pulse carries no log', () => {
  let tmp, server, stub, wt;
  const SECRET = 'SENTINEL-LOG-CONTENT-THAT-MUST-NOT-TRAVEL';

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-serve-the-log.md', content: PLAN }] });
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-wt-quiet-'));
    fs.writeFileSync(path.join(wt, '.plot-worker.log'), `${SECRET}\n`);
    stub = stubScan(pulse([branch('feature/quiet', wt)]));
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
    await settle(server.port);
  });

  after(() => {
    server?.kill();
    stub?.cleanup();
    if (wt) rmTree(wt);
    if (tmp) rmTree(tmp);
  });

  it('serves the log content from /api/worker-log and from nowhere else', async () => {
    // First prove the sentinel is genuinely readable — otherwise the two
    // absences below would pass against a broken endpoint.
    const log = await getLog(server.port, 'feature/quiet');
    assert.ok(log.body.text.includes(SECRET), 'the endpoint should serve it');

    for (const route of ['/api/fleet', '/api/board']) {
      const res = await request(server.port, { method: 'GET', path: route });
      assert.equal(res.status, 200);
      // The CONTENT, not the filename: a payload that started shipping log text
      // under any key at all fails here, which is the drift worth catching.
      assert.ok(!res.body.includes(SECRET), `${route} must not carry log content`);
    }
  });
});
