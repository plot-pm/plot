// A test board dies with the run that started it; an operator's board does not.
//
// Measured on 2026-08-17 at 02:00: four `board-server.mjs` processes, two of
// them on random high ports with **PID 1 as their parent** — orphans from test
// runs eighteen seconds apart, both still answering `/api/fleet` with 200 and
// still polling. The Agents tab reported `0 branches across 0 plans` during a
// five-agent run, which is what the accumulation costs.
//
// Every assertion here is a component of the last one: no `board-server.mjs`
// survives a killed run. The rest name the ways a plausible fix gets it wrong.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import {
  ARTIFACT,
  REPO_ROOT,
  SCRIPTS_DIR,
  makeRepo,
  rmTree,
} from './helpers.mjs';

const APPROVED = `# Ship the widget
## Status
- **Phase:** Approved
- **Type:** feature
`;

/**
 * A launcher: a node process that spawns the artifact exactly the way
 * `helpers.mjs` does and then does nothing, so it can be killed outright.
 *
 * Deliberately NOT `startServer`: these tests are about what happens when the
 * process that started the server is destroyed, and that requires an
 * intermediate process to destroy. It is spawned WITHOUT `detached: true` —
 * matching `helpers.mjs`, and matching the defect, where the survivors were
 * ordinary children that got orphaned rather than children cut loose on purpose.
 */
function startLauncher(cwd, env = {}) {
  const script = `
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, [${JSON.stringify(ARTIFACT)}], {
      cwd: ${JSON.stringify(cwd)},
      env: { ...process.env, ...${JSON.stringify(env)} },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c.toString();
      const m = /http:\\/\\/localhost:(\\d+)/.exec(out);
      if (m) process.stdout.write('READY ' + child.pid + ' ' + m[1] + '\\n');
    });
    // Never exits on its own: the TEST decides how this process dies.
    setInterval(() => {}, 1 << 30);
  `;
  const proc = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`launcher did not report a ready server in 10s: ${out}`));
    }, 10_000);
    proc.stdout.on('data', (c) => {
      out += c.toString();
      const m = /READY (\d+) (\d+)/.exec(out);
      if (!m) return;
      clearTimeout(timer);
      resolve({ launcher: proc, serverPid: Number(m[1]), port: Number(m[2]) });
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`launcher exited (${code}) before the server was ready: ${out}`));
    });
  });
}

/** Is this pid still a live process? */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll until `pid` is gone, or give up after `ms`. Resolves whether it went. */
async function waitForExit(pid, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !alive(pid);
}

/** Assert a pid is STILL alive after `ms` — the survival half of the contract. */
async function stillAliveAfter(pid, ms) {
  await new Promise((r) => setTimeout(r, ms));
  return alive(pid);
}

/** Kill a pid if it is still around, so a failing assertion leaks nothing. */
function reap(pid) {
  if (pid && alive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

describe('a test server exits when its launcher is killed', () => {
  let tmp, started;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    started = await startLauncher(tmp, {
      PORT: '0',
      PLOT_SCRIPTS_DIR: SCRIPTS_DIR,
      PLOT_REPO_ROOT: tmp,
      PLOT_EXIT_WITH_PARENT: '1',
    });
  });

  after(() => {
    reap(started?.serverPid);
    reap(started?.launcher?.pid);
    if (tmp) rmTree(tmp);
  });

  it('exits after the launcher is SIGKILLed', async () => {
    // SIGKILL, never SIGTERM. A handler-based cleanup passes the polite case
    // and leaves exactly the orphans this exists to remove: the launcher gets
    // no chance to run anything, which is the case that actually happened.
    assert.ok(alive(started.serverPid), 'the server was not running before the kill');
    started.launcher.kill('SIGKILL');
    const gone = await waitForExit(started.serverPid);
    assert.ok(gone, `server ${started.serverPid} survived its SIGKILLed launcher`);
  });
});

describe('the gate is PLOT_EXIT_WITH_PARENT and nothing else', () => {
  let tmp, started;

  before(async () => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
    // PORT=0 and PLOT_REPO_ROOT are BOTH set, and the new variable is not:
    // exactly the shape that a fix inferring from either would get wrong.
    started = await startLauncher(tmp, {
      PORT: '0',
      PLOT_SCRIPTS_DIR: SCRIPTS_DIR,
      PLOT_REPO_ROOT: tmp,
    });
  });

  after(() => {
    reap(started?.serverPid);
    reap(started?.launcher?.pid);
    if (tmp) rmTree(tmp);
  });

  it('a server without the variable keeps running when its launcher dies', async () => {
    // Both `PORT=0` and `PLOT_REPO_ROOT` are set on every server the harness
    // starts, and the operator's board has neither — so either could serve as
    // a tell, and neither should. `PLOT_REPO_ROOT` answers WHERE THE REPO IS
    // and `PORT=0` answers PICK A PORT FOR ME; deriving "die with your
    // launcher" from either would work by accident today and surprise whoever
    // sets them for their actual meaning tomorrow. One variable, one question.
    started.launcher.kill('SIGKILL');
    const survived = await stillAliveAfter(started.serverPid, 3000);
    assert.ok(
      survived,
      'a server started without PLOT_EXIT_WITH_PARENT exited anyway — the gate is being inferred',
    );
  });
});

