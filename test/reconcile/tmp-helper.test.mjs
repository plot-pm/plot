// Contract test for skills/plot/scripts/plot-tmp.sh — the one helper that
// creates a script's temp paths and owns its EXIT/INT/TERM traps.
//
// Each scenario runs a small script under a private TMPDIR and asserts on what
// is left there. A variable registry fails two of these in opposite ways: it
// removes a path at once (a trap installed inside `$(…)`) or leaks it (an array
// filled inside a subshell). The signal tests spawn from node, because a script
// a non-interactive shell starts with `&` inherits SIGINT as ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const helper = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-tmp.sh');

const sandbox = () => mkdtempSync(path.join(tmpdir(), 'plot-tmphelper-'));

const writeScript = (dir, lines) => {
  const file = path.join(dir, 'script.sh');
  writeFileSync(file, ['set -u', `. '${helper}'`, ...lines, ''].join('\n'));
  return file;
};

const runIn = (dir, lines, shell = 'bash') => {
  const tmp = path.join(dir, 'tmp');
  spawnSync('mkdir', ['-p', tmp]);
  const file = writeScript(dir, lines);
  const got = spawnSync(shell, [file], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmp } });
  return { ...got, tmp, left: readdirSync(tmp) };
};

for (const shell of ['/bin/bash', 'bash']) {
  test(`tmp helper (${shell}): a path made by name exists after the call and is gone at exit, status kept`, () => {
    const dir = sandbox();
    const got = runIn(dir, [
      'plot_tmpdir d probe',
      'plot_tmpfile f probe',
      'test -d "$d" && test -f "$f" && echo "alive $d $f"',
      'exit 7',
    ], shell);
    assert.equal(got.status, 7, got.stderr);
    const [, d, f] = got.stdout.trim().split(' ');
    assert.match(path.basename(d), /^plot-probe\.[A-Za-z0-9]{6}$/);
    assert.equal(path.dirname(d), got.tmp, 'the path lands under TMPDIR');
    assert.equal(path.dirname(f), got.tmp);
    assert.deepEqual(got.left, [], 'nothing survives the exit, the registry included');
    rmSync(dir, { recursive: true, force: true });
  });

  test(`tmp helper (${shell}): a registration inside $(…) and ( … ) & survives until the owner exits`, () => {
    // THE TWO FAILURE MODES OF A VARIABLE REGISTRY. A trap installed on first
    // call inside `$(…)` removes the path when the substitution closes; an
    // array filled inside a subshell is a copy, so the path leaks.
    const dir = sandbox();
    const got = runIn(dir, [
      'sub=$(plot_tmpdir x insub; echo "$x")',
      'test -d "$sub" && echo "sub-alive"',
      '( plot_tmpfile y inbg; echo "$y" > "$TMPDIR/../bg-path" ) &',
      'wait',
      'bg=$(cat "$TMPDIR/../bg-path")',
      'test -f "$bg" && echo "bg-alive"',
      'plot_on_exit "echo cmd-ran > \'$TMPDIR/../cmd\'"',
    ], shell);
    assert.equal(got.status, 0, got.stderr);
    assert.match(got.stdout, /sub-alive/, 'removed at once: a trap ran inside the substitution');
    assert.match(got.stdout, /bg-alive/);
    assert.deepEqual(got.left, [], 'leaked: the registration did not reach the owner');
    assert.equal(readFileSync(path.join(dir, 'cmd'), 'utf8').trim(), 'cmd-ran');
    rmSync(dir, { recursive: true, force: true });
  });
}

test('tmp helper: sourcing twice is a no-op', () => {
  const dir = sandbox();
  const got = runIn(dir, [
    'plot_tmpdir d twice',
    `. '${helper}'`,
    'test -d "$d" && echo alive',
  ]);
  assert.equal(got.status, 0, got.stderr);
  assert.match(got.stdout, /alive/, 'a second source must not remove the registered path');
  assert.deepEqual(got.left, [], 'a second source must not truncate the live registry');
  rmSync(dir, { recursive: true, force: true });
});

test('tmp helper: a stale registry at the next pid is truncated and its command never runs', () => {
  // A dead process with the same pid left `plot-reg.<pid>`. The script records
  // its own pid, then execs a shell that keeps it and sources the helper.
  const dir = sandbox();
  const tmp = path.join(dir, 'tmp');
  spawnSync('mkdir', ['-p', tmp]);
  const inner = path.join(dir, 'inner.sh');
  writeFileSync(inner, [`. '${helper}'`, 'echo "inner $$"', ''].join('\n'));
  const outer = path.join(dir, 'outer.sh');
  writeFileSync(outer, [
    `printf 'c:touch %s\\np:%s\\n' '${path.join(dir, 'stale-ran')}' '${path.join(dir, 'keep')}' > "$TMPDIR/plot-reg.$$"`,
    `exec bash '${inner}'`,
    '',
  ].join('\n'));
  writeFileSync(path.join(dir, 'keep'), 'not this process\'s');
  const got = spawnSync('bash', [outer], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmp } });
  assert.equal(got.status, 0, got.stderr);
  assert.match(got.stdout, /inner \d+/);
  assert.equal(existsSync(path.join(dir, 'stale-ran')), false, "a dead process's command ran");
  assert.equal(existsSync(path.join(dir, 'keep')), true, "a dead process's path was removed");
  assert.deepEqual(readdirSync(tmp), []);
  rmSync(dir, { recursive: true, force: true });
});

