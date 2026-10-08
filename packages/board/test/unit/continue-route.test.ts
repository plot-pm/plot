// `POST /api/continue`: what it refuses, and what a spawn actually leaves behind.
//
// **The two DoD assertions that need a real handler run live here**: that
// answering starts a NEW run (the previous pid is not reused) and that a branch
// with no marker or no worktree is a clear refusal rather than a spawn. Neither
// can be made against a pure function — the first is about a process and the
// second is about a route that must not start one.
//
// **NOTHING HERE RACES A CHILD PROCESS.** Every assertion is against state the
// handler writes synchronously before it answers — the pid file, the prompt
// file, the 202 body — never against output the spawned worker produces. A test
// that waited for a worker to print something would be a test whose budget is a
// guess, and this repo has already measured that failure: a 1 ms budget that
// passed on macOS failed on CI where the work finished inside the millisecond.
// The worker started here is `true`, which needs no budget at all.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { writeGate } from '../../src/server/write-gate.js';
import {
  CONTINUATION_ENV,
  CONTINUATION_NAME,
  handleContinue,
  continueOnDesk,
  stopAndAwaitExit,
  type ContinueRefusal,
} from '../../src/server/continue.js';
import type { ContinueDeps } from '../../src/server/continue.js';
import type { FleetReading } from '../../src/contract/schema.js';
import { rmTree } from '../helpers.mjs';
import { agentsFs, freshAgentRecordFile } from '@plot-pm/domain/adapters';
import type { DeskMonitors, MonitoredDesk } from '@plot-pm/domain';
import { startFreshSession } from '../../src/server/entry/registryd-main.js';
import {
  applyFreshAgentDecisions,
  freshAgentCandidateTrees,
  freshAgentDecisions,
  readFreshAgentCandidates,
} from '../../src/server/entry/registryd.js';
import { deskManifestFor } from '../../src/server/manifest-stamp.js';
import { ENDING_FILENAME } from '@plot-pm/domain/entities/ending';
import {
  agentsFixture,
  buildFixture,
  deskFixture,
  hostFixture,
  refsFixture,
  refusedSlicesFixture,
  treesFixture,
} from '@plot-pm/domain/adapters';
import { readPass, type WorkerLoopPorts } from '../../src/server/entry/worker-loop.js';

const BRANCH = 'feature/continue-with-an-answer';

/**
 * A manifest directory holding one manifest naming the given worktree.
 *
 * Every fixture needs one since the refusal check landed: `/api/continue` now
 * asks `deskManifestFor` before it writes anything, so a worktree with no
 * manifest naming it is refused `no-manifest` rather than continued. A
 * PRIVATE directory per worktree, never `/tmp/.plot/agents` — that path is
 * shared across this whole file's tests and a second test's manifest there
 * would read as `several` for the first.
 */
function manifestDirFor(wt: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-manifests-'));
  fs.writeFileSync(
    path.join(dir, 'sess.json'),
    JSON.stringify({ session: 'sess', branch: BRANCH, worktree: wt, pid: '424242' }),
  );
  return dir;
}

/** A worktree with a git repo, a marker, a brief and a previous run's records. */
function worktree(opts: { marker?: boolean; pid?: string; wrapperPid?: string } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  // A TRUNK COMMIT FIRST, then the branch on top of it. `landedCommits` asks
  // `main..HEAD`, so a fixture whose only commit is main's own would correctly
  // report that nothing landed — modelling a branch that was never dispatched
  // rather than one whose worker committed and stopped to ask.
  fs.mkdirSync(path.join(dir, '.plot/briefs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.plot/briefs/continue-with-an-answer.md'), '# Brief\n\nDo it.');
  git('add', '-A');
  git('commit', '-qm', 'trunk: before the branch existed');
  git('checkout', '-qb', BRANCH);
  if (opts.marker !== false) {
    // The marker is a PLOT-BLOCKED* FILE the worker wrote, not a string inside
    // some other file — `markerIn` finds it by name, mirroring the classifier.
    fs.writeFileSync(path.join(dir, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which adapter should this use?');
  }
  fs.writeFileSync(path.join(dir, 'landed.txt'), 'what the previous run wrote');
  git('add', '-A');
  git('commit', '-qm', 'board: the thing the previous run landed');
  // The previous run's records, which a continuation must replace rather than
  // inherit.
  fs.writeFileSync(path.join(dir, '.plot-worker.pid'), opts.pid ?? '424242');
  fs.writeFileSync(path.join(dir, '.plot-worker.exit'), '0');
  fs.writeFileSync(path.join(dir, '.plot-worker.log'), 'the previous run said this\n');
  if (opts.wrapperPid !== undefined) {
    fs.writeFileSync(path.join(dir, '.plot-worker.wrapper.pid'), opts.wrapperPid);
  }
  return dir;
}

function pulseWith(wt: string): FleetReading {
  return {
    main: 'main',
    head: 'abc',
    fetch_failed: false,
    plans: [
      {
        file: 'docs/plans/p.md',
        phase: 'Approved',
        slices: [
          {
            name: 'Answer',
            verdict: 'eligible',
            branches: [
              { branch: BRANCH, local_worktree: wt, worker: 'waiting', worker_pid: '424242' },
            ],
          },
        ],
      },
    ],
  } as unknown as FleetReading;
}

/** A request carrying a JSON body, as the handler reads one. */
function request(body: unknown): http.IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  req.headers = {};
  req.method = 'POST';
  return req;
}

/** A response that captures what the handler wrote. */
function response() {
  const out: { status: number; body: unknown } = { status: 0, body: null };
  const res = {
    writeHead(status: number) {
      out.status = status;
      return res;
    },
    end(text?: string) {
      out.body = text ? JSON.parse(text) : null;
    },
    headersSent: false,
  } as unknown as http.ServerResponse;
  return { res, out };
}

const dirs: string[] = [];

/**
 * Wait for the worker this test started to FINISH, then remove its worktree.
 *
 * **The cleanup must not race the process either**, and `maxRetries` cannot win
 * that race: retrying `rmdir` against a worker that is still creating files is
 * a loop against a writer, not a wait for one. Measured on CI (Linux) where
 * four of these failed `ENOTEMPTY` while every assertion had already passed —
 * the brief's *a test must not race what it asserts* applies to teardown as
 * much as to the assertion.
 *
 * `.plot-worker.exit` is the deterministic signal: the handler wraps the worker
 * command so that its return code is written there when it exits, and the
 * handler DELETES any previous one before spawning. So the file appearing means
 * this run's worker has finished — a real event rather than a guessed duration.
 *
 * The deadline is a backstop for the cases that never spawn (every refusal
 * test), not a budget for the ones that do: those return immediately because
 * `dirs` holds a worktree whose worker was never started, and waiting out the
 * full deadline for them would be the fixed-budget mistake in another costume.
 * Hence the `spawned` flag — only a test that started a worker waits for one.
 */
const spawned = new Set<string>();

async function settle(dir: string): Promise<void> {
  if (!spawned.has(dir)) return;
  const exit = path.join(dir, '.plot-worker.exit');
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(exit) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    await settle(dir);
    rmTree(dir);
  }
});

/**
 * The route's two outside readers, injected.
 *
 * A SEAM, not a mock — see ContinueDeps. `wt` of null is a board whose pulse
 * has never landed; "" is a pulse that knows the branch and holds no worktree
 * for it. The two are different refusals and the distinction is the point.
 */
function deps(wt: string | null, workerCommand = 'true'): ContinueDeps {
  return {
    pulse: () => (wt === null ? null : pulseWith(wt)),
    config: (_o, key, fallback) => (key === 'Worker command' ? workerCommand : fallback),
  };
}

const opts = {
  repoRoot: '/tmp',
  scriptsDir: '/tmp',
  host: 'localhost',
  port: 7777,
};

const manifestDirs: string[] = [];
afterEach(() => {
  while (manifestDirs.length) rmTree(manifestDirs.pop()!);
});

/** `opts` plus a manifest directory naming `wt` — the shape every post needs now. */
function optsFor(wt: string) {
  const manifestDir = manifestDirFor(wt);
  manifestDirs.push(manifestDir);
  return { ...opts, manifestDir };
}

async function post(body: unknown, d: ContinueDeps, wt: string) {
  const { res, out } = response();
  await handleContinue(request(body), res, optsFor(wt), d);
  // A 202 is the one answer that means a process was started, so it is also
  // the one that obliges teardown to wait for it. Recorded here rather than
  // per-test: a test that forgets would fail on CI and pass locally, which is
  // the failure mode this whole mechanism exists to remove.
  if (out.status === 202) {
    const p = (out.body as { prompt?: string }).prompt;
    if (p) spawned.add(path.dirname(p));
  }
  return out;
}

