// Test harness: spin up the BUILT board artifact against a scratch repo and
// query GET /api/board. Testing the shipped artifact (not the TS source) means
// these tests exercise exactly what plot ships — server, zod contract, and the
// real plot-plan-meta.sh / plot-config.sh helpers.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/**
 * WHY `--test-concurrency=4` IN THE `test` SCRIPT.
 *
 * `node --test` runs FILES in parallel, defaulting to roughly one per core — 16
 * on the machine this was measured on. Several suites here start real HTTP
 * servers that run real `git` and real helper scripts, and two of them wait on
 * work with a deadline: `bridge.test.mjs` polls 80 × 250 ms for a fleet scan to
 * land on disk, and the scan is seconds of forks.
 *
 * Those deadlines are budgets against a machine, not against a file count, so
 * they silently get tighter every time a suite is added. Measured 2026-08-19:
 * adding three server-backed files took the run from green to eight failures
 * across `approve` and `bridge` — none of them logically broken, all of them
 * starved. The same files pass alone, which is what makes this look like
 * flakiness and is exactly why it is not: the loser of the race depends on
 * scheduling.
 *
 * Bounding concurrency fixes it structurally rather than per test. The
 * alternative — raising each deadline as the suite grows — makes a real
 * regression slower to surface every time, and asks every future author to
 * notice a budget they did not write.
 *
 * Raise this number only with a measurement, never to make a run finish sooner.
 */

export const REPO_ROOT = path.resolve(here, '../../..');
export const SCRIPTS_DIR = path.join(REPO_ROOT, 'skills/plot/scripts');
export const ARTIFACT = path.join(SCRIPTS_DIR, 'board/board-server.mjs');

/**
 * Start the built artifact with cwd = the scratch repo. PLOT_SCRIPTS_DIR points
 * the server at this repo's real helper scripts (the artifact ships next to
 * them in production, but in a scratch repo they live elsewhere).
 *
 * `PORT=0`: the OS assigns during the server's own `listen()`, so there is no
 * moment when a port is known-free but unbound. The predecessor of this helper
 * bound port 0, read the number, CLOSED, and handed it to this process to bind
 * later — a time-of-check-to-time-of-use race that CI, running test files in
 * parallel on one machine, lost often enough to gate a plan PR on a flake.
 *
 * The bound port comes back the way it always could have: the readiness line
 * this helper already waits on carries it.
 *
 * `PLOT_EXIT_WITH_PARENT`: the server polls its own `ppid` and exits once this
 * process is gone. The returned `kill` is still the normal path and still the
 * one every suite's `after()` uses — this covers the case where `after()` never
 * runs at all. Ctrl-C, a dying agent, a `SIGKILL` on the runner: no hook fires,
 * POSIX hands the child to PID 1, and it keeps polling forever. Measured on
 * 2026-08-17: two such orphans on random high ports, still answering
 * `/api/fleet` with 200, from a run eighteen seconds apart that never finished.
 * Cleanup-by-convention is a rule; this is the gate behind it.
 */