test('tmp helper: the registry path is fixed at first source', () => {
  const dir = sandbox();
  const got = runIn(dir, [
    'plot_tmpdir d before',
    `mkdir -p '${path.join(dir, 'other')}'`,
    `TMPDIR='${path.join(dir, 'other')}'`,
    'plot_tmpdir e after',
    'echo "$e"',
  ]);
  assert.equal(got.status, 0, got.stderr);
  assert.deepEqual(got.left, []);
  assert.deepEqual(readdirSync(path.join(dir, 'other')), [], 'a path made after a TMPDIR change is still removed');
  rmSync(dir, { recursive: true, force: true });
});

const signalled = (sig) => new Promise((resolve) => {
  const dir = sandbox();
  const tmp = path.join(dir, 'tmp');
  spawnSync('mkdir', ['-p', tmp]);
  const file = writeScript(dir, [
    'plot_tmpdir d sig',
    'plot_tmpfile f sig',
    'echo ready',
    `sleep 30 & echo $! > '${path.join(dir, 'sleeper')}'; wait $!`,
    `echo after > '${path.join(dir, 'after')}'`,
    'exit 0',
  ]);
  const child = spawn('bash', [file], { env: { ...process.env, TMPDIR: tmp } });
  child.stdout.on('data', (b) => {
    if (!String(b).includes('ready')) return;
    // Wait for the sleeper, so the signal lands inside `wait` rather than before it.
    const poll = setInterval(() => {
      if (existsSync(path.join(dir, 'sleeper'))) { clearInterval(poll); child.kill(sig); }
    }, 10);
  });
  child.on('exit', (code, signal) => {
    const result = { code, signal, left: readdirSync(tmp), after: existsSync(path.join(dir, 'after')) };
    try { process.kill(Number(readFileSync(path.join(dir, 'sleeper'), 'utf8')), 'SIGKILL'); } catch { /* already gone */ }
    rmSync(dir, { recursive: true, force: true });
    resolve(result);
  });
});

test('tmp helper: TERM mid-run exits 143, runs no later command, removes every path', async () => {
  const got = await signalled('SIGTERM');
  assert.ok(got.signal === 'SIGTERM' || got.code === 143, `status: ${JSON.stringify(got)}`);
  assert.equal(got.after, false, 'a command after the signal ran');
  assert.deepEqual(got.left, []);
});

test('tmp helper: INT mid-run exits 130, runs no later command, removes every path', async () => {
  const got = await signalled('SIGINT');
  assert.ok(got.signal === 'SIGINT' || got.code === 130, `status: ${JSON.stringify(got)}`);
  assert.equal(got.after, false, 'a command after the signal ran');
  assert.deepEqual(got.left, []);
});

// A CLOSED PIPE IS A SIGNAL TOO. A board server stopped with SIGTERM leaves its
// running scripts with a closed stdout and stderr, and their next write raises
// SIGPIPE, whose default action skips the EXIT trap. `fd` is the stream the
// reader closes: 1 for stdout, 2 for stderr.
const piped = (lines, fd) => new Promise((resolve) => {
  const dir = sandbox();
  const tmp = path.join(dir, 'tmp');
  spawnSync('mkdir', ['-p', tmp]);
  const file = writeScript(dir, lines);
  const stdio = ['ignore', 'ignore', 'ignore'];
  stdio[fd] = 'pipe';
  const child = spawn('bash', [file], { stdio, env: { ...process.env, TMPDIR: tmp } });
  child.stdio[fd].destroy();
  child.on('exit', (code, signal) => {
    const result = { code, signal, left: readdirSync(tmp) };
    rmSync(dir, { recursive: true, force: true });
    resolve(result);
  });
});

test('tmp helper: a write to a closed stdout exits 141 and removes every path', async () => {
  const got = await piped(['plot_tmpdir d pipe', 'plot_tmpfile f pipe', 'while :; do echo x; done'], 1);
  assert.ok(got.signal === 'SIGPIPE' || got.code === 141, `status: ${JSON.stringify(got)}`);
  assert.deepEqual(got.left, []);
});

test('tmp helper: a cleanup command writing to a closed stderr still removes the registry', async () => {
  const got = await piped(['plot_tmpfile f pipe', 'plot_on_exit "echo bye >&2"', 'sleep 0.3'], 2);
  assert.deepEqual(got.left, []);
});