describe('answering starts a NEW run', () => {
  it('does not reuse the previous pid', async () => {
    // THE ASSERTION THE PLAN ASKS FOR, made against both the reply and the
    // record on disk. `claude -p` has no stdin after launch, so a continuation
    // that reported the old pid would be claiming to have spoken to a process
    // nobody can speak to.
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);

    const out = await post({ branch: BRANCH, answer: 'use the existing endpoint' }, deps(wt), wt);
    assert.equal(out.status, 202);
    const body = out.body as { ok: boolean; pid: string; previousPid: string };
    assert.equal(body.ok, true);
    assert.notEqual(body.pid, '', 'a continuation must report the pid it started');
    assert.notEqual(body.pid, body.previousPid, 'the previous pid must not be reused');
    assert.equal(body.previousPid, '424242', 'and the reply names the one it replaced');

    // The record on disk is the new run's too — the scan reads this file, so a
    // stale pid here would show the row as the dead worker.
    const recorded = fs.readFileSync(path.join(wt, '.plot-worker.pid'), 'utf8').trim();
    assert.equal(recorded, body.pid);
    assert.notEqual(recorded, '424242');
  });

  it('clears the previous run’s exit record', async () => {
    // Left in place, the scan would read a FRESH worker's state from its
    // predecessor's exit code — a running agent reported finished.
    //
    // THE WORKER HERE SLEEPS, and that is the assertion's precondition rather
    // than padding. `true` exits within microseconds and writes its OWN exit
    // record, so on a fast runner the file is back before this line reads it
    // and the test fails having proved nothing — measured on CI, which is
    // Linux, while it passed on macOS. A worker that is still running keeps the
    // window open, so what is observed is the handler's delete and not a race
    // with the worker's write.
    const wt = worktree();
    dirs.push(wt);
    await post({ branch: BRANCH, answer: 'go' }, deps(wt, 'sleep 2'), wt);
    assert.equal(
      fs.existsSync(path.join(wt, '.plot-worker.exit')),
      false,
      'the predecessor’s exit record must be gone while the new worker runs',
    );
  });

  it('appends to the previous log rather than truncating it', async () => {
    // The old log is the record of the question being asked. Erasing it would
    // destroy the context a reader needs to judge whether the answer was right.
    const wt = worktree();
    dirs.push(wt);
    await post({ branch: BRANCH, answer: 'go' }, deps(wt), wt);
    const log = fs.readFileSync(path.join(wt, '.plot-worker.log'), 'utf8');
    assert.ok(log.includes('the previous run said this'), 'the previous log must survive');
  });
});

describe('answering UPDATES the manifest — the path that produced the defect', () => {
  // THE ASSERTION THE PLAN ASKS FOR AGAINST THIS ROUTE, not only the dispatcher.
  // `/api/continue` spawns directly and never runs `plot-dispatch.sh`, so a fix
  // to the dispatcher's awk alone would leave this path — the one the reported
  // bug came from — stamping nothing. The manifest for the branch's worktree must
  // name the NEW pid, record the displaced one, and count the relaunch.

  /** A repoRoot carrying one manifest whose worktree matches the fixture. */
  function repoWithManifest(wt: string, pid: string): { root: string; manifest: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-repo-'));
    const dir = path.join(root, '.plot', 'agents');
    fs.mkdirSync(dir, { recursive: true });
    const manifest = path.join(dir, 'sess-1.json');
    fs.writeFileSync(
      manifest,
      [
        '{',
        '  "session": "sess-1",',
        `  "branch": "${BRANCH}",`,
        `  "worktree": "${wt}",`,
        '  "command": "claude -p \\"go\\"",',
        `  "pid": "${pid}",`,
        '  "startedAt": "2026-08-20T09:00:00Z"',
        '}',
        '',
      ].join('\n'),
    );
    return { root, manifest };
  }

  const roots: string[] = [];
  afterEach(() => {
    while (roots.length) rmTree(roots.pop()!);
  });

  async function postTo(root: string, body: unknown, d: ContinueDeps) {
    const { res, out } = response();
    await handleContinue(request(body), res, { ...opts, repoRoot: root }, d);
    if (out.status === 202) {
      const p = (out.body as { prompt?: string }).prompt;
      if (p) spawned.add(path.dirname(p));
    }
    return out;
  }

  it('overwrites the pid, records previousPid, and increments relaunches', async () => {
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);
    const { root, manifest } = repoWithManifest(wt, '424242');
    roots.push(root);

    const out = await postTo(root, { branch: BRANCH, answer: 'go' }, deps(wt));
    assert.equal(out.status, 202);
    const body = out.body as { pid: string; previousPid: string };

    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal(m.pid, body.pid, 'the manifest names the new run');
    assert.notEqual(m.pid, '424242');
    assert.equal(m.previousPid, '424242', 'and records the pid it displaced');
    assert.equal(m.relaunches, 1, 'the relaunch is counted');
  });

  it('increments relaunches across TWO relaunches', async () => {
    // Catches a stamp that sets previousPid correctly but never counts: relaunch
    // once, then relaunch the same worktree again.
    const wt = worktree({ pid: '111' });
    dirs.push(wt);
    const { root, manifest } = repoWithManifest(wt, '111');
    roots.push(root);

    const first = await postTo(root, { branch: BRANCH, answer: 'go' }, deps(wt));
    // The first run must have EXITED before the second continues: the new
    // `loop-alive` refusal reads the pid the first one started, and `true`
    // runs so briefly that the race goes the wrong way more often than not.
    await settle(wt);
    // The marker must exist for the second continuation to be accepted. The
    // `true` worker never cleared the first run's marker, so a PLOT-BLOCKED* FILE
    // is still in the tree — but write a fresh one by name to be explicit, since
    // `markerIn` finds the marker by filename, not by content.
    fs.writeFileSync(path.join(wt, 'PLOT-BLOCKED-again.md'), 'PLOT-BLOCKED: and again?');
    // The pulse's previousPid comes from `worker_pid`; point it at the pid the
    // first relaunch wrote, as a fresh pulse would.
    const firstPid = (first.body as { pid: string }).pid;
    const second = await postTo(root, { branch: BRANCH, answer: 'go' }, {
      pulse: () => pulseWith2(wt, firstPid),
      config: (_o, key, fb) => (key === 'Worker command' ? 'true' : fb),
    });
    assert.equal(second.status, 202);

    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal(m.relaunches, 2, 'counted across two relaunches, not just overwritten');
    assert.equal(m.previousPid, firstPid, 'the second relaunch displaced the first');
  });

  it('starts the AgentMonitor for the desk and records its pid (#1255)', async () => {
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);
    const { root, manifest } = repoWithManifest(wt, '424242');
    roots.push(root);
    const calls: MonitoredDesk[] = [];
    let pidAtStart = '';
    const monitors: DeskMonitors = {
      start: (desk) => {
        calls.push(desk);
        pidAtStart = fs.readFileSync(desk.pidFile, 'utf8');
        return { ok: true, value: { agentMonitorPid: '7001' } };
      },
      stop: () => ({ ok: true, value: [] }),
    };

    const out = await postTo(root, { branch: BRANCH, answer: 'go' }, { ...deps(wt), monitors });
    assert.equal(out.status, 202);
    const body = out.body as { pid: string };

    assert.deepEqual(calls, [
      {
        branch: BRANCH,
        worktree: wt,
        manifestFile: manifest,
        pidFile: path.join(wt, '.plot-worker.pid'),
        log: path.join(wt, '.plot-worker.log'),
      },
    ]);
    assert.equal(pidAtStart, body.pid, 'the pid file names the new run before a monitor reads it');
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal(m.agentMonitorPid, '7001');
  });

  it('a second continue stops the monitor the first one started', async () => {
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);
    const { root } = repoWithManifest(wt, '424242');
    roots.push(root);
    const stopped: (readonly string[])[] = [];
    let next = 7000;
    const monitors: DeskMonitors = {
      start: () => ({ ok: true, value: { agentMonitorPid: String(++next) } }),
      stop: (pids) => {
        stopped.push(pids);
        return { ok: true, value: pids };
      },
    };

    const first = await postTo(root, { branch: BRANCH, answer: 'go' }, { ...deps(wt), monitors });
    // The first run must have EXITED before the second continues: the new
    // `loop-alive` refusal reads the pid the first one started, and `true`
    // runs so briefly that the race goes the wrong way more often than not.
    await settle(wt);
    fs.writeFileSync(path.join(wt, 'PLOT-BLOCKED-again.md'), 'PLOT-BLOCKED: and again?');
    const second = await postTo(root, { branch: BRANCH, answer: 'go' }, {
      pulse: () => pulseWith2(wt, (first.body as { pid: string }).pid),
      config: (_o, key, fb) => (key === 'Worker command' ? 'true' : fb),
      monitors,
    });

    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.deepEqual(stopped, [['7001']], 'the first continue had none to stop; the second stops the first');
  });

  it('stops a desk\'s recorded BuildMonitor pid too, from before #1337 (#1338)', async () => {
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);
    const { root, manifest } = repoWithManifest(wt, '424242');
    roots.push(root);
    const raw = fs.readFileSync(manifest, 'utf8');
    fs.writeFileSync(manifest, raw.replace('"startedAt"', '"agentMonitorPid": "5001",\n  "buildMonitorPid": "5002",\n  "startedAt"'));
    const stopped: (readonly string[])[] = [];
    const monitors: DeskMonitors = {
      start: () => ({ ok: true, value: { agentMonitorPid: '7001' } }),
      stop: (pids) => {
        stopped.push(pids);
        return { ok: true, value: pids };
      },
    };

    const out = await postTo(root, { branch: BRANCH, answer: 'go' }, { ...deps(wt), monitors });

    assert.equal(out.status, 202);
    assert.deepEqual(
      stopped,
      [['5001', '5002']],
      'a manifest from before #1337 still carries buildMonitorPid; both pids are handed to the one stop path',
    );
  });

  it('logs a monitor start that failed', async () => {
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);
    const { root } = repoWithManifest(wt, '424242');
    roots.push(root);
    const monitors: DeskMonitors = {
      start: () => ({ ok: false, why: 'failed' }),
      stop: () => ({ ok: true, value: [] }),
    };

    const out = await postTo(root, { branch: BRANCH, answer: 'go' }, { ...deps(wt), monitors });

    assert.equal(out.status, 202);
    assert.match(
      fs.readFileSync(path.join(wt, '.plot-worker.log'), 'utf8'),
      /AgentMonitor not started: the start answered failed/,
    );
  });

  it('starts the monitor script under the configured scripts directory by default', async () => {
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);
    const { root, manifest } = repoWithManifest(wt, '424242');
    roots.push(root);
    const scriptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-scripts-'));
    roots.push(scriptsDir);
    for (const name of ['plot-agent-monitor.sh']) {
      const file = path.join(scriptsDir, name);
      fs.writeFileSync(
        file,
        `#!/bin/sh\nprintf '%s\\n' "$PLOT_BRANCH" "$PLOT_WORKTREE" > "$PLOT_WORKTREE/${name}.env.tmp" && mv "$PLOT_WORKTREE/${name}.env.tmp" "$PLOT_WORKTREE/${name}.env"\n`,
      );
      fs.chmodSync(file, 0o755);
    }

    const started = await continueOnDesk({
      opts: { ...opts, repoRoot: root, scriptsDir, manifestDir: path.dirname(manifest) },
      readCfg: (_o, key, fb) => (key === 'Worker command' ? 'true' : fb),
      branch: BRANCH,
      worktree: wt,
      main: 'main',
      previousPid: '424242',
      answer: 'go',
    });
    assert.equal(started.kind, 'started');
    spawned.add(wt);

    const agentEnv = path.join(wt, 'plot-agent-monitor.sh.env');
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(agentEnv) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(fs.readFileSync(agentEnv, 'utf8').split('\n').slice(0, 2), [BRANCH, wt]);
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.match(m.agentMonitorPid, /^\d+$/);
  });

  it('refuses a continuation when no manifest names the worktree', async () => {
    // THE ANTI-CONTRACT, REWRITTEN. The manifest was a best-effort display fact
    // until #1101: a free loop started with no `PLOT_MANIFEST_FILE` never ends
    // on a vanished registration, it just spins at `Worker bound` logging
    // `free on ?`. So a continuation now REFUSES rather than spawns when the
    // registry cannot name the manifest to hand the new loop.
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-nomani-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, '.plot', 'agents'), { recursive: true });
    const out = await postTo(root, { branch: BRANCH, answer: 'go' }, deps(wt));
    assert.equal(out.status, 409, 'a missing manifest is now a refusal, not a best-effort skip');
    assert.equal((out.body as { reason: string }).reason, 'no-manifest');
  });
});

