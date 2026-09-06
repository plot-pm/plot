// Contract test for skills/plot/scripts/plot-boardctl.sh — board control's
// mechanics, and the four disagreements that stand between a person and a kill.
//
// THE DISAGREEMENTS ARE THE SUBJECT. `--stop` finds the board by two facts that
// must agree — the pid `--start` recorded, and whoever holds the port — and
// every case where they do not is a refusal that names which fact disagrees. A
// `pkill -f 'board-server.mjs'` on 2026-09-04 killed an operator's board along
// with the stale jobs it was aimed at; a pattern over process names is exactly
// the guess these refusals exist to prevent, so each of them is asserted.
//
// NO TEST LEAVES A SERVER RUNNING, and none goes near port 7777 — the port an
// operator's own board holds. Every case here needs only a pid and a socket, so
// a `node -e` listener and a sleeping process stand in for a board wherever the
// question is about the two facts rather than about the board itself. The one
// test that walks a real tree builds it out of `sleep`, on no port at all.
//
// THE ANCESTRY RULE IS WHY THERE IS A TREE TEST. `node --watch` supervises the
// child that binds the port, measured on the live board as 9518 → 27674, so the
// port answers with a DESCENDANT of the recorded pid. An equality check would
// refuse every healthy board of that shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');
const scripts = path.join(repo, 'skills', 'plot', 'scripts');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A repository shaped like an adopting project, holding a copy of the script
 * under test.
 *
 * REAL COPIES rather than a symlink, because the script composes paths from
 * `git rev-parse --show-toplevel` and writes its pidfile under that root. A
 * sandbox is what keeps `.plot/state/board.pid` out of the real checkout.
 */
function sandbox(label) {
  const box = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `plot-boardctl-${label}-`)));
  const root = path.join(box, 'repo');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Plot Test');
  git(root, 'config', 'commit.gpgsign', 'false');

  const dst = path.join(root, 'skills', 'plot', 'scripts');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['plot-boardctl.sh', 'plot-board-probe.sh', 'plot-config.sh']) {
    fs.copyFileSync(path.join(scripts, f), path.join(dst, f));
  }
  fs.chmodSync(path.join(dst, 'plot-boardctl.sh'), 0o755);
  fs.chmodSync(path.join(dst, 'plot-board-probe.sh'), 0o755);

  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# t\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return { root, box, ctl: path.join(dst, 'plot-boardctl.sh') };
}

function run(ctl, args, cwd, env = {}) {
  try {
    return {
      status: 0,
      out: execFileSync('bash', [ctl, ...args], {
        encoding: 'utf8', cwd, timeout: 60000, env: { ...process.env, ...env },
      }),
    };
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

const writePid = (root, pid) => {
  fs.mkdirSync(path.join(root, '.plot', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.plot', 'state', 'board.pid'), `${pid}\n`);
};

/** An OS-assigned free port, released before it is handed back. */
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

/**
 * A process that holds a port and nothing else — a stand-in for a board
 * wherever the question is *who holds this port*, which is all `--stop` asks of
 * the second fact. It serves no `/api/board`, deliberately: `--stop` never
 * fetches, and a test that started a real board would be a test that can leave
 * one running.
 */
async function listener(port) {
  const child = spawn(process.execPath, [
    '-e',
    `require("net").createServer().listen(${port}, "127.0.0.1", () => {}); setTimeout(() => process.exit(0), 60000);`,
  ], { stdio: 'ignore' });
  // Wait for the bind, rather than for the process: the pid exists immediately
  // and the socket does not, and the socket is the fact under test.
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const probe = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
    });
    if (probe) return child;
  }
  throw new Error(`listener never bound port ${port}`);
}

const stop = (child) => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };

// ── The verbs refuse to be guessed ────────────────────────────────────────────

test('boardctl: no verb is a refusal, not a default', () => {
  const { root, ctl } = sandbox('noverb');
  const r = run(ctl, [], root);
  assert.equal(r.status, 1);
  assert.match(r.out, /one of --status, --start, --stop/);
});

test('boardctl: an unknown argument is named rather than ignored', () => {
  const { root, ctl } = sandbox('unknown');
  const r = run(ctl, ['--restart'], root);
  assert.equal(r.status, 1);
  assert.match(r.out, /unknown argument '--restart'/);
});