describe("an operator's board is not killed by a parent that changes", () => {
  let tmp, supervisor, serverPid;

  before(() => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
  });

  after(() => {
    reap(serverPid);
    reap(supervisor?.pid);
    if (tmp) rmTree(tmp);
  });

  it('survives its shell going away, the way `pnpm board` must', async () => {
    // The regression that matters most, and the reason the gate cannot be the
    // ppid change itself. The operator's board runs under `node --watch`, whose
    // supervisor REPLACES its child on every restart — so "my parent changed,
    // therefore exit" is true for the operator's board too, and it would be the
    // one that dies. A board in a terminal the operator then closes is likewise
    // meant to keep running.
    //
    // Modelled with the same shape: a launcher that starts the board WITHOUT
    // the variable and is then destroyed. The board must not notice.
    const started = await startLauncher(tmp, {
      PORT: '0',
      PLOT_SCRIPTS_DIR: SCRIPTS_DIR,
      PLOT_REPO_ROOT: tmp,
    });
    supervisor = started.launcher;
    serverPid = started.serverPid;
    supervisor.kill('SIGKILL');
    // Long enough for several poll intervals to have run and decided nothing.
    const survived = await stillAliveAfter(serverPid, 3000);
    assert.ok(survived, "an operator's board died when its parent went away");
  });
});

describe('no orphan survives a killed test run', () => {
  let tmp;

  before(() => {
    tmp = makeRepo({ plans: [{ name: '2026-08-16-ship-the-widget.md', content: APPROVED }] });
  });

  after(() => {
    if (tmp) rmTree(tmp);
  });

  it('a suite killed mid-run leaves no board-server.mjs behind', async () => {
    // The end-to-end form, and the actual defect: every other assertion in this
    // file is a component of it. A runner that starts servers through the real
    // `startServer` and is then SIGKILLed — no `after()` hook fires, which is
    // precisely why the orphans existed.
    const runner = `
      import { startServer, makeRepo } from ${JSON.stringify(
        path.join(REPO_ROOT, 'packages/board/test/helpers.mjs'),
      )};
      const repo = makeRepo({ plans: [{ name: 'p.md', content: ${JSON.stringify(APPROVED)} }] });
      const a = await startServer(repo);
      const b = await startServer(repo);
      process.stdout.write('SERVERS ' + a.port + ' ' + b.port + '\\n');
      setInterval(() => {}, 1 << 30);
    `;
    const proc = spawn(process.execPath, ['--input-type=module', '-e', runner], {
      cwd: tmp,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ports;
    try {
      ports = await new Promise((resolve, reject) => {
        let out = '';
        let err = '';
        const timer = setTimeout(
          () => reject(new Error(`runner never started its servers in 15s: ${out}${err}`)),
          15_000,
        );
        proc.stdout.on('data', (c) => {
          out += c.toString();
          const m = /SERVERS (\d+) (\d+)/.exec(out);
          if (!m) return;
          clearTimeout(timer);
          resolve([Number(m[1]), Number(m[2])]);
        });
        proc.stderr.on('data', (c) => (err += c.toString()));
        proc.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`runner exited (${code}) before starting servers: ${out}${err}`));
        });
      });
    } finally {
      // Whatever happened, do not leave the runner behind.
      reap(proc.pid);
    }

    // Kill the runner outright — no `after()`, no teardown, nothing runs. A
    // global teardown is NOT the mechanism and could not be: it runs only when
    // the suite ends in order, which is the case the per-suite `after()` hooks
    // already cover. The measured orphans came from a run that did not end in
    // order, and a teardown would have missed both.
    const gone = await Promise.all(
      ports.map(async (port) => {
        const pids = pidsListeningOn(port);
        for (const pid of pids) await waitForExit(pid, 8000);
        return pidsListeningOn(port).length === 0;
      }),
    );
    for (const [i, clean] of gone.entries()) {
      assert.ok(clean, `a board server is still listening on port ${ports[i]} after its run was killed`);
    }
  });
});

describe('the mechanism is the process asking about itself', () => {
  it('the harness sets the variable on every server it starts', () => {
    // Every server, not the ones someone remembered: the defect was a rule you
    // could satisfy without doing anything, and one un-gated call site would
    // reintroduce the whole population.
    const src = fs.readFileSync(new URL('./helpers.mjs', import.meta.url), 'utf8');
    assert.match(src, /PLOT_EXIT_WITH_PARENT/, 'the test harness must set the gate');
  });

  it('the harness does not spawn detached', () => {
    // These were orphaned, not detached. Adding `detached: true` would make the
    // problem deliberate rather than fix it.
    const src = fs.readFileSync(new URL('./helpers.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /detached\s*:\s*true/, 'the harness must not detach its servers');
  });

  it('the server measures its parent rather than trusting a handler', () => {
    // A `SIGTERM` handler is the obvious shape and passes only the polite case.
    // The source is the assertion: the gate reads `ppid`.
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'packages/board/src/server/lifetime.ts'),
      'utf8',
    );
    assert.match(src, /process\.ppid/, 'the gate must observe the parent pid');
  });
});

/**
 * Which pids are listening on a TCP port, via `lsof`. Used to check that the
 * ORPHANS are gone — the runner's own pid says nothing about its children.
 * Returns [] when lsof is unavailable, which turns the assertion into a
 * tautology rather than a false failure on a machine without it.
 */
function pidsListeningOn(port) {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
}