/** A pulse whose worker_pid is the given previous pid — for the second relaunch. */
function pulseWith2(wt: string, previousPid: string): FleetReading {
  return {
    main: 'main',
    head: 'abc',
    fetch_failed: false,
    plans: [
      {
        file: 'docs/plans/p.md',
        phase: 'Approved',
        slices: [
          {
            name: 'Answer',
            verdict: 'eligible',
            branches: [
              { branch: BRANCH, local_worktree: wt, worker: 'waiting', worker_pid: previousPid },
            ],
          },
        ],
      },
    ],
  } as unknown as FleetReading;
}

describe('the prompt that reaches the worker', () => {
  it('is written into the worktree and named in the reply', async () => {
    const wt = worktree();
    dirs.push(wt);
    const out = await post({ branch: BRANCH, answer: 'use the existing endpoint' }, deps(wt), wt);
    const body = out.body as { prompt: string };
    assert.equal(body.prompt, path.join(wt, CONTINUATION_NAME));
    assert.ok(fs.existsSync(body.prompt), 'the prompt must exist before the worker starts');
  });

  it('carries the brief, the answer and what landed — and no transcript', async () => {
    // The wave's central assertion, made against the FILE the worker will
    // actually read rather than against the composer alone.
    const wt = worktree();
    dirs.push(wt);
    await post({ branch: BRANCH, answer: 'use the existing endpoint, do not add a second' }, deps(wt), wt);
    const text = fs.readFileSync(path.join(wt, CONTINUATION_NAME), 'utf8');

    assert.ok(text.includes('Do it.'), 'the brief');
    assert.ok(text.includes('use the existing endpoint, do not add a second'), 'the answer');
    assert.ok(text.includes('the thing the previous run landed'), 'what already landed');
    assert.ok(text.includes('which adapter should this use?'), 'the question it answers');

    // The previous run's log is on disk right beside this file. It must not
    // have been read into the prompt.
    assert.ok(
      !text.includes('the previous run said this'),
      'the previous run’s log must not reach the prompt',
    );
  });

  it('is bounded — a brief plus an answer, not a run’s worth of output', async () => {
    const wt = worktree();
    dirs.push(wt);
    await post({ branch: BRANCH, answer: 'go' }, deps(wt), wt);
    const bytes = fs.statSync(path.join(wt, CONTINUATION_NAME)).size;
    assert.ok(bytes < 32_000, `prompt was ${bytes} bytes`);
  });
});

describe('what cannot be continued is refused, never spawned', () => {
  const refusal = (out: { status: number; body: unknown }) =>
    (out.body as { reason: ContinueRefusal }).reason;

  it('refuses a branch the board has never heard of', async () => {
    const out = await post({ branch: 'feature/nothing', answer: 'go' }, deps(null), '/tmp/no-such-worktree');
    assert.equal(out.status, 404);
    assert.equal(refusal(out), 'unknown-branch');
  });

  it('refuses a branch this machine holds no worktree for', async () => {
    // A different statement from the one above, and it sends the reader
    // somewhere else: ask the machine that has it.
    const out = await post({ branch: BRANCH, answer: 'go' }, deps(''), '/tmp/no-such-worktree');
    assert.equal(out.status, 404);
    assert.equal(refusal(out), 'no-worktree');
  });

  it('refuses a worktree with no unanswered question', async () => {
    // The precondition IS the state the control was offered for. Without it,
    // a click could start a second agent in a worktree that holds a live one.
    const wt = worktree({ marker: false });
    dirs.push(wt);
    const out = await post({ branch: BRANCH, answer: 'go' }, deps(wt), wt);
    assert.equal(out.status, 409);
    assert.equal(refusal(out), 'no-question');
    assert.equal(
      fs.existsSync(path.join(wt, CONTINUATION_NAME)),
      false,
      'a refusal must not leave a prompt behind',
    );
  });

  it('refuses when no Worker command is configured', async () => {
    const wt = worktree();
    dirs.push(wt);
    const out = await post({ branch: BRANCH, answer: 'go' }, deps(wt, ''), wt);
    assert.equal(out.status, 409);
    assert.equal(refusal(out), 'no-worker-command');
  });

  it('refuses `Worker command: none` — a repo that starts them by hand', async () => {
    const wt = worktree();
    dirs.push(wt);
    const out = await post({ branch: BRANCH, answer: 'go' }, deps(wt, 'none'), wt);
    assert.equal(refusal(out), 'no-worker-command');
  });

  it('refuses a worktree no manifest names', async () => {
    // THE NEW REFUSAL. The desk otherwise looks ready — a marker, a Worker
    // command — but the registry cannot vouch for it, so the continuation must
    // not spawn a loop it can hand no PLOT_MANIFEST_FILE.
    const wt = worktree();
    dirs.push(wt);
    // An EMPTY, isolated manifest directory — never the shared `/tmp` default,
    // which other tests in this file populate.
    const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-empty-'));
    manifestDirs.push(manifestDir);
    const { res, out } = response();
    await handleContinue(
      request({ branch: BRANCH, answer: 'go' }),
      res,
      { ...opts, manifestDir },
      deps(wt),
    );
    assert.equal(out.status, 409);
    assert.equal(refusal(out), 'no-manifest');
    assert.ok(
      (out.body as { detail: string }).detail.includes(wt),
      'the refusal names the desk',
    );
    assert.equal(
      fs.existsSync(path.join(wt, CONTINUATION_NAME)),
      false,
      'a refusal must not leave a prompt behind — catches a refusal placed after the write',
    );
  });

  it('refuses a worktree two manifests name, naming both', async () => {
    const wt = worktree();
    dirs.push(wt);
    const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-several-'));
    manifestDirs.push(manifestDir);
    const first = path.join(manifestDir, 'a.json');
    const second = path.join(manifestDir, 'b.json');
    fs.writeFileSync(first, JSON.stringify({ session: 'a', worktree: wt }));
    fs.writeFileSync(second, JSON.stringify({ session: 'b', worktree: wt }));

    const { res, out } = response();
    await handleContinue(
      request({ branch: BRANCH, answer: 'go' }),
      res,
      { ...opts, manifestDir },
      deps(wt),
    );
    assert.equal(out.status, 409);
    assert.equal(refusal(out), 'no-manifest');
    const detail = (out.body as { detail: string }).detail;
    assert.ok(detail.includes(first) && detail.includes(second), 'both manifests are named');
    assert.equal(
      fs.existsSync(path.join(wt, CONTINUATION_NAME)),
      false,
      'a refusal must not leave a prompt behind',
    );
  });

  it('gives each refusal its own reason', async () => {
    // Five distinct reasons, five different next moves. Collapsing any two
    // into one message is the defect the three-way answers elsewhere in this
    // server exist to prevent.
    const reasons: ContinueRefusal[] = [
      'unknown-branch',
      'no-worktree',
      'no-question',
      'no-worker-command',
      'no-manifest',
    ];
    assert.equal(new Set(reasons).size, reasons.length);
  });

  it('refuses an empty answer rather than burning a run on nothing', async () => {
    const wt = worktree();
    dirs.push(wt);
    for (const answer of ['', '   ', '\n']) {
      const out = await post({ branch: BRANCH, answer }, deps(wt), wt);
      assert.equal(out.status, 400);
    }
  });

  it('refuses an answer past its bound, naming the field', async () => {
    const wt = worktree();
    dirs.push(wt);
    const out = await post({ branch: BRANCH, answer: 'x'.repeat(9_000) }, deps(wt), wt);
    assert.equal(out.status, 400);
    assert.ok(/answer/.test((out.body as { error: string }).error), 'the error names the answer');
  });

  it('refuses a request with no branch', async () => {
    assert.equal((await post({ answer: 'go' }, deps(null), '/tmp/no-such-worktree')).status, 400);
  });
});