test('boardctl: --port and --wait take numbers', () => {
  const { root, ctl } = sandbox('args');
  assert.match(run(ctl, ['--status', '--port', 'soon'], root).out, /--port needs a number/);
  assert.match(run(ctl, ['--stop', '--wait', 'later'], root).out, /--wait needs a number/);
});

// ── --status starts nothing, and says whose board it found ───────────────────

test('status: nothing recorded and nothing listening is reported, not repaired', async () => {
  const { root, ctl } = sandbox('status-empty');
  const port = await freePort();
  const r = run(ctl, ['--status', '--port', String(port)], root);
  // Exit 1 means nothing is listening — a caller gates on this without parsing.
  assert.equal(r.status, 1);
  assert.match(r.out, /pidfile: none/);
  assert.match(r.out, /nothing listening/);
  assert.match(r.out, /answers: no/);
});

test('status: a pidfile whose process is gone reads STALE, and is left in place', async () => {
  const { root, ctl } = sandbox('status-stale');
  const port = await freePort();
  // A pid that cannot be running: `kill -0` on it fails, which is the whole
  // question. A PIDFILE OUTLIVES ITS PROCESS — that is why the file alone is
  // never enough, and why this state has a name rather than being cleaned up.
  writePid(root, 2 ** 22);
  const r = run(ctl, ['--status', '--port', String(port)], root);
  assert.match(r.out, /STALE — no such process/);
  // Reported, never repaired: the file is the evidence `--stop` reads.
  assert.ok(fs.existsSync(path.join(root, '.plot', 'state', 'board.pid')));
});

test('status: a held port is reported even with no pidfile, and starts nothing', async () => {
  const { root, ctl } = sandbox('status-port');
  const port = await freePort();
  const child = await listener(port);
  try {
    const r = run(ctl, ['--status', '--port', String(port)], root);
    assert.equal(r.status, 0);
    assert.match(r.out, new RegExp(`port ${port}: pid ${child.pid} listening`));
    // It holds the port but serves no /api/board, so ownership is UNKNOWN and
    // is reported as such rather than assumed.
    assert.match(r.out, /answers: no — something holds the port/);
  } finally {
    stop(child);
  }
});

// ── The four disagreements ───────────────────────────────────────────────────

test('stop: no pidfile and nothing listening is not an error — there is no board', async () => {
  const { root, ctl } = sandbox('stop-none');
  const port = await freePort();
  const r = run(ctl, ['--stop', '--port', String(port)], root);
  assert.equal(r.status, 0);
  assert.match(r.out, /no board to stop/);
});

