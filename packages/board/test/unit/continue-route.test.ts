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
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { writeGate } from '../../src/server/write-gate.js';
import {
  CONTINUATION_ENV,
  CONTINUATION_NAME,
  handleContinue,
  type ContinueRefusal,
} from '../../src/server/continue.js';
import type { ContinueDeps } from '../../src/server/continue.js';
import type { FleetPulse } from '../../src/contract/schema.js';

const BRANCH = 'feature/continue-with-an-answer';

/** A worktree with a git repo, a marker, a brief and a previous run's records. */
function worktree(opts: { marker?: boolean; pid?: string } = {}): string {
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
  return dir;
}

function pulseWith(wt: string): FleetPulse {
  return {
    main: 'main',
    head: 'abc',
    fetch_failed: false,
    plans: [
      {
        file: 'docs/plans/p.md',
        phase: 'Approved',
        waves: [
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
  } as unknown as FleetPulse;
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
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

async function post(body: unknown, d: ContinueDeps) {
  const { res, out } = response();
  await handleContinue(request(body), res, opts, d);
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

    const out = await post({ branch: BRANCH, answer: 'use the existing endpoint' }, deps(wt));
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
    await post({ branch: BRANCH, answer: 'go' }, deps(wt, 'sleep 2'));
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
    await post({ branch: BRANCH, answer: 'go' }, deps(wt));
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
    while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
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
    // The marker must exist again for the second continuation to be accepted.
    fs.writeFileSync(path.join(wt, 'QUESTION.md'), 'PLOT-BLOCKED: and again?');
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

  it('does not fail the continuation when no manifest names the worktree', async () => {
    // The manifest is a best-effort display fact. A worktree dispatched before
    // manifests existed has none, and continuing it must still start a worker
    // rather than 500 on a missing file.
    const wt = worktree({ pid: '424242' });
    dirs.push(wt);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-nomani-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, '.plot', 'agents'), { recursive: true });
    const out = await postTo(root, { branch: BRANCH, answer: 'go' }, deps(wt));
    assert.equal(out.status, 202, 'a missing manifest is not a failure');
  });
});

/** A pulse whose worker_pid is the given previous pid — for the second relaunch. */
function pulseWith2(wt: string, previousPid: string): FleetPulse {
  return {
    main: 'main',
    head: 'abc',
    fetch_failed: false,
    plans: [
      {
        file: 'docs/plans/p.md',
        phase: 'Approved',
        waves: [
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
  } as unknown as FleetPulse;
}

describe('the prompt that reaches the worker', () => {
  it('is written into the worktree and named in the reply', async () => {
    const wt = worktree();
    dirs.push(wt);
    const out = await post({ branch: BRANCH, answer: 'use the existing endpoint' }, deps(wt));
    const body = out.body as { prompt: string };
    assert.equal(body.prompt, path.join(wt, CONTINUATION_NAME));
    assert.ok(fs.existsSync(body.prompt), 'the prompt must exist before the worker starts');
  });

  it('carries the brief, the answer and what landed — and no transcript', async () => {
    // The wave's central assertion, made against the FILE the worker will
    // actually read rather than against the composer alone.
    const wt = worktree();
    dirs.push(wt);
    await post({ branch: BRANCH, answer: 'use the existing endpoint, do not add a second' }, deps(wt));
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
    await post({ branch: BRANCH, answer: 'go' }, deps(wt));
    const bytes = fs.statSync(path.join(wt, CONTINUATION_NAME)).size;
    assert.ok(bytes < 32_000, `prompt was ${bytes} bytes`);
  });
});

describe('what cannot be continued is refused, never spawned', () => {
  const refusal = (out: { status: number; body: unknown }) =>
    (out.body as { reason: ContinueRefusal }).reason;

  it('refuses a branch the board has never heard of', async () => {
    const out = await post({ branch: 'feature/nothing', answer: 'go' }, deps(null));
    assert.equal(out.status, 404);
    assert.equal(refusal(out), 'unknown-branch');
  });

  it('refuses a branch this machine holds no worktree for', async () => {
    // A different statement from the one above, and it sends the reader
    // somewhere else: ask the machine that has it.
    const out = await post({ branch: BRANCH, answer: 'go' }, deps(''));
    assert.equal(out.status, 404);
    assert.equal(refusal(out), 'no-worktree');
  });

  it('refuses a worktree with no unanswered question', async () => {
    // The precondition IS the state the control was offered for. Without it,
    // a click could start a second agent in a worktree that holds a live one.
    const wt = worktree({ marker: false });
    dirs.push(wt);
    const out = await post({ branch: BRANCH, answer: 'go' }, deps(wt));
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
    const out = await post({ branch: BRANCH, answer: 'go' }, deps(wt, ''));
    assert.equal(out.status, 409);
    assert.equal(refusal(out), 'no-worker-command');
  });

  it('refuses `Worker command: none` — a repo that starts them by hand', async () => {
    const wt = worktree();
    dirs.push(wt);
    const out = await post({ branch: BRANCH, answer: 'go' }, deps(wt, 'none'));
    assert.equal(refusal(out), 'no-worker-command');
  });

  it('gives each refusal its own reason', async () => {
    // Four distinct reasons, four different next moves. Collapsing any two into
    // one message is the defect the three-way answers elsewhere in this server
    // exist to prevent.
    const reasons: ContinueRefusal[] = [
      'unknown-branch',
      'no-worktree',
      'no-question',
      'no-worker-command',
    ];
    assert.equal(new Set(reasons).size, reasons.length);
  });

  it('refuses an empty answer rather than burning a run on nothing', async () => {
    const wt = worktree();
    dirs.push(wt);
    for (const answer of ['', '   ', '\n']) {
      const out = await post({ branch: BRANCH, answer }, deps(wt));
      assert.equal(out.status, 400);
    }
  });

  it('refuses an answer past its bound, naming the field', async () => {
    const wt = worktree();
    dirs.push(wt);
    const out = await post({ branch: BRANCH, answer: 'x'.repeat(9_000) }, deps(wt));
    assert.equal(out.status, 400);
    assert.ok(/answer/.test((out.body as { error: string }).error), 'the error names the answer');
  });

  it('refuses a request with no branch', async () => {
    assert.equal((await post({ answer: 'go' }, deps(null))).status, 400);
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
});
