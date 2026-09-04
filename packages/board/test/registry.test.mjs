// GET /api/fleet — the `agents` list, against the BUILT artifact.
//
// The unit suite (test/unit/registry.test.ts) covers the manifest reader, the
// exact-id transcript join and the omission rules. This covers what only the
// running server can show: that the list is WIRED into the payload, that it
// reaches it from disk rather than from the pulse, and — the load-bearing one —
// that **an agent holding no branch is listed**. That agent appears in no plan,
// so nothing derived from the pulse could ever produce it; if the wiring were
// wrong, every other assertion here would still pass.
//
// A stub `plot-fleet-scan.sh` supplies the pulse and `HOME` is redirected, so
// both the worktrees and the transcripts the server reads are ones this file
// wrote rather than the developer's own.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, makeRepo, request, rmTree, SCRIPTS_DIR } from './helpers.mjs';

const PLAN = `# Registry
## Status
- **Phase:** Approved
- **Type:** feature
`;

/** A scripts dir whose `plot-fleet-scan.sh` prints the pulse we hand it. */
function stubScan(pulse) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-registrystub-'));
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (name === 'plot-fleet-scan.sh') continue;
    fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(dir, name));
  }
  const json = path.join(dir, 'pulse.json');
  const lines = [
    ...pulse.plans.map((plan) => JSON.stringify({ kind: 'plan', plan })),
    JSON.stringify({ kind: 'reading', reading: pulse }),
  ];
  fs.writeFileSync(json, `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'plot-fleet-scan.sh'),
    `#!/usr/bin/env bash\ncat ${JSON.stringify(json)}\n`, { mode: 0o755 });
  return { dir };
}

/** A fake `$HOME` holding a transcript named for `session`, under `worktree`. */
function fakeHome(worktree, session) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-registryhome-'));
  const slug = worktree.replace(/[/.]/g, '-');
  const dir = path.join(home, '.claude', 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${session}.jsonl`), `${JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-20T08:23:10.298Z',
    sessionId: session,
    message: { role: 'assistant', model: 'claude-opus-5',
      usage: { cache_read_input_tokens: 103_619 } },
  })}\n`);
  return home;
}

function writeManifest(repo, body) {
  const dir = path.join(repo, '.plot', 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${body.session}.json`), JSON.stringify(body));
}

async function fleet(port) {
  const res = await request(port, { path: '/api/fleet' });
  assert.equal(res.status, 200);
  return JSON.parse(res.body);
}