describe('the spawning guards are the ones /api/dispatch already has', () => {
  it('refuses a board not bound to localhost — now in the router, for all five write routes', () => {
    // THE GUARANTEE IS UNCHANGED; ITS HOME MOVED.
    //
    // This handler used to make the loopback check itself, and this asserted it
    // by calling `handleContinue` with a non-loopback host. Since 2026-08-19 the
    // check lives in the router, ahead of every write route at once, because a
    // check each handler has to remember is a rule while a check where routes
    // are dispatched is a gate — and because with a named opt-in in play, three
    // surviving copies would have made one variable mean different things on
    // different routes.
    //
    // So the DECISION is asserted here, where it is now made, and the WIRING is
    // asserted end-to-end over all five routes in `test/write-gate.test.mjs` —
    // including that a refused request spawned nothing, which is the assertion
    // that actually matters and which calling a handler directly cannot make.
    const verdict = writeGate('0.0.0.0', {});
    assert.equal(verdict.allowed, false);
    assert.ok(/0\.0\.0\.0/.test(verdict.reason), 'the refusal names the binding');
    assert.ok(writeGate('localhost', {}).allowed, 'and loopback still serves');
  });

  it('refuses a cross-origin request', async () => {
    // The textual-CSRF hole the binding argument cannot cover: any site the
    // user visits can POST to localhost.
    const req = request({ branch: BRANCH, answer: 'go' });
    req.headers = { 'sec-fetch-site': 'cross-site' };
    const { res, out } = response();
    await handleContinue(req, res, opts);
    assert.equal(out.status, 403);
    assert.ok(/cross-origin/.test((out.body as { error: string }).error));
  });
});

describe('the environment the worker is started with', () => {
  it('names the prompt file in PLOT_CONTINUATION', async () => {
    // Asserted through a worker command that RECORDS its environment, which is
    // the only way to see what the child actually received. `sh -c` writing one
    // file needs no timing budget: the assertion waits for the file the command
    // was told to write, bounded, rather than for a fixed sleep.
    const wt = worktree();
    dirs.push(wt);
    const witness = path.join(wt, 'witness.txt');

    // The worker writes to a scratch path and RENAMES it into place. `>` creates
    // and truncates before `printf` writes into it, so a reader waiting on the
    // witness's existence can observe a real but still-empty file; `mv` within
    // one directory publishes the name only once the content is complete.
    const scratch = path.join(wt, 'witness.part');
    await post(
      { branch: BRANCH, answer: 'go' },
      deps(
        wt,
        `printf '%s' "$${CONTINUATION_ENV}" > ${JSON.stringify(scratch)} && mv ${JSON.stringify(scratch)} ${JSON.stringify(witness)}`,
      ),
      wt,
    );

    // Poll for the witness rather than sleeping for a guessed duration — the
    // race this repo measured is a FIXED budget, not a bounded wait.
    //
    // Poll for CONTENT, not existence. Measured 2026-08-20 under
    // `--fileParallelism`: this assertion failed once in ten runs with
    // `actual: ''` — the file was there and empty, so `existsSync` was satisfied
    // by a write that had not happened yet. Zero failures in six serial runs at
    // the same load, which is why parallelism SURFACED this rather than caused
    // it: the worker is detached, so nothing here was ever synchronised with its
    // write. Waiting on content also makes the wait's subject the thing being
    // asserted, so a regression in the publish step fails as a timeout rather
    // than as an empty string compared against a path.
    const read = (): string => {
      try {
        return fs.readFileSync(witness, 'utf8');
      } catch {
        return '';
      }
    };
    const deadline = Date.now() + 10_000;
    while (read() === '' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(read() !== '', 'the worker did not report its environment within 10s');
    assert.equal(read(), path.join(wt, CONTINUATION_NAME));
  });

  it('names the manifest that names this desk in PLOT_MANIFEST_FILE', async () => {
    // #1101: a loop with no PLOT_MANIFEST_FILE at all can never end on a
    // vanished registration — `assigned_branch` returns 1 forever and the wait
    // holds the desk for the full `Worker bound`, logging `free on ?`. Read
    // from the WORKER'S OWN OUTPUT, not the route's reply: a test reading the
    // reply would pass with the variable unset.
    const wt = worktree();
    dirs.push(wt);
    const manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-manifest-env-'));
    manifestDirs.push(manifestDir);
    const manifestPath = path.join(manifestDir, 'sess.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ session: 'sess', branch: BRANCH, worktree: wt, pid: '424242' }),
    );

    const witness = path.join(wt, 'manifest-witness.txt');
    const scratch = path.join(wt, 'manifest-witness.part');
    const { res, out } = response();
    const d = deps(
      wt,
      `printf '%s' "$PLOT_MANIFEST_FILE" > ${JSON.stringify(scratch)} && mv ${JSON.stringify(scratch)} ${JSON.stringify(witness)}`,
    );
    await handleContinue(
      request({ branch: BRANCH, answer: 'go' }),
      res,
      { ...opts, manifestDir },
      d,
    );
    if (out.status === 202) {
      const p = (out.body as { prompt?: string }).prompt;
      if (p) spawned.add(path.dirname(p));
    }
    assert.equal(out.status, 202);

    const read = (): string => {
      try {
        return fs.readFileSync(witness, 'utf8');
      } catch {
        return '';
      }
    };
    const deadline = Date.now() + 10_000;
    while (read() === '' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(read() !== '', 'the worker did not report PLOT_MANIFEST_FILE within 10s');
    assert.equal(read(), manifestPath);
  });
});

describe('a stale wrapper pid is cleared before the spawn', () => {
  it('removes .plot-worker.wrapper.pid, which this route never starts one of', async () => {
    // #1101's second measured defect: the route leaves the previous dispatch's
    // wrapper pid file in place and starts no wrapper to replace it.
    // `plot_worker_state` reads that file as proof a wrapper is watching, so a
    // waiting loop with no agent beneath it reads `finished`.
    const wt = worktree({ wrapperPid: '99999' });
    dirs.push(wt);
    assert.ok(fs.existsSync(path.join(wt, '.plot-worker.wrapper.pid')), 'the fixture set it up');

    await post({ branch: BRANCH, answer: 'go' }, deps(wt), wt);

    assert.equal(
      fs.existsSync(path.join(wt, '.plot-worker.wrapper.pid')),
      false,
      'the stale wrapper pid must be gone after a continuation — this route starts no wrapper',
    );
  });
});

describe('continueOnDesk, as the registry tick calls it', () => {
  /** A manifest directory naming `wt`, with the resume id the loop would read. */
  function resumableManifestDir(wt: string): { dir: string; file: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-resumable-'));
    manifestDirs.push(dir);
    const file = path.join(dir, 'sess.json');
    fs.writeFileSync(
      file,
      `${JSON.stringify(
        { session: 'sess', branch: BRANCH, worktree: wt, pid: '424242', resumeId: 'the-spent-session' },
        null,
        2,
      )}\n`,
    );
    return { dir, file };
  }

  const input = (wt: string, dir: string) => ({
    opts: { ...opts, manifestDir: dir },
    readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'true' : fallback),
    branch: BRANCH,
    worktree: wt,
    main: 'main',
    previousPid: '424242',
    answer: 'the composed answer',
  });

  const settleAfter = (wt: string) => spawned.add(wt);

  it('keeps the manifest resume id when the start is not fresh', async () => {
    const wt = worktree();
    dirs.push(wt);
    const { dir, file } = resumableManifestDir(wt);
    const result = await continueOnDesk(input(wt, dir));
    assert.equal(result.kind, 'started');
    settleAfter(wt);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).resumeId, 'the-spent-session');
  });

  it('replaces the manifest resume id with a new one when the start is fresh', async () => {
    const wt = worktree();
    dirs.push(wt);
    const { dir, file } = resumableManifestDir(wt);
    const result = await continueOnDesk({ ...input(wt, dir), fresh: true });
    assert.equal(result.kind, 'started');
    settleAfter(wt);
    const resumeId = JSON.parse(fs.readFileSync(file, 'utf8')).resumeId as string;
    assert.notEqual(resumeId, 'the-spent-session');
    assert.match(resumeId, /^[0-9a-f-]{36}$/);
    assert.equal(fs.readFileSync(path.join(wt, CONTINUATION_NAME), 'utf8').includes('the composed answer'), true);
  });

  it('does not start where a fresh start cannot replace the resume id', async () => {
    const wt = worktree();
    dirs.push(wt);
    const { dir, file } = resumableManifestDir(wt);
    void file;
    // A READ-ONLY DIRECTORY: the manifest still reads and names the desk, so
    // the refusal checks pass and only the temp-file write for the new id fails.
    fs.chmodSync(dir, 0o555);
    try {
      const result = await continueOnDesk({ ...input(wt, dir), fresh: true });
      assert.equal(result.kind, 'failed');
      assert.equal(fs.existsSync(path.join(wt, CONTINUATION_NAME)), false);
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });

  it('runs beforeStart after the refusal checks and stops the start on false', async () => {
    const wt = worktree();
    dirs.push(wt);
    const { dir } = resumableManifestDir(wt);
    let asked = 0;
    const result = await continueOnDesk({
      ...input(wt, dir),
      beforeStart: async () => {
        asked += 1;
        return false;
      },
    });
    assert.equal(asked, 1);
    assert.equal(result.kind, 'failed');
    assert.equal(fs.existsSync(path.join(wt, CONTINUATION_NAME)), false);
    assert.equal(fs.readFileSync(path.join(wt, '.plot-worker.pid'), 'utf8'), '424242');
  });

  it('does not call beforeStart for a desk it refuses', async () => {
    const wt = worktree();
    dirs.push(wt);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-nomanifest-'));
    manifestDirs.push(empty);
    let asked = 0;
    const result = await continueOnDesk({
      ...input(wt, empty),
      beforeStart: async () => {
        asked += 1;
        return true;
      },
    });
    assert.equal(asked, 0);
    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'no-manifest');
  });
});

