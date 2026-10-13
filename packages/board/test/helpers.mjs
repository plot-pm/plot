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
import { removeTree } from './rm-tree.mjs';

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
 * Every process on the machine as `{ pid, ppid, pgid, stat }`, from one `ps`
 * listing. An unreadable listing reads as no processes.
 */
const processTable = () => {
  let listing = '';
  try {
    listing = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat='], { encoding: 'utf8' });
  } catch {
    return [];
  }
  return listing
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length >= 4 && Number(fields[0]) > 0)
    .map(([pid, ppid, pgid, stat]) => ({ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), stat }));
};

/** Every process in `table` descending from `root`. */
const descendantsOf = (root, table) => {
  const children = new Map();
  for (const { pid, ppid } of table) {
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const found = [];
  const queue = [root];
  while (queue.length) {
    for (const child of children.get(queue.shift()) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
};

/**
 * The process groups that members of `tree` lead.
 *
 * The server starts every script `detached`, so each script leads a group, and
 * every subshell and command it forks joins that group, including one forked
 * after `table` was read. A pid list misses that late child; its group does not.
 * Only a group that a tree member leads is named. The test runner's group is
 * led by an ancestor of the server, so it is never named.
 */
const ledGroups = (tree, table) =>
  tree.filter((pid) => table.some((row) => row.pid === pid && row.pgid === pid));

/** Send `signal` to `pid`, or to a group as `-pgid`; one already gone is the wanted state. */
const signalPid = (pid, signal) => {
  try { process.kill(pid, signal); } catch { /* already gone */ }
};

/**
 * Blocks until no process in `pids` and no process in a group of `groups` is
 * running, or for at most `ms`. Returns whether they are all gone.
 *
 * Synchronous, so `kill()` stays a drop-in for the after-hooks that do not
 * await it. A zombie counts as gone: the server is this process's child and
 * stays one until the event loop reaps it.
 */
const untilGoneSync = (pids, groups, ms = 5_000) => {
  const stop = Date.now() + ms;
  const running = () =>
    processTable().some(
      (row) => !row.stat.startsWith('Z') && (pids.includes(row.pid) || groups.includes(row.pgid)),
    );
  let alive = running();
  while (alive && Date.now() < stop) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    alive = running();
  }
  return !alive;
};

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
      // STOPPED FIRST, so the tree read is the whole tree: a stopped server
      // starts no child between the `ps` listing and its own death. Its TERM
      // stays pending until the CONT.
      //
      // THE GROUPS, NOT ONLY THE PIDS. The server is stopped, but its scripts
      // are not: `plot-host.sh pr-list` runs `$(pr_list_call gh …)`, whose
      // subshell forks the `gh` wrapper's subshell a few milliseconds later. A
      // listing taken between the two holds the outer subshell only. TERM ends
      // it at once, because a subshell does not keep the script's trap, and the
      // inner one runs on unsignalled and appends to `PLOT_BUDGET_HOME` after
      // the tree is removed. CI left `<repo>/.budget/budget.tsv` this way on
      // 2026-10-02 (#1205). The late child is in its script's group, so the
      // group is signalled and waited for.
      //
      // ONE TERM PER PROCESS. A group member is signalled through its group
      // only. `plot-tmp.sh`'s TERM trap opens with `trap - EXIT TERM`, so a
      // second TERM that lands while the trap runs kills the script before it
      // removes its registry and temp files. PR #1209's first CI run left
      // `plot-reg.*` and `plot-host-*` entries this way when every member got
      // the group TERM and then its own. SIGCONT follows, so a stopped member
      // acts on the TERM.
      const kill = () => {
        signalPid(proc.pid, 'SIGSTOP');
        const table = processTable();
        const tree = descendantsOf(proc.pid, table);
        const groups = ledGroups(tree, table);
        const ungrouped = tree.filter((pid) => !table.some((row) => row.pid === pid && groups.includes(row.pgid)));
        for (const pgid of groups) signalPid(-pgid, 'SIGTERM');
        for (const pid of ungrouped) signalPid(pid, 'SIGTERM');
        for (const pgid of groups) signalPid(-pgid, 'SIGCONT');
        signalPid(proc.pid, 'SIGTERM');
        signalPid(proc.pid, 'SIGCONT');
        if (untilGoneSync([proc.pid, ...tree], groups)) return;
        for (const pgid of groups) signalPid(-pgid, 'SIGKILL');
        for (const pid of tree) signalPid(pid, 'SIGKILL');
        untilGoneSync(tree, groups, 2_000);
      };
      resolve({
        port: Number(match[1]),
        // THE TREE, NOT ONLY THE SERVER. The server has no SIGTERM handler, so
        // the scripts it is running — a `plot-host.sh pr-list` waiting on `gh`,
        // a scan — are orphaned and keep their temp files until they finish,
        // which can be after the run's TMPDIR is gone. `kill` sends each of the
        // server's descendants SIGTERM, which their `plot-tmp.sh` traps clean
        // up on, and returns once the server and they have exited —
        // `plot-boardctl.sh --stop`'s rule. A server still alive after an
        // `rmTree` writes its agent logs and recreates the repo's box.
        kill,
        /**
         * SIGTERM, and then WAIT for the process to be gone.
         *
         * `kill()` returns once the server has exited, before the event loop
         * reaps it; `stop` resolves on that reap. A test that kills its server and
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
          kill();
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
export function request(port, { method = 'GET', path: pathname = '/', headers = {}, body, host = 'localhost' } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(body);
    const req = http.request(
      {
        // `localhost` by default, matching the other helpers — it resolves to
        // whichever family this machine prefers, which is what a browser does.
        //
        // OVERRIDABLE because `localhost` cannot tell the two apart, and that is
        // the whole subject of `port.test.mjs`'s dual-family cases: a request to
        // the name reaches whatever is bound and so passes against a server that
        // binds only one. Naming `127.0.0.1` or `::1` is the only way to assert
        // that BOTH answer.
        host,
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
  const implementMarker = path.join(dir, 'implement-ran.txt');
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
  // A stub implement command that records its arguments and exits 0 — the brief
  // gate added by wave 2 of a-dispatch-hands-over-a-brief. The dispatch now
  // calls `/plot-implement` FIRST and waits for it, so this stub is what lets
  // the dispatch tests pass without a real implement command.
  const implementBin = path.join(dir, 'stub-implement.sh');
  fs.writeFileSync(
    implementBin,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(implementMarker)}\necho "stub implement: $*"\n`,
    { mode: 0o755 },
  );
  // A SECOND implement stub that does NOT exit until a file is created, and it
  // exists because the fast one above cannot prove the response body honest.
  //
  // The 202 is written while the implement child is alive, and the child's exit
  // listener is what starts the dispatch. A stub that exits inside the same tick
  // lets that listener run before the assertion reads the response — so a test
  // using it passes against a body that reports facts only true AFTER the exit,
  // which is precisely the claim this branch removes. Blocking on a gate file
  // holds the child in the state the response actually describes, so the
  // assertion is taken against the world the caller sees.
  //
  // `release()` opens the gate; the child then exits 0 like the fast stub, so
  // teardown waits for a real exit rather than retrying an `rmSync`.
  const gate = path.join(dir, 'implement-gate.txt');
  const blockingImplementBin = path.join(dir, 'stub-implement-blocking.sh');
  fs.writeFileSync(
    blockingImplementBin,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(implementMarker)}\n` +
      `echo "stub implement (blocking): $*"\n` +
      `while [ ! -f ${JSON.stringify(gate)} ]; do sleep 0.05; done\n`,
    { mode: 0o755 },
  );
  return {
    dir,
    marker,
    /** The `Implement command` stub binary path — write this to the repo's CLAUDE.md. */
    implementBin,
    /** An `Implement command` stub that blocks until {@link release} is called. */
    blockingImplementBin,
    /** Let the blocking implement stub exit 0. */
    release: () => fs.writeFileSync(gate, 'go\n'),
    implementMarker,
    /** How many times the dispatch stub ran. 0 is the assertion that matters most. */
    runs: () =>
      fs.existsSync(marker)
        ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean)
        : [],
    /** How many times the implement stub ran. */
    implementRuns: () =>
      fs.existsSync(implementMarker)
        ? fs.readFileSync(implementMarker, 'utf8').split('\n').filter(Boolean)
        : [],
    /**
     * THROUGH `rmTree`, not `fs.rmSync`, and the difference is measured.
     *
     * This line failed `test:board` six times on 2026-08-31 with
     * `ENOTEMPTY` — from `port.test.mjs` and `write-gate.test.mjs`
     * alternately, always in an `after()` hook, so the output blamed a test
     * that had passed. A stub server's child outlives the SIGTERM sent to its
     * parent and can create a file between `rmSync`'s walk and its `rmdir`.
     *
     * `force: true` does not cover it: that suppresses the absence of
     * something expected, and this is the presence of something unexpected.
     * `rmTree` retries a bounded number of times on exactly the transient
     * codes and rethrows everything else on the first attempt, so a fixture
     * that is genuinely wrong still fails fast.
     *
     * The control, same tree and commit: `--test-concurrency=1` exits 0 while
     * the suite's own `=4` failed 5 of 5. Concurrency is the whole trigger.
     */
    cleanup: () => rmTree(dir),
  };
}

/**
 * Give a scratch repo an `Implement command` pointing at a stub.
 *
 * Required for dispatch tests after wave 2 of a-dispatch-hands-over-a-brief:
 * the dispatch now calls `/plot-implement` FIRST and waits for it, so a repo
 * without an `Implement command` refuses dispatch with 409.
 *
 * The stub exits 0 immediately and records its arguments — no brief is
 * actually created, but the dispatch proceeds.
 */
export function writeImplementCommand(repo, { bin }) {
  const claude = path.join(repo, 'CLAUDE.md');
  const existing = fs.existsSync(claude) ? fs.readFileSync(claude, 'utf8') : '';
  if (/^##\s*Plot Config/im.test(existing)) {
    // Append to the existing Plot Config section.
    const lines = existing.split('\n');
    const configIndex = lines.findIndex((l) => /^##\s*Plot Config/i.test(l));
    // Find the next heading after Plot Config, or the end.
    let insertAt = lines.length;
    for (let i = configIndex + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) {
        insertAt = i;
        break;
      }
    }
    lines.splice(insertAt, 0, `- **Implement command:** ${bin}`);
    fs.writeFileSync(claude, lines.join('\n'), 'utf8');
  } else {
    fs.writeFileSync(claude, `${existing}\n## Plot Config\n\n- **Implement command:** ${bin}\n`, 'utf8');
  }
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

/** Each {@link boxedDir} path, keyed to the box `mkdtempSync` returned for it. */
const repoBoxes = new Map();

/**
 * A path for a scratch repo, inside a temp box of its own.
 *
 * The board writes a repo's agent logs into the repo's PARENT (`agentLogDir`),
 * so a repo made directly in `os.tmpdir()` leaves them there. The path keeps
 * the box's basename and does not exist yet; `rmTree` on it removes the box.
 */
export const boxedDir = (prefix) => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dir = path.join(box, path.basename(box));
  repoBoxes.set(dir, box);
  return dir;
};

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
  const tmp = boxedDir('plot-board-test-');
  fs.mkdirSync(tmp);
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

/** Delete a fixture tree with `removeTree`; a `boxedDir` path goes with its box. */
export const rmTree = (target, options) => removeTree(repoBoxes.get(target) ?? target, options);

/**
 * The attribute a Slice row carries, and the two folds that hide it.
 *
 * ## Why these are constants
 *
 * A renamed attribute with an un-renamed selector produces a test that finds
 * nothing and passes: `querySelectorAll` returning an empty list is not an
 * error. Naming the selector once means the rename has one site per selector
 * rather than one per call, and a stale literal is a missing import rather
 * than a silent zero.
 *
 * `SLICE_FOLDS` is ordered and the order is load-bearing — see
 * {@link expandAgentFolds}.
 */
export const SLICE_ROW = '[data-slice-row]';
export const SLICE_FOLDS = ['[data-slice-toggle]', '[data-slice-branch-toggle]'];

/**
 * Open every fold on the Agents tab, plans first and then waves.
 *
 * ## Why this is shared rather than copied
 *
 * Seventeen integration files open `?tab=agents`; fifteen of them opened no
 * folds at all. That was harmless while rows arrived unfolded — and became 30s
 * of locator timeout per assertion once the wave kind landed, because a branch
 * row now arrives inside a wave inside a plan, shut twice over.
 *
 * Measured 2026-08-21 in CI: the suite stalled in
 * `stuck-row-alignment.browser.test.ts`, four tests at 30000ms each, and the
 * step hit its 15-minute bound having run no browser file to completion. The
 * same file with this helper: 4 passed in 2.19s. The tests were never wrong;
 * they were looking at rows nobody had opened.
 *
 * ORDER MATTERS. A wave's toggle does not exist in the DOM until the plan
 * holding it is open, so a single pass over both selectors misses every wave
 * under a folded plan.
 *
 * IDEMPOTENT, and silent where nothing folds: a group with one item renders no
 * expander and its rows are visible already.
 */
export async function expandAgentFolds(page) {
  for (const selector of SLICE_FOLDS) {
    const toggles = page.locator(selector);
    for (let i = 0; i < (await toggles.count()); i += 1) {
      const toggle = toggles.nth(i);
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    }
  }
}

/**
 * How many Slice rows the open page renders.
 *
 * ## Why a count, and not a match
 *
 * A selector that grips a renamed attribute matches nothing, and matching
 * nothing is not an error — `count()` returns 0 and every `toBe(0)` assertion
 * in the suite goes green. So the guard against a rename into silence cannot be
 * "the selector runs"; it has to be "a fixture known to render N rows still
 * yields N".
 *
 * Opens the folds first, because a Slice row under a shut plan is not in the
 * DOM and would count as zero for a reason that has nothing to do with the
 * selector.
 */
export async function countSliceRows(page) {
  await expandAgentFolds(page);
  return page.locator(SLICE_ROW).count();
}