export function startServer(cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [ARTIFACT], {
      cwd,
      env: {
        ...process.env,
        PORT: '0',
        PLOT_SCRIPTS_DIR: SCRIPTS_DIR,
        PLOT_REPO_ROOT: cwd,
        PLOT_EXIT_WITH_PARENT: '1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr = [];
    let stdout = '';
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        proc.kill('SIGTERM');
        reject(new Error(`server did not start in 5s.\nstderr: ${stderr.join('')}`));
      }
    }, 5000);
    proc.stdout.on('data', (chunk) => {
      if (done) return;
      stdout += chunk.toString();
      const match = /http:\/\/localhost:(\d+)/.exec(stdout);
      if (!match) return;
      done = true;
      clearTimeout(timer);
      resolve({
        port: Number(match[1]),
        kill: () => proc.kill('SIGTERM'),
        /**
         * SIGTERM, and then WAIT for the process to be gone.
         *
         * `kill()` only sends the signal. A test that kills its server and
         * immediately `rmSync`s the directory the server is serving from is
         * racing it: on 2026-08-17 `discovery.test.mjs` failed three times in
         * CI with `ENOTEMPTY` on a `/tmp/plot-board-nested-…` checkout's `.git` —
         * `recursive: true` had listed the tree, and the still-living server's
         * git process created something inside it before the delete arrived.
         *
         * Never reproduced locally, reproduced every time on a loaded runner,
         * and filed as a flake in two briefs. It is not one: it is a race with
         * a loser that depends on scheduling.
         *
         * Resolves on `exit` rather than on a timer, so a fast machine pays
         * nothing and a slow one pays exactly what it needs.
         */
        stop: () => new Promise((done) => {
          if (proc.exitCode !== null || proc.signalCode !== null) return done();
          proc.once('exit', () => done());
          proc.kill('SIGTERM');
        }),
      });
    });
    proc.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
    proc.on('error', (err) => {
      clearTimeout(timer);
      if (!done) reject(err);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (!done) reject(new Error(`server exited (${code}) before ready.\nstderr: ${stderr.join('')}`));
    });
  });
}

/** GET an arbitrary path; resolve { status, body, headers } without parsing. */
export function fetchRaw(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:${port}${pathname}`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      })
      .on('error', reject);
  });
}

/**
 * Issue an arbitrary request (any verb, any headers, optional body) and resolve
 * { status, body, headers } without parsing. The 405 guard and the same-origin
 * check are both things only a non-GET, header-bearing request can exercise.
 */
export function request(port, { method = 'GET', path: pathname = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(body);
    const req = http.request(
      {
        // `localhost`, matching the other helpers: the server binds to whatever
        // HOST names, and on a dual-stack machine that resolves to ::1 — a
        // hardcoded 127.0.0.1 would be refused by a server listening on IPv6.
        host: 'localhost',
        port,
        path: pathname,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** The two scripts that ACT. Stubbed here; every other helper is the real one. */
const ACTING_SCRIPTS = ['plot-dispatch.sh', 'plot-approve.sh'];

/**
 * A stand-in scripts dir whose acting scripts only record that they ran.
 *
 * The tests must NEVER run a real dispatch: it would create a worktree beside
 * the temp repo and push a claim from CI. The stub is what makes "a refused
 * request spawned nothing" an assertion about a file that does or does not
 * exist, rather than a hope.
 *
 * `plot-approve.sh` is stubbed for a stronger version of the same reason. It is
 * what `/api/approve` now spawns where no `Approve command` is declared, and a
 * real run merges a plan PR on the git host — undoable only by more git. A
 * symlink to the real script would put that one `git rev-parse` away from CI.
 *
 * Every other helper the server needs is symlinked from the real scripts dir,
 * so the board still parses plans exactly as it ships.
 */
export function makeStubScripts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-stub-'));
  const marker = path.join(dir, 'dispatch-ran.txt');
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (ACTING_SCRIPTS.includes(name)) continue;
    fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(dir, name));
  }
  fs.writeFileSync(
    path.join(dir, 'plot-dispatch.sh'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(marker)}\necho "stub dispatch: $*"\n`,
    { mode: 0o755 },
  );
  // Echoes its own NAME as well as its arguments: the assertion that matters is
  // *which* of the two entrances ran, and a bare argument echo cannot say.
  fs.writeFileSync(
    path.join(dir, 'plot-approve.sh'),
    `#!/usr/bin/env bash\necho "stub plot-approve.sh $*"\n`,
    { mode: 0o755 },
  );
  return {
    dir,
    marker,
    /** How many times the stub ran. 0 is the assertion that matters most. */
    runs: () =>
      fs.existsSync(marker)
        ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean)
        : [],
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Give a scratch repo an `Approve command` pointing at a stub, and hand back a
 * reader for what that stub was asked to do.
 *
 * The tests must NEVER run a real approval: it merges a plan PR on the git
 * host, which is undoable only by more git. The stub is what makes "a refused
 * request approved nothing" an assertion about a file rather than a hope.
 *
 * `script` is the stub's body, defaulting to one that records its arguments and
 * exits 0. Pass one that writes to stderr and exits non-zero to exercise the
 * path the plan cares most about — a failure surfacing its OWN words.
 *
 * Re-callable: a repo can be given a different command mid-test, which is how
 * the slow-command case gets a stub that sleeps without a second repo.
 */