describe('the ending record routes an answer when no manifest names the desk', () => {
  /** Writes `.plot-worker.ending.json` naming `branch` as the reason the loop stopped. */
  function writeBlockedEnding(wt: string, branch: string): void {
    fs.writeFileSync(
      path.join(wt, ENDING_FILENAME),
      JSON.stringify({ reason: 'blocked', actor: 'agent', branch, detail: '' }),
    );
  }

  const input = (wt: string, dir: string) => ({
    opts: { ...opts, manifestDir: dir },
    readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'true' : fallback),
    branch: BRANCH,
    worktree: wt,
    main: 'main',
    previousPid: '',
    answer: 'the composed answer',
  });

  const settleAfter = (wt: string) => spawned.add(wt);

  it('starts a loop with a manifest written from the ending record, found by deskManifestFor afterwards', async () => {
    const wt = worktree();
    dirs.push(wt);
    writeBlockedEnding(wt, BRANCH);
    const emptyManifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-ending-write-'));
    manifestDirs.push(emptyManifestDir);

    const result = await continueOnDesk(input(wt, emptyManifestDir));
    assert.equal(result.kind, 'started');
    settleAfter(wt);

    const found = deskManifestFor('/tmp', wt, { manifestDir: emptyManifestDir });
    assert.equal(found.kind, 'named');
    if (found.kind === 'named') {
      const written = JSON.parse(fs.readFileSync(found.path, 'utf8'));
      assert.equal(written.branch, BRANCH);
      assert.equal(written.worktree, wt);
    }
  });

  it('refuses a wrong-branch ending, leaving the manifest directory listing unchanged', async () => {
    const wt = worktree();
    dirs.push(wt);
    writeBlockedEnding(wt, 'bug/some-other-branch');
    const emptyManifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-ending-wrong-branch-'));
    manifestDirs.push(emptyManifestDir);
    const before = fs.readdirSync(emptyManifestDir);

    const result = await continueOnDesk(input(wt, emptyManifestDir));
    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'no-manifest');
    assert.deepEqual(fs.readdirSync(emptyManifestDir), before);
    assert.equal(fs.existsSync(path.join(wt, CONTINUATION_NAME)), false);
  });

  it('refuses a blocked ending with no unanswered marker, as no-question', async () => {
    const wt = worktree({ marker: false });
    dirs.push(wt);
    writeBlockedEnding(wt, BRANCH);
    const emptyManifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-ending-no-question-'));
    manifestDirs.push(emptyManifestDir);

    const result = await continueOnDesk(input(wt, emptyManifestDir));
    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'no-question');
    assert.equal(fs.readdirSync(emptyManifestDir).length, 0);
  });

  it('leaves no manifest when a route-level refusal follows the write verdict', async () => {
    // `continueTarget` answers `write` — the ending record routes this branch
    // — but the route's own `no-worker-command` refusal is asked first, before
    // the rule is even consulted. A write verdict the route never reaches must
    // still leave nothing behind.
    const wt = worktree();
    dirs.push(wt);
    writeBlockedEnding(wt, BRANCH);
    const emptyManifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-ending-no-worker-cmd-'));
    manifestDirs.push(emptyManifestDir);

    const result = await continueOnDesk({
      ...input(wt, emptyManifestDir),
      readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? '' : fallback),
    });
    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'no-worker-command');
    assert.equal(fs.readdirSync(emptyManifestDir).length, 0);
    assert.equal(fs.existsSync(path.join(wt, CONTINUATION_NAME)), false);
  });
});

describe('refusing a live loop — #1294, a second loop on one desk', () => {
  /** A real, short-lived process this test controls — never an invented pid. */
  const liveProcesses: number[] = [];

  function startRealProcess(): number {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    const pid = child.pid;
    assert.ok(pid !== undefined, 'the fixture itself must spawn successfully');
    liveProcesses.push(pid);
    return pid;
  }

  afterEach(() => {
    while (liveProcesses.length) {
      const pid = liveProcesses.pop()!;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  });

  const input = (wt: string, dir: string) => ({
    opts: { ...opts, manifestDir: dir },
    readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'true' : fallback),
    branch: BRANCH,
    worktree: wt,
    main: 'main',
    previousPid: '424242',
    answer: 'the composed answer',
  });

  /** A manifest naming `wt`, with `pid`/`wrapperPid` set as given — `''` to omit. */
  function manifestWithLoopPids(wt: string, fields: { pid?: string; wrapperPid?: string }): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-loop-alive-'));
    manifestDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, 'sess.json'),
      JSON.stringify({
        session: 'sess',
        branch: BRANCH,
        worktree: wt,
        pid: fields.pid ?? '',
        wrapperPid: fields.wrapperPid ?? '',
      }),
    );
    return dir;
  }

  it('refuses with the pid file, before any write to the desk', async () => {
    const livePid = startRealProcess();
    const wt = worktree({ pid: String(livePid) });
    dirs.push(wt);
    const dir = manifestWithLoopPids(wt, {});
    const manifestFile = path.join(dir, 'sess.json');
    const manifestBefore = fs.readFileSync(manifestFile, 'utf8');
    const logBefore = fs.readFileSync(path.join(wt, '.plot-worker.log'), 'utf8');

    const result = await continueOnDesk(input(wt, dir));

    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'loop-alive');
    assert.ok(
      result.kind === 'refused' && result.detail.includes(String(livePid)),
      'the refusal names the live pid',
    );
    assert.ok(
      result.kind === 'refused' && result.detail.includes('.plot-worker.pid'),
      'and the source it came from',
    );
    // EXACTLY ONE PROCESS HOLDS THE DESK — a refusal that still spawned a
    // second loop would be worse than no refusal at all.
    assert.doesNotThrow(() => process.kill(livePid, 0), 'the original loop is still the only one alive');
    assert.equal(fs.existsSync(path.join(wt, CONTINUATION_NAME)), false, 'no prompt was written');
    assert.equal(fs.readFileSync(path.join(wt, '.plot-worker.log'), 'utf8'), logBefore, 'the log is untouched');
    assert.equal(fs.readFileSync(manifestFile, 'utf8'), manifestBefore, 'the manifest is untouched');
  });

  it('refuses on the manifest pid alone', async () => {
    const livePid = startRealProcess();
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);
    const dir = manifestWithLoopPids(wt, { pid: String(livePid) });

    const result = await continueOnDesk(input(wt, dir));

    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'loop-alive');
    assert.ok(result.kind === 'refused' && result.detail.includes('manifest pid'));
  });

  it('refuses on the manifest wrapperPid alone', async () => {
    const livePid = startRealProcess();
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);
    const dir = manifestWithLoopPids(wt, { wrapperPid: String(livePid) });

    const result = await continueOnDesk(input(wt, dir));

    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'loop-alive');
    assert.ok(result.kind === 'refused' && result.detail.includes('manifest wrapperPid'));
  });

  it('continues when every recorded pid is dead', async () => {
    // '424242' is too large to be a real pid on this machine (confirmed: `ps`
    // itself refuses it), and the manifest's two fields are blank — the normal
    // shape for a desk nothing has stamped as a loop yet.
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);
    const dir = manifestWithLoopPids(wt, {});

    const result = await continueOnDesk(input(wt, dir));

    assert.equal(result.kind, 'started');
    spawned.add(wt);
  });

  it('does not call beforeStart for a desk whose loop is alive', async () => {
    const livePid = startRealProcess();
    const wt = worktree({ pid: String(livePid) });
    dirs.push(wt);
    const dir = manifestWithLoopPids(wt, {});
    let asked = 0;

    const result = await continueOnDesk({
      ...input(wt, dir),
      beforeStart: async () => {
        asked += 1;
        return true;
      },
    });

    assert.equal(asked, 0);
    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'loop-alive');
  });
});