test('stop: a held port with no record of it refuses — it may be another checkout', async () => {
  const { root, ctl } = sandbox('stop-unrecorded');
  const port = await freePort();
  const child = await listener(port);
  try {
    const r = run(ctl, ['--stop', '--port', String(port)], root);
    assert.equal(r.status, 1);
    assert.match(r.out, /this repository recorded no board/);
    assert.match(r.out, /another checkout's board, or one started by hand/);
    // AND IT IS STILL RUNNING. The refusal is the feature: a stop that killed
    // whoever answered is the 2026-09-04 failure with extra steps.
    assert.equal(child.killed, false);
    assert.doesNotThrow(() => process.kill(child.pid, 0));
  } finally {
    stop(child);
  }
});

test('stop: a stale pidfile refuses rather than signalling a recycled pid', async () => {
  const { root, ctl } = sandbox('stop-stale');
  const port = await freePort();
  writePid(root, 2 ** 22);
  const r = run(ctl, ['--stop', '--port', String(port)], root);
  assert.equal(r.status, 1);
  assert.match(r.out, /which is not running/);
  assert.match(r.out, /already gone/);
});

test('stop: a live pid serving no port refuses — its identity is unproven', async () => {
  const { root, ctl } = sandbox('stop-noport');
  const port = await freePort();
  const child = spawn('sleep', ['60'], { stdio: 'ignore' });
  try {
    writePid(root, child.pid);
    const r = run(ctl, ['--stop', '--port', String(port)], root);
    assert.equal(r.status, 1);
    assert.match(r.out, /nothing is listening/);
    assert.match(r.out, /identity is unproven/);
    assert.doesNotThrow(() => process.kill(child.pid, 0));
  } finally {
    stop(child);
  }
});

test('stop: a live pid and an unrelated port-holder refuses, naming both', async () => {
  const { root, ctl } = sandbox('stop-different');
  const port = await freePort();
  const recorded = spawn('sleep', ['60'], { stdio: 'ignore' });
  const holder = await listener(port);
  try {
    writePid(root, recorded.pid);
    const r = run(ctl, ['--stop', '--port', String(port)], root);
    assert.equal(r.status, 1);
    assert.match(r.out, /name different trees/);
    assert.match(r.out, new RegExp(`does not descend from ${recorded.pid}`));
    // NEITHER IS SIGNALLED. Two boards are involved or a pid was recycled, and
    // stopping either on this evidence would be a guess.
    assert.doesNotThrow(() => process.kill(recorded.pid, 0));
    assert.doesNotThrow(() => process.kill(holder.pid, 0));
  } finally {
    stop(recorded);
    stop(holder);
  }
});

// ── The agreement is an ancestry, not an equality ────────────────────────────

test('stop: the port-holder may be a DESCENDANT of the recorded pid', async () => {
  const { root, ctl } = sandbox('stop-tree');
  const port = await freePort();
  // THE SHAPE `node --watch` PRODUCES, built by hand: a parent whose child
  // holds the port. Measured on the live board as 9518 → 27674. An equality
  // check between the pidfile and `lsof` would refuse this, which is every
  // healthy board started by `pnpm board`.
  const parent = spawn('bash', [
    '-c',
    `node -e 'require("net").createServer().listen(${port}, "127.0.0.1", () => {}); setTimeout(() => process.exit(0), 60000);' & child=$!; sleep 60`,
  ], { stdio: 'ignore', detached: false });
  try {
    // Wait for the grandchild to bind.
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const bound = await new Promise((resolve) => {
        const s = net.connect(port, '127.0.0.1');
        s.on('connect', () => { s.destroy(); resolve(true); });
        s.on('error', () => resolve(false));
      });
      if (bound) break;
    }
    writePid(root, parent.pid);
    const r = run(ctl, ['--stop', '--port', String(port)], root);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /stopping the board/);
    // THE TREE STOPPED, not just the pid: the port is free afterwards, which is
    // the fact `--stop` re-asks rather than trusting the signal it sent.
    assert.match(r.out, /Nothing is listening/);
    // And the pidfile is gone, because the board it recorded is.
    assert.ok(!fs.existsSync(path.join(root, '.plot', 'state', 'board.pid')));
  } finally {
    stop(parent);
  }
});

// ── --start refuses when there is nothing to start ───────────────────────────

test('start: no artifact anywhere is a refusal that points at setup', async () => {
  const { root, ctl } = sandbox('start-noartifact');
  const port = await freePort();
  // The probe resolves plugin → npm → checkout. The sandbox holds no
  // `board-server.mjs`, so the two overrides remove the other two routes and
  // `artifact_source` is `none` — the one case this checkout cannot otherwise
  // reproduce, since it always holds an artifact of its own.
  const r = run(ctl, ['--start', '--port', String(port)], root, {
    PLOT_PLUGIN_ROOT: '/nonexistent-plugin-root',
    PLOT_NPM_BIN: '/nonexistent-npm-bin',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  });
  assert.equal(r.status, 1);
  assert.match(r.out, /nothing to start/);
  assert.match(r.out, /plot-board-setup/);
});

test('start: --dry-run reports the plan and writes no pidfile', async () => {
  const { root, ctl } = sandbox('start-dry');
  const port = await freePort();
  // A stand-in artifact, so the probe's checkout route resolves. --dry-run must
  // not run it.
  fs.mkdirSync(path.join(root, 'skills', 'plot', 'scripts', 'board'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'plot', 'scripts', 'board', 'board-server.mjs'), 'process.exit(0);\n');
  const r = run(ctl, ['--start', '--dry-run', '--port', String(port)], root, {
    PLOT_PLUGIN_ROOT: '/nonexistent-plugin-root',
    PLOT_NPM_BIN: '/nonexistent-npm-bin',
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /would start the board/);
  assert.match(r.out, new RegExp(`port:\\s+${port}`));
  assert.ok(!fs.existsSync(path.join(root, '.plot', 'state', 'board.pid')));
});