export function writeApproveCommand(repo, { script } = {}) {
  const bin = path.join(repo, 'approve-stub.sh');
  const marker = path.join(repo, 'approve-ran.txt');
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(marker)}\n${
      script ?? ''
    }`,
    { mode: 0o755 },
  );
  // The config the server reads. `plot-config.sh` looks for a `## Plot Config`
  // section in the repo-root CLAUDE.md, so the scratch repo gets a real one.
  const claude = path.join(repo, 'CLAUDE.md');
  const existing = fs.existsSync(claude) ? fs.readFileSync(claude, 'utf8') : '';
  if (!/^##\s*Plot Config/im.test(existing)) {
    fs.writeFileSync(claude, `${existing}\n## Plot Config\n\n- **Approve command:** ${bin}\n`, 'utf8');
  }
  return {
    bin,
    marker,
    /** What the stub was invoked with, one entry per run. [] is the assertion that matters most. */
    runs: () =>
      fs.existsSync(marker)
        ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean)
        : [],
  };
}

/** GET /api/board and parse the JSON body. */
export function fetchBoard(port) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://localhost:${port}/api/board`, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`bad JSON: ${data}`));
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * Scaffold a scratch repo.
 * @param {{
 *   plans?: Array<{ name: string, content: string }>,
 *   active?: string[],            // plan filenames to symlink into active/
 *   brokenActive?: string[],      // active/ symlinks pointing nowhere
 *   sprints?: Array<{ name: string, content: string }>,
 *   stories?: Array<{ dir: string, file: string, content: string }>,
 * }} spec
 */
export function makeRepo(spec = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-board-test-'));
  const plansDir = path.join(tmp, 'docs/plans');
  fs.mkdirSync(plansDir, { recursive: true });
  for (const p of spec.plans ?? []) {
    fs.writeFileSync(path.join(plansDir, p.name), p.content, 'utf8');
  }
  if ((spec.active ?? []).length || (spec.brokenActive ?? []).length) {
    const activeDir = path.join(plansDir, 'active');
    fs.mkdirSync(activeDir, { recursive: true });
    for (const name of spec.active ?? []) {
      fs.symlinkSync(path.join(plansDir, name), path.join(activeDir, name));
    }
    for (const name of spec.brokenActive ?? []) {
      fs.symlinkSync(path.join(plansDir, name), path.join(activeDir, name));
    }
  }
  for (const s of spec.sprints ?? []) {
    const dir = path.join(tmp, 'docs/sprints/active');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, s.name), s.content, 'utf8');
  }
  for (const s of spec.stories ?? []) {
    const dir = path.join(tmp, 'docs/stories', s.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, s.file), s.content, 'utf8');
  }
  return tmp;
}

/**
 * Run git in `cwd`, retrying only while `index.lock` is held.
 *
 * The suites that use this start a REAL board server against the very repo they
 * then mutate (`startServer(fixture.repo)`), and that server rescans the repo
 * every `REFRESH_MS`. Both sides want `.git/index.lock`, so on a loaded machine
 * the test's own `checkout`/`commit`/`push` loses the race and throws an error
 * that names git rather than the board. CI failed this way on a commit that
 * added one markdown file and nothing else — 37 ms into the run.
 *
 * The concurrency cannot be designed away: "picks up a plan pushed to a NEW
 * branch after the first read" asserts that the server sees changes in the repo
 * it is watching, so the server must be running and the repo must be mutated.
 *
 * Contention is transient by definition — the holder finishes in milliseconds —
 * so a bounded retry turns a spurious failure into a marginally slower test.
 *
 * Keyed on the lock message SPECIFICALLY. A blanket retry would paper over real
 * git errors and turn a deterministic failure into a slow flaky one, which is
 * the opposite of the goal: a broken test must still fail on its first attempt.
 *
 * This mirrors what `plot-fleet-scan.sh` already does in production, where an
 * `index.lock` reads as "an agent is writing HERE, RIGHT NOW" — a state to
 * handle, not an error to propagate. The asymmetry between the production code
 * and its own harness was the bug.
 */