describe('a free-waiting loop is stopped, then the continuation starts — #1373', () => {
  const liveProcesses: number[] = [];

  function startRealProcess(): number {
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    const pid = child.pid;
    assert.ok(pid !== undefined, 'the fixture itself must spawn successfully');
    liveProcesses.push(pid);
    return pid;
  }

  afterEach(() => {
    while (liveProcesses.length) {
      const pid = liveProcesses.pop()!;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  });

  const input = (wt: string, dir: string) => ({
    opts: { ...opts, manifestDir: dir },
    readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'true' : fallback),
    branch: BRANCH,
    worktree: wt,
    main: 'main',
    previousPid: '424242',
    answer: 'the composed answer',
  });

  /** A manifest naming `wt`, with `pid` set as given. */
  function manifestWithPid(wt: string, pid: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-freewait-'));
    manifestDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, 'sess.json'),
      // PRETTY-PRINTED, matching `stampManifest`'s `PID_LINE` regex, which
      // looks for the two-space-indented `"pid": "...",` shape — a compact
      // `JSON.stringify` has no line the stamp can find, so it would silently
      // no-op rather than ever touching the file.
      `${JSON.stringify({ session: 'sess', branch: BRANCH, worktree: wt, pid, wrapperPid: '' }, null, 2)}\n`,
    );
    return dir;
  }

  it('is still refused loop-alive, and left running, when it reports no free wait — mid-turn', async () => {
    const livePid = startRealProcess();
    const wt = worktree({ pid: String(livePid) });
    dirs.push(wt);
    const dir = manifestWithPid(wt, String(livePid));
    // NO `.plot-worker.freewait` written — the mid-turn case.

    const result = await continueOnDesk(input(wt, dir));

    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'loop-alive');
    assert.doesNotThrow(() => process.kill(livePid, 0), 'a mid-turn loop is never signalled, let alone stopped');
  });

  it('is refused loop-alive, and left running, when a DIFFERENT pid holds the free-wait record', async () => {
    const livePid = startRealProcess();
    const wt = worktree({ pid: String(livePid) });
    dirs.push(wt);
    const dir = manifestWithPid(wt, String(livePid));
    fs.writeFileSync(path.join(wt, '.plot-worker.freewait'), '999999\n');

    const result = await continueOnDesk(input(wt, dir));

    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'loop-alive');
    assert.doesNotThrow(() => process.kill(livePid, 0), 'a free wait recorded for a different pid licenses no stop here');
  });

  it('stops the pid, waits for it to exit, then starts — the manifest it stamps still names the desk', async () => {
    const livePid = startRealProcess();
    const wt = worktree({ pid: String(livePid) });
    dirs.push(wt);
    const dir = manifestWithPid(wt, String(livePid));
    const manifestFile = path.join(dir, 'sess.json');
    const manifestBeforeStop = fs.readFileSync(manifestFile, 'utf8');
    fs.writeFileSync(path.join(wt, '.plot-worker.freewait'), `${livePid}\n`);

    let manifestUnchangedDuringStop = false;
    const result = await continueOnDesk({
      ...input(wt, dir),
      // `sleep 2` outlives this test's own assertions, matching the #1307
      // fixture's own reason for the same choice: a command that exits
      // immediately races the manifest stamp against its own disappearance.
      readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'sleep 2' : fallback),
      stopLoop: async (pid) => {
        assert.equal(pid, String(livePid), 'only the pid the reading named is ever signalled');
        process.kill(Number(pid), 'SIGKILL');
        manifestUnchangedDuringStop = fs.readFileSync(manifestFile, 'utf8') === manifestBeforeStop;
        return { ok: true };
      },
    });

    assert.equal(result.kind, 'started');
    spawned.add(wt);
    assert.ok(manifestUnchangedDuringStop, 'the stop ran before the manifest was stamped with the new pid');
    assert.throws(() => process.kill(livePid, 0), 'the old loop is gone after the stop');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    assert.equal(manifest.pid, result.kind === 'started' ? result.pid : '', 'the manifest now names the NEW pid');
    const found = deskManifestFor('/tmp', wt, { manifestDir: dir });
    assert.equal(found.kind, 'named', 'deskManifestFor still answers named for this desk after the stop-and-restart');
  });

  it('does not stop the old loop when a later refusal fires — no-worker-command leaves it running, untouched', async () => {
    const livePid = startRealProcess();
    const wt = worktree({ pid: String(livePid) });
    dirs.push(wt);
    const dir = manifestWithPid(wt, String(livePid));
    fs.writeFileSync(path.join(wt, '.plot-worker.freewait'), `${livePid}\n`);
    let stopCalled = false;

    const result = await continueOnDesk({
      ...input(wt, dir),
      readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? '' : fallback),
      stopLoop: async () => {
        stopCalled = true;
        return { ok: true };
      },
    });

    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'no-worker-command');
    assert.equal(stopCalled, false, 'a refusal that fires before continueTarget is ever asked must not stop anything');
    assert.doesNotThrow(() => process.kill(livePid, 0), 'the old loop is still running — the refusal did not touch it');
    assert.equal(fs.existsSync(path.join(wt, CONTINUATION_NAME)), false);
  });
});