describe('the fleet payload carries the agent registry', () => {
  let tmp, server, stub, home;
  const WT = '/tmp/plot-registry-wt';
  const SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-20-registry.md', content: PLAN }] });
    stub = stubScan({ plans: [], generatedAt: '2026-08-20T08:00:00Z' });
    home = fakeHome(WT, SESSION);
    // Two agents: one holding a branch with a transcript on disk, one holding
    // NO branch and no transcript. The second is the wave's reason to exist.
    writeManifest(tmp, { session: SESSION, branch: 'feature/held', worktree: WT,
      command: 'claude -p "go"', startedAt: '2026-08-20T08:00:00Z' });
    writeManifest(tmp, { session: 'ffffffff-0000-0000-0000-000000000000',
      branch: '', worktree: '/tmp/plot-registry-gone',
      command: 'claude -p "between branches"', startedAt: '2026-08-20T07:00:00Z' });
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir, HOME: home });
  });

  after(() => {
    server?.kill();
    for (const d of [tmp, stub?.dir, home]) if (d) rmTree(d);
  });

  it('lists both agents, newest first', async () => {
    const f = await fleet(server.port);
    assert.ok(Array.isArray(f.agents), 'agents is a list on the payload');
    assert.deepEqual(f.agents.map((a) => a.session),
      [SESSION, 'ffffffff-0000-0000-0000-000000000000']);
  });

  it('LISTS the agent that holds no branch, with branch empty', async () => {
    // The criterion. This agent appears in no plan, so the pulse cannot produce
    // it — its presence proves the list is read from disk, not derived.
    const f = await fleet(server.port);
    const none = f.agents.find((a) => a.session.startsWith('ffffffff'));
    assert.ok(none, 'an agent between branches is listed');
    assert.equal(none.branch, '', 'empty is a real value, not an omission');
    assert.equal(none.command, 'claude -p "between branches"');
  });

  it('joins the transcript by session id and carries model and context', async () => {
    const f = await fleet(server.port);
    const held = f.agents.find((a) => a.session === SESSION);
    assert.equal(held.model, 'claude-opus-5');
    assert.equal(held.contextTokens, 103_619);
    assert.equal(held.lastActivity, '2026-08-20T08:23:10.298Z');
  });

  it('costs fields and not the entry where no transcript exists', async () => {
    const f = await fleet(server.port);
    const none = f.agents.find((a) => a.session.startsWith('ffffffff'));
    assert.equal(none.model, undefined);
    assert.equal(none.contextTokens, undefined);
  });

  it('carries a pid and a state on every agent, wired through to the payload', async () => {
    // These two manifests carry no pid and point at worktrees holding no
    // `.plot-worker.pid`, so the shell answers `none` — a record says no worker.
    // The honest wire value is `pid: ''` and that answer verbatim.
    //
    // IT READ `unknown` UNTIL 2026-09-04, because the registry folded `none`,
    // `failed`, `ended` and `elsewhere` into it. The two words are not the same
    // claim: `none` is the shell reporting no worker, `unknown` is the board
    // unable to ask. A live agent reaching `running` is proven in its own block
    // below.
    const f = await fleet(server.port);
    for (const a of f.agents) {
      assert.equal(a.pid, '', `${a.session}: no pid on the manifest reads as ""`);
      assert.equal(a.state, 'none', `${a.session}: no worker record reads as none`);
    }
  });
});

describe('an agent whose process is genuinely alive reaches the wire as running', () => {
  // The wave's reason to exist, end to end: a manifest with a pid and a worktree
  // carrying a live `.plot-worker.pid` must reach the board payload as `running`,
  // through the real `plot-worker-state.sh` the server reuses.
  let tmp, server, stub, wt;
  const SESSION = 'cccccccc-1111-2222-3333-444444444444';

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-20-registry.md', content: PLAN }] });
    stub = stubScan({ plans: [], generatedAt: '2026-08-20T08:00:00Z' });
    // A real worktree dir carrying a live pid — the test runner's own, certainly
    // alive — exactly as the dispatcher leaves `.plot-worker.pid`.
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-registry-live-'));
    fs.writeFileSync(path.join(wt, '.plot-worker.pid'), String(process.pid));
    writeManifest(tmp, { session: SESSION, branch: 'feature/live', worktree: wt,
      command: 'claude -p "go"', pid: String(process.pid), startedAt: '2026-08-20T08:00:00Z' });
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });
  after(() => { server?.kill(); for (const d of [tmp, stub?.dir, wt]) if (d) rmTree(d); });

  it('reads `running` for the live agent, carrying its pid', async () => {
    const f = await fleet(server.port);
    const a = f.agents.find((x) => x.session === SESSION);
    assert.ok(a, 'the live agent is listed');
    assert.equal(a.pid, String(process.pid));
    assert.equal(a.state, 'running');
  });
});

describe('a repo where no dispatch has run', () => {
  let tmp, server, stub;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-20-registry.md', content: PLAN }] });
    stub = stubScan({ plans: [], generatedAt: '2026-08-20T08:00:00Z' });
    server = await startServer(tmp, { PLOT_SCRIPTS_DIR: stub.dir });
  });
  after(() => { server?.kill(); for (const d of [tmp, stub?.dir]) if (d) rmTree(d); });

  it('sends an empty list rather than omitting the field', async () => {
    // No `.plot/agents` at all. Unlike `issues`, this needs no companion answer
    // field: the registry reads a local directory and cannot fail to be asked,
    // so [] is the answer rather than an ambiguity.
    const f = await fleet(server.port);
    assert.deepEqual(f.agents, []);
  });
});