const HELD_BY_ANOTHER_GIT = /index\.lock/;

export function git(cwd, { retries = 10, delayMs = 25 } = {}) {
  return (...args) => {
    // Defaults give ~250 ms of patience: ten ticks of 25 ms. Long enough for a
    // scan holding the index to finish, short enough that a genuinely stuck
    // lock fails the test rather than stalling the suite.
    for (let attempt = 0; ; attempt++) {
      try {
        return execFileSync('git', args, {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        // ONLY `index.lock`, and only for a bounded number of attempts.
        //
        // Both halves are load-bearing. A blanket retry would turn a real,
        // deterministic git failure into a slow flaky one — the exact defect
        // this helper exists to remove, wearing the fix as a costume. And an
        // unbounded one would hang the suite on a lock that never clears.
        //
        // `stderr` AND `message` are both consulted: stderr is where git puts
        // it under the stdio this helper passes today, and message is what
        // survives if a future caller changes that. Matching one field would
        // make the guard silently conditional on a detail two lines above it.
        const text = `${err?.stderr ?? ''}${err?.message ?? ''}`;
        if (attempt >= retries || !HELD_BY_ANOTHER_GIT.test(text)) throw err;
        // Synchronous by necessity — every caller uses this helper
        // synchronously during fixture setup, so there is no `await` to reach
        // for. Contention resolves in milliseconds, so a fixed delay beats a
        // backoff: the worst case stays bounded at retries * delayMs
        // and the common case pays one tick.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
      }
    }
  };
}

/**
 * Delete a fixture tree, retrying only while a dying process still writes into
 * it.
 *
 * `after()` hooks await `server.stop()`, but that resolves when the SERVER
 * exits — not when the `git` children it spawned mid-scan do. A grandchild is
 * outside the scope of the SIGTERM sent to its parent, so it can still create
 * `.git/index.lock` or an object file a few milliseconds after the server is
 * gone. `rmSync` walks a directory, deletes what it saw, then `rmdir`s the
 * parent; a file appearing between those two steps fails the `rmdir` with
 * ENOTEMPTY. CI failed exactly this way on `outer/.git`.
 *
 * `force: true` does not cover this. It suppresses "no such file" — the
 * absence of something expected — while this is the presence of something
 * unexpected, the opposite failure.
 *
 * This is the same reasoning as `git` above, applied to the other half of the
 * fixture's life: contention with a doomed process is transient by definition,
 * so a bounded retry converts a spurious teardown failure into a marginally
 * slower one. Awaiting the server was the previous attempt at this and did not
 * hold, because it addressed the process that was waited for rather than the
 * ones that were not.
 *
 * Bounded and specific for the same reason the git retry is: ENOTEMPTY/EBUSY
 * clear on their own, and any other error means the fixture is wrong in a way
 * patience cannot fix, so it must surface on the first attempt.
 */
const STILL_BEING_WRITTEN = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM']);

export function rmTree(target, { retries = 10, delayMs = 25 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt >= retries || !STILL_BEING_WRITTEN.has(err?.code)) throw err;
      // Synchronous, to stay a drop-in for the `fs.rmSync` calls it replaces:
      // `after()` hooks are not all async, and making them so to accommodate a
      // cleanup helper would spread this detail across every suite.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}