describe('a stopped loop that removes its own manifest — #1376 review', () => {
  // A FAKE LOOP WITH THE REAL LOOP'S `SIGTERM` CLEANUP: `worker-loop.ts`'s
  // `leaveNow` removes `PLOT_MANIFEST_FILE` before the process exits, and that
  // file is the manifest `continueOnDesk` stamps. No `stopLoop` is injected,
  // so the production stop sends the signal and the handler runs.
  const loops: number[] = [];

  afterEach(() => {
    while (loops.length) {
      const pid = loops.pop()!;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  });

  const startFakeLoop = async (manifestFile: string, ready: string): Promise<number> => {
    const script = [
      "const fs = require('node:fs');",
      'const [manifest, ready] = process.argv.slice(1);',
      "process.once('SIGTERM', () => { fs.rmSync(manifest, { force: true }); process.exit(143); });",
      'fs.writeFileSync(ready, String(process.pid));',
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const child = spawn(process.execPath, ['-e', script, manifestFile, ready], { stdio: 'ignore' });
    assert.ok(child.pid !== undefined, 'the fake loop must spawn');
    loops.push(child.pid);
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(ready) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(fs.existsSync(ready), 'the fake loop installed its SIGTERM handler within 10s');
    return child.pid;
  };

  /** A desk whose loop waits free, and a pretty-printed manifest naming it. */
  const freeWaitingDesk = async (): Promise<{ wt: string; dir: string; file: string; pid: number }> => {
    const wt = worktree();
    dirs.push(wt);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-leaving-'));
    manifestDirs.push(dir);
    const file = path.join(dir, 'sess.json');
    const pid = await startFakeLoop(file, path.join(dir, 'ready'));
    fs.writeFileSync(
      file,
      `${JSON.stringify(
        {
          session: 'sess',
          resumeId: 'the-blocked-conversation',
          // A FREE LOOP'S MANIFEST NAMES NO BRANCH.
          branch: '',
          worktree: wt,
          pid: String(pid),
          wrapperPid: '',
          agentMonitorPid: '777777',
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(path.join(wt, '.plot-worker.pid'), String(pid));
    fs.writeFileSync(path.join(wt, '.plot-worker.freewait'), `${pid}\n`);
    return { wt, dir, file, pid };
  };

  it('POST /api/continue keeps the manifest and its resumeId after the stop', async () => {
    const { wt, dir, file, pid } = await freeWaitingDesk();
    const { res, out } = response();

    // The manifest records a made-up monitor pid, so no real monitor script may stop it.
    const monitors: DeskMonitors = { start: () => ({ ok: true, value: { agentMonitorPid: '' } }), stop: () => ({ ok: true, value: [] }) };
    await handleContinue(request({ branch: BRANCH, answer: 'go' }), res, { ...opts, manifestDir: dir }, { ...deps(wt, 'sleep 2'), monitors });
    if (out.status === 202) spawned.add(wt);

    assert.equal(out.status, 202, JSON.stringify(out.body));
    assert.throws(() => process.kill(pid, 0), 'the free-waiting loop is gone');
    assert.ok(fs.existsSync(file), 'the manifest the stopped loop removed is back');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(manifest.resumeId, 'the-blocked-conversation');
    assert.equal(manifest.branch, BRANCH, 'the free manifest names the asked branch');
    assert.equal(manifest.pid, (out.body as { pid: string }).pid, 'the manifest names the new run');
    assert.equal(deskManifestFor('/tmp', wt, { manifestDir: dir }).kind, 'named');
  });

  it('the loop started on a stopped free waiter reads the continuation on the asked branch', async () => {
    const { wt, dir, file } = await freeWaitingDesk();
    const monitors: DeskMonitors = { start: () => ({ ok: true, value: { agentMonitorPid: '' } }), stop: () => ({ ok: true, value: [] }) };
    const result = await continueOnDesk({
      opts: { ...opts, manifestDir: dir },
      readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'sleep 2' : fallback),
      branch: BRANCH,
      worktree: wt,
      main: 'main',
      previousPid: '',
      answer: 'go',
      monitors,
    });
    if (result.kind === 'started') spawned.add(wt);
    assert.equal(result.kind, 'started', JSON.stringify(result));

    const ports: WorkerLoopPorts = {
      trees: treesFixture({ branches: { [wt]: BRANCH } }),
      agents: agentsFixture(),
      desk: deskFixture(),
      refs: refsFixture(),
      processes: {} as WorkerLoopPorts['processes'],
      boundedRun: { run: async () => ({ ok: false, why: 'failed' }) },
      refusedSlices: refusedSlicesFixture(),
      build: buildFixture(),
      host: hostFixture(),
      transcriptQuietSeconds: async () => 'unavailable',
      recordSpend: async () => undefined,
      recordRun: async () => null,
      recordLimits: async () => 0,
      sliceCostUsd: async () => null,
    };
    const config = { boundSeconds: 28_800, maxStartRetries: 3, checksWaitSeconds: 1_800, correctionBudget: 2, sliceMaxRuns: 12, sliceMaxSpendUsd: null, base: 'origin/main' };
    const readings = await readPass(ports, file, { running: null, exit: null, pushedSha: '' }, config, { since: null });

    assert.equal(readings.assignedBranch, BRANCH);
    assert.equal(readings.deskBranch, BRANCH);
    assert.equal(readings.continuation?.resumeId, 'the-blocked-conversation');
    assert.equal(readings.continuation?.text, fs.readFileSync(path.join(wt, CONTINUATION_NAME), 'utf8'));
  });

  it('a fresh start (the registry tick) replaces the resumeId and stops the old monitor', async () => {
    const { wt, dir, file } = await freeWaitingDesk();
    const stopped: string[][] = [];
    const monitors: DeskMonitors = {
      start: () => ({ ok: true, value: { agentMonitorPid: '' } }),
      stop: (pids) => {
        stopped.push([...pids]);
        return { ok: true, value: [] };
      },
    };

    const result = await continueOnDesk({
      opts: { ...opts, manifestDir: dir },
      readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'sleep 2' : fallback),
      branch: BRANCH,
      worktree: wt,
      main: 'main',
      previousPid: '',
      answer: 'the composed answer',
      fresh: true,
      monitors,
    });
    if (result.kind === 'started') spawned.add(wt);

    assert.equal(result.kind, 'started', JSON.stringify(result));
    const resumeId = JSON.parse(fs.readFileSync(file, 'utf8')).resumeId as string;
    assert.notEqual(resumeId, 'the-blocked-conversation');
    assert.match(resumeId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(stopped, [['777777']], 'the monitor the old manifest recorded is stopped');
  });

  it('refuses loop-alive, and sends no signal, when the free wait ended before the stop', async () => {
    const { wt, dir, pid } = await freeWaitingDesk();
    const result = await continueOnDesk({
      opts: { ...opts, manifestDir: dir },
      readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'true' : fallback),
      branch: BRANCH,
      worktree: wt,
      main: 'main',
      previousPid: '',
      answer: 'the composed answer',
      // The loop takes up a turn between the reading and the stop.
      beforeStart: async () => {
        fs.rmSync(path.join(wt, '.plot-worker.freewait'));
        return true;
      },
    });

    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'loop-alive');
    assert.doesNotThrow(() => process.kill(pid, 0), 'a loop that left its free wait is never signalled');
  });

  it('stopAndAwaitExit gives up past its deadline, naming the pid', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-stubborn-'));
    manifestDirs.push(dir);
    const ready = path.join(dir, 'ready');
    const script = "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], ''); setInterval(() => {}, 1000);";
    const child = spawn(process.execPath, ['-e', script, ready], { stdio: 'ignore' });
    assert.ok(child.pid !== undefined);
    loops.push(child.pid);
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));

    const result = await stopAndAwaitExit(String(child.pid), 20, 300);

    assert.deepEqual(result, { ok: false, why: `pid ${child.pid} did not exit within 300 ms of SIGTERM` });
    assert.doesNotThrow(() => process.kill(child.pid!, 0), 'the stubborn process still runs');
  });

  it('stopAndAwaitExit answers ok for a pid that is already gone', async () => {
    const child = spawn('true', [], { stdio: 'ignore' });
    await new Promise((r) => child.once('exit', r));
    assert.deepEqual(await stopAndAwaitExit(String(child.pid)), { ok: true });
  });

  it('refuses loop-alive, naming the pid, when the stop does not end the loop', async () => {
    const { wt, dir, file, pid } = await freeWaitingDesk();
    const result = await continueOnDesk({
      opts: { ...opts, manifestDir: dir },
      readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'true' : fallback),
      branch: BRANCH,
      worktree: wt,
      main: 'main',
      previousPid: '',
      answer: 'the composed answer',
      stopLoop: async (p) => ({ ok: false, why: `pid ${p} did not exit within 10s of SIGTERM` }),
    });

    assert.equal(result.kind, 'refused');
    assert.equal(result.kind === 'refused' ? result.reason : '', 'loop-alive');
    assert.match(result.kind === 'refused' ? result.detail : '', new RegExp(`pid ${pid}`));
    assert.ok(fs.existsSync(file), 'a refused stop writes nothing');
    assert.equal(fs.existsSync(path.join(wt, CONTINUATION_NAME)), false);
  });
});

describe('the continued loop escapes the board\'s process tree — #1307', () => {
  function ppidOf(pid: string): string {
    return execFileSync('ps', ['-o', 'ppid=', '-p', pid], { encoding: 'utf8' }).trim();
  }

  /** A manifest directory naming `wt`, with the resume id the loop would read. */
  function resumableManifestDir(wt: string): { dir: string; file: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-reparent-'));
    manifestDirs.push(dir);
    const file = path.join(dir, 'sess.json');
    fs.writeFileSync(
      file,
      `${JSON.stringify(
        { session: 'sess', branch: BRANCH, worktree: wt, pid: '424242', resumeId: 'the-spent-session' },
        null,
        2,
      )}\n`,
    );
    return { dir, file };
  }

  const input = (wt: string, dir: string) => ({
    opts: { ...opts, manifestDir: dir },
    readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? fallback : fallback),
    branch: BRANCH,
    worktree: wt,
    main: 'main',
    previousPid: '424242',
    answer: 'the composed answer',
  });

  it('starts a loop whose ppid is 1, not this process', async () => {
    const wt = worktree();
    dirs.push(wt);
    const { dir, file } = resumableManifestDir(wt);

    const result = await continueOnDesk({
      ...input(wt, dir),
      readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'sleep 2' : fallback),
    });
    assert.equal(result.kind, 'started');
    spawned.add(wt);
    const pid = result.kind === 'started' ? result.pid : '';

    assert.equal(ppidOf(pid), '1', 'the loop is adopted by init, not left under this process');

    // THE SAME NUMBER EVERYWHERE: the reply, the pid file and the manifest all
    // name the grandchild — never the intermediate shell, which has exited.
    assert.equal(fs.readFileSync(path.join(wt, '.plot-worker.pid'), 'utf8').trim(), pid);
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(manifest.pid, pid);
  });

  it('leaves the exit file holding a non-zero exit code', async () => {
    const wt = worktree();
    dirs.push(wt);
    const { dir } = resumableManifestDir(wt);

    const result = await continueOnDesk({
      ...input(wt, dir),
      readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'exit 3' : fallback),
    });
    assert.equal(result.kind, 'started');
    spawned.add(wt);

    const exit = path.join(wt, '.plot-worker.exit');
    const deadline = Date.now() + 5_000;
    while (!fs.existsSync(exit) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(fs.readFileSync(exit, 'utf8'), '3');
  });

  /**
   * `plot-boardctl.sh`'s `tree_pids` (`:173`) answers *every descendant of this
   * pid* from one `ps -eo pid=,ppid=` snapshot — reimplemented here rather than
   * shelling to the script, which is out of this branch's scope (see the
   * brief's Scope guard). The walk itself is the fixture under test in
   * `boardctl.test.mjs`; here it is the measuring stick applied to a stand-in
   * board, so a loop that is alive only because the TERM missed it by timing
   * cannot pass — it would still be IN the tree, just not yet signalled.
   */
  function descendants(root: string): Set<string> {
    const table = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/));
    const parentOf = new Map(table.map(([pid, ppid]) => [pid, ppid]));
    const found = new Set<string>();
    for (const [pid] of table) {
      let p = pid;
      for (let hop = 0; hop < 12 && p; hop++) {
        if (p === root) {
          found.add(pid);
          break;
        }
        p = parentOf.get(p) ?? '';
      }
    }
    return found;
  }

  it('survives a stop: a board TERMing its own tree does not reach the loop', async () => {
    const wt = worktree();
    dirs.push(wt);
    const { dir, file } = resumableManifestDir(wt);

    // THIS PROCESS IS THE BOARD: `registryd-main.ts` calls `continueOnDesk` in
    // the board's own process, not from a spawned stand-in — the route handler
    // runs in-process, same as here. So the board `tree_pids` walks from on a
    // real stop is THIS pid, and the question is whether the loop shows up
    // among its descendants once the spawn returns, the way it would with
    // `detached: true` alone (a same-session child, still under this pid in
    // the process table) and must not with the re-parenting fix (adopted by
    // init before `continueOnDesk` returns).
    const boardPid = String(process.pid);

    const result = await continueOnDesk({
      ...input(wt, dir),
      readCfg: (_o: unknown, key: string, fallback: string) => (key === 'Worker command' ? 'sleep 2' : fallback),
    });
    assert.equal(result.kind, 'started');
    spawned.add(wt);
    const pid = result.kind === 'started' ? result.pid : '';

    // THE WALK, NOT THE SIGNAL: `--stop` sends TERM down exactly this set.
    // Asserting on delivery would pass a loop still in the tree that simply
    // outran the signal — the timing failure the brief calls out by name.
    const tree = descendants(boardPid);
    assert.equal(tree.has(pid), false, `loop pid ${pid} must not be a descendant of the board (${boardPid})`);

    void file;
  });
});

describe('startFreshSession over the real registry, for a desk with no manifest', () => {
  const run = (wt: string, dir: string) =>
    startFreshSession(
      { branch: BRANCH, worktree: wt, answer: 'the composed answer', main: 'main', beforeStart: async () => true },
      {
        agents: agentsFs({ repoRoot: dir, scriptDir: dir }, { manifestDir: dir }),
        command: 'true',
        newSession: () => 'fresh-session-1',
        continueDesk: (i) =>
          continueOnDesk({
            ...i,
            readCfg: (_o, key, fallback) => (key === 'Worker command' ? 'true' : fallback),
          }),
        opts: { ...opts, manifestDir: dir },
      },
    );

  it('registers the agent so continue accepts the desk, and leaves the manifest naming it', async () => {
    const wt = worktree();
    dirs.push(wt);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fresh-registry-'));
    manifestDirs.push(dir);
    const result = await run(wt, dir);
    assert.equal(result.kind, 'started');
    spawned.add(wt);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'fresh-session-1.json'), 'utf8'));
    assert.equal(manifest.worktree, wt);
    assert.equal(manifest.branch, BRANCH);
    assert.notEqual(manifest.resumeId, 'fresh-session-1', 'the fresh start replaced the resume id');
  });

  it('leaves no manifest where continue refuses the desk', async () => {
    const wt = worktree({ marker: false });
    dirs.push(wt);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fresh-registry-'));
    manifestDirs.push(dir);
    const result = await run(wt, dir);
    assert.equal(result.kind, 'refused');
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

describe('the tick starts a fresh session on a desk whose ending asks for one, with no marker', () => {
  const PLAN = '2026-10-07-every-loop-ending-has-a-supervisor-rule';

  /** A marker-less desk whose loop ended `reason`, holding the uncommitted `a.ts`. */
  const endedDesk = (reason: string, refusedAssignment = ''): string => {
    const wt = worktree({ marker: false });
    dirs.push(wt);
    fs.writeFileSync(
      path.join(wt, ENDING_FILENAME),
      JSON.stringify({ reason, actor: 'agent', branch: BRANCH, detail: 'the loop ended', refusedAssignment }),
    );
    fs.writeFileSync(path.join(wt, 'a.ts'), 'export const held = 1;\n');
    return wt;
  };

  /** One tick over one desk: the real record, the real registry, the real continue. */
  const tickOver = async (wt: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fresh-tick-registry-'));
    manifestDirs.push(dir);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fresh-tick-home-'));
    manifestDirs.push(home);
    const record = freshAgentRecordFile({ home });
    const candidates = freshAgentCandidateTrees([
      { path: wt, branch: BRANCH, isMain: false, prunable: false, registered: false, planNamed: true, plan: PLAN, dirtyCount: 1 },
    ]);
    const readings = await readFreshAgentCandidates(
      candidates,
      (worktree, name) => {
        try {
          return fs.readFileSync(path.join(worktree, name), 'utf8');
        } catch {
          return null;
        }
      },
      record,
      async () => ['a.ts'],
      async () => false,
      {
        endingAt: async () => '2026-10-08T11:00:00.000Z',
        record: { asked: async () => ({ ok: true, value: false }) },
        prMerged: async () => 'not-merged',
      },
    );
    const applied = await applyFreshAgentDecisions(freshAgentDecisions(readings, 2), {
      record,
      asks: { append: async () => ({ ok: true, value: undefined }) },
      desk: { writeBlockedMarker: async () => ({ ok: true, value: undefined }) },
      now: () => new Date('2026-10-08T12:00:00.000Z'),
      start: ({ branch, worktree, answer, beforeStart }) =>
        startFreshSession(
          { branch, worktree, answer, main: 'main', beforeStart },
          {
            agents: agentsFs({ repoRoot: dir, scriptDir: dir }, { manifestDir: dir }),
            command: 'true',
            newSession: () => 'fresh-tick-1',
            continueDesk: (i) =>
              continueOnDesk({ ...i, readCfg: (_o, key, fallback) => (key === 'Worker command' ? 'true' : fallback) }),
            opts: { ...opts, manifestDir: dir },
          },
        ),
    });
    if (applied.some((a) => a.outcome === 'started')) spawned.add(wt);
    const rows = await record.rowsFor(PLAN, BRANCH);
    return { applied, rows: rows.ok ? rows.value : [] };
  };

  it('starts one session for an after-prompt holding-work desk, records it, and names the held file', async () => {
    const wt = endedDesk('holding-work');
    const { applied, rows } = await tickOver(wt);
    assert.deepEqual(applied.map((a) => a.outcome), ['started'], JSON.stringify(applied));
    assert.equal(rows.length, 1);
    const prompt = fs.readFileSync(path.join(wt, CONTINUATION_NAME), 'utf8');
    assert.match(prompt, /^- a\.ts$/m);
    assert.equal(fs.readFileSync(path.join(wt, 'a.ts'), 'utf8'), 'export const held = 1;\n', 'the held work is kept');
  });

  it('starts one session for a turn-limit desk and records it', async () => {
    const wt = endedDesk('turn-limit');
    const { applied, rows } = await tickOver(wt);
    assert.deepEqual(applied.map((a) => a.outcome), ['started'], JSON.stringify(applied));
    assert.equal(rows.length, 1);
    assert.match(fs.readFileSync(path.join(wt, CONTINUATION_NAME), 'utf8'), /Agent max turns/);
    assert.equal(fs.existsSync(path.join(wt, 'a.ts')), true, 'the held work is kept');
  });

  it('starts nothing and records nothing for a take-up holding-work desk', async () => {
    const wt = endedDesk('holding-work', 'feature/another-slice');
    const { applied, rows } = await tickOver(wt);
    assert.deepEqual(applied, []);
    assert.equal(rows.length, 0);
    assert.equal(fs.existsSync(path.join(wt, CONTINUATION_NAME)), false);
  });
});

describe('a fresh start takes its precondition from the ending, an answer from the marker', () => {
  const ended = (reason: string, branch = BRANCH, refusedAssignment = ''): string => {
    const wt = worktree({ marker: false });
    dirs.push(wt);
    fs.writeFileSync(
      path.join(wt, ENDING_FILENAME),
      JSON.stringify({ reason, actor: 'agent', branch, detail: '', refusedAssignment }),
    );
    return wt;
  };
  const call = (wt: string, fresh: boolean) =>
    continueOnDesk({
      opts: optsFor(wt),
      readCfg: (_o, key, fallback) => (key === 'Worker command' ? 'true' : fallback),
      branch: BRANCH,
      worktree: wt,
      main: 'main',
      previousPid: '',
      answer: 'go',
      fresh,
    });

  it('a non-fresh continue on a marker-less holding-work desk still refuses no-question', async () => {
    const result = await call(ended('holding-work'), false);
    assert.equal(result.kind === 'refused' && result.reason, 'no-question');
  });

  it('a fresh start refuses no-question where the ending names another branch', async () => {
    const result = await call(ended('holding-work', 'feature/elsewhere'), true);
    assert.equal(result.kind === 'refused' && result.reason, 'no-question');
  });

  it('a fresh start refuses no-question for an ending no fresh session answers', async () => {
    for (const reason of ['blocked', 'spend-limit', 'nothing-done']) {
      const result = await call(ended(reason), true);
      assert.equal(result.kind === 'refused' && result.reason, 'no-question', reason);
    }
  });

  it('a fresh start refuses no-question for a take-up holding-work ending', async () => {
    const result = await call(ended('holding-work', BRANCH, 'feature/another-slice'), true);
    assert.equal(result.kind === 'refused' && result.reason, 'no-question');
  });
});
