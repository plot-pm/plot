// Contract test for scripts/owned-run.sh — the wrapper that gives a suite run a
// private TMPDIR and HOME, and fails when the run leaves an entry behind.
//
// EVERY CASE RUNS THE WRAPPER OVER A SMALL FIXTURE COMMAND, never over the real
// suite: the suite must stay green while this proves the gate fires.
//
// THE SIGNAL CASES SPAWN FROM NODE, NOT FROM A SHELL WITH `&`. A non-interactive
// shell starting a job with `&` sets SIGINT to IGNORED in the child, and `trap`
// cannot override an inherited SIG_IGN — so an INT test started that way watches
// the wrapper survive a signal that never arrived, and passes without testing
// anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const wrapper = path.join(repoRoot, 'scripts', 'owned-run.sh');

// A private TMPDIR per case, so one case's root can never be counted by another.
// Removed by the exact name mkdtempSync returned — never a glob over the shared
// temp directory.
const privateTmp = (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-ownedrun-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const runWrapped = (tmp, args, extraEnv = {}) =>
  spawnSync('bash', [wrapper, ...args], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, TMPDIR: tmp, ...extraEnv },
  });

test('a clean command leaves no entry and keeps its exit code', (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, ['sh', '-c', 'exit 0']);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(readdirSync(tmp), [], 'the run root was not removed');
});

test('a failing command keeps its own exit code through both checks', (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, ['sh', '-c', 'exit 7']);
  assert.equal(res.status, 7, 'the suite exit code must survive the gates');
  assert.deepEqual(readdirSync(tmp), [], 'the run root was not removed');
});

test('the run gets a TMPDIR, HOME, budget home and PR index home inside one root', (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, [
    'sh',
    '-c',
    'printf "%s\\n%s\\n%s\\n%s\\n" "$TMPDIR" "$HOME" "$PLOT_BUDGET_HOME" "$PLOT_PR_INDEX_HOME"',
  ]);
  assert.equal(res.status, 0, res.stderr);
  const [seenTmp, seenHome, seenBudget, seenIndex] = res.stdout.trim().split('\n');
  assert.match(path.basename(seenTmp), /^plot-run\./, 'TMPDIR is the run root');
  assert.equal(path.dirname(seenTmp), tmp, 'the root sits in the caller TMPDIR');
  for (const [label, p] of [['HOME', seenHome], ['budget', seenBudget], ['PR index', seenIndex]]) {
    assert.equal(path.dirname(p), seenTmp, `${label} must live inside the run root`);
    assert.notEqual(p, process.env.HOME, `${label} must not be the operator's own`);
  }
});

// THE GATE'S OWN FIXTURE — the Done-when item "pnpm run test:contracts fails
// when a test leaves an entry". The command creates one on purpose.
test('Playwright finds its browsers under the caller HOME, not the private one', (t) => {
  const tmp = privateTmp(t);
  const home = privateTmp(t);
  const res = runWrapped(tmp, ['sh', '-c', 'printf "%s\\n" "$PLAYWRIGHT_BROWSERS_PATH"'],
    { HOME: home, PLAYWRIGHT_BROWSERS_PATH: '', XDG_CACHE_HOME: '' });
  assert.equal(res.status, 0, res.stderr);
  const want = process.platform === 'darwin'
    ? path.join(home, 'Library', 'Caches', 'ms-playwright')
    : path.join(home, '.cache', 'ms-playwright');
  // The registry check prints its own line after the command's.
  assert.equal(res.stdout.split('\n')[0], want);
});

test('a caller PLAYWRIGHT_BROWSERS_PATH wins', (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, ['sh', '-c', 'printf "%s\\n" "$PLAYWRIGHT_BROWSERS_PATH"'],
    { PLAYWRIGHT_BROWSERS_PATH: '/opt/browsers' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.split('\n')[0], '/opt/browsers');
});

test('an entry left behind fails the run and is named with its prefix', (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, ['sh', '-c', 'mkdir -p "$TMPDIR/plot-leaky-abc123"; exit 0']);
  assert.equal(res.status, 1, 'a leaked entry must fail the run');
  assert.match(res.stderr, /plot-leaky-abc123/, 'the gate names the entry');
  assert.match(res.stderr, /prefix plot-leaky-/, 'the gate names the prefix');
  assert.deepEqual(readdirSync(tmp), [], 'the root is removed even when the gate fails');
});

test('a leaked file is caught, not only a leaked directory', (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, ['sh', '-c', ': > "$TMPDIR/plot-stray-file"; exit 0']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /plot-stray-file/);
});

test('a leak fails the run even when the command already failed', (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, ['sh', '-c', 'mkdir -p "$TMPDIR/plot-leaky-xyz789"; exit 3']);
  assert.equal(res.status, 1, 'the leak verdict wins over the suite failure');
  assert.match(res.stderr, /plot-leaky-xyz789/);
});

// THE WRAPPER'S OWN SUBDIRECTORIES ARE NOT LEAKS. HOME, budget and PR index are
// created by the wrapper, and a suite writing into them is the whole point.
test('writes under HOME and the budget home are not reported as leaks', (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, [
    'sh',
    '-c',
    'mkdir -p "$HOME/.plot/state/board-cache" && echo x > "$HOME/.plot/state/board-cache/o-1.json" && echo line > "$PLOT_BUDGET_HOME/budget.tsv" && exit 0',
  ]);
  assert.equal(res.status, 0, res.stderr);
});

// NODE'S COMPILE CACHE GOES INTO THE RUN'S HOME. vite, vitest and typescript
// enable it, and unset it writes `$TMPDIR/node-compile-cache` into the root.
test('the node compile cache is pointed into the run HOME', (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, ['sh', '-c', 'printf "%s\\n%s\\n" "$NODE_COMPILE_CACHE" "$HOME"'],
    { NODE_COMPILE_CACHE: '' });
  assert.equal(res.status, 0, res.stderr);
  const [cache, home] = res.stdout.trim().split('\n');
  assert.equal(cache, path.join(home, '.node-compile-cache'));
  assert.deepEqual(readdirSync(tmp), [], 'the root is removed, the cache with it');
});

test("a caller's NODE_COMPILE_CACHE wins", (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, ['sh', '-c', 'printf "%s\\n" "$NODE_COMPILE_CACHE"'],
    { NODE_COMPILE_CACHE: path.join(tmp, 'caller-cache') });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.split('\n')[0], path.join(tmp, 'caller-cache'));
});

test('a compile cache written at the default path is a leak', (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, ['sh', '-c', 'mkdir -p "$TMPDIR/node-compile-cache/v24"; exit 0']);
  assert.equal(res.status, 1, 'no name is excluded');
  assert.match(res.stderr, /node-compile-cache/);
});

// THERE IS NO CEILING. One entry fails the run whatever the caller's
// environment says, so an old `PLOT_LEAK_CEILING` cannot switch the gate off.
test('one entry fails the run even with PLOT_LEAK_CEILING set', (t) => {
  const tmp = privateTmp(t);
  const res = runWrapped(tmp, ['sh', '-c', 'mkdir -p "$TMPDIR/plot-under-abc123"; exit 0'],
    { PLOT_LEAK_CEILING: '5' });
  assert.equal(res.status, 1, 'one entry must fail the run');
  assert.match(res.stderr, /plot-under-abc123\t\(prefix plot-under-\)/, 'the gate names the entry and its prefix');
  assert.doesNotMatch(res.stderr, /ceiling/, 'the report names no ceiling');
  assert.deepEqual(readdirSync(tmp), [], 'the root is removed');
});

// A RUN KILLED AT ITS BOUND IS NOT A LEAKED TEST. `bounded.sh` uses
// `timeout -k`, which SIGKILLs the suite, and SIGKILL skips every cleanup by
// definition. Measured 2026-09-30 at load average 19.35: `test:contracts` hit
// its 1500 s bound and the gate reported 807 entries, 117 of them from a file
// that leaves zero when it runs to the end.
test('a run killed at its bound reports the bound, not a leak', (t) => {
  const tmp = privateTmp(t);
  // Exit 124 is what `timeout` reports when it fires; the command also leaves an
  // entry, which is exactly the shape a SIGKILLed suite leaves.
  const res = runWrapped(tmp, ['sh', '-c', 'mkdir -p "$TMPDIR/plot-killed-abc123"; exit 124']);
  assert.equal(res.status, 124, 'the timeout exit code survives');
  assert.match(res.stderr, /KILLED at its bound/, 'the report names the bound');
  assert.match(res.stderr, /NOT a leaked test/, 'and says what it is not');
  assert.doesNotMatch(
    res.stderr,
    /a test created these and did not remove them/,
    'a killed run must not be reported as a test that forgot',
  );
  assert.deepEqual(readdirSync(tmp), [], 'the root is still removed');
});

// ═══════════════════════════════════════════════════════════════════════════
// SIGNALS — spawned from node so the disposition is DEFAULT, not inherited IGN
// ═══════════════════════════════════════════════════════════════════════════

// THE SIGNAL WAITS FOR THE CHILD TO BE RUNNING, not merely for the root to
// exist. The wrapper creates the root, then three subdirectories, then execs the
// command; a signal delivered inside that window finds a trap with a half-built
// root and the run ends before the case is testing anything. The fixture command
// announces itself by creating a marker, which is the only observation that says
// the wrapper reached `"$@"`.
const signalRun = (tmp, signal) =>
  new Promise((resolve) => {
    const child = spawn(
      'bash',
      // THE FIXTURE FORWARDS THE SIGNAL TO ITS OWN CHILD. `sh` exits on TERM
      // without passing it to the `sleep` it spawned, which orphans that sleep
      // onto the machine for its full 30 s — the very shape this slice exists
      // to stop. The trap makes the fixture clean up after itself.
      [wrapper, 'sh', '-c', 'sleep 30 & sp=$!; trap "kill $sp 2>/dev/null; exit 143" TERM INT; : > "$TMPDIR/started"; wait $sp'],
      { cwd: repoRoot, env: { ...process.env, TMPDIR: tmp }, stdio: 'ignore' },
    );
    const waitForStart = setInterval(() => {
      const root = readdirSync(tmp).find((n) => n.startsWith('plot-run.'));
      if (root && existsSync(path.join(tmp, root, 'started'))) {
        clearInterval(waitForStart);
        child.kill(signal);
      }
    }, 20);
    child.on('exit', (code, sig) => {
      clearInterval(waitForStart);
      resolve({ code, sig });
    });
  });

test('SIGINT removes the root and exits 130', async (t) => {
  const tmp = privateTmp(t);
  const { code, sig } = await signalRun(tmp, 'SIGINT');
  assert.deepEqual(readdirSync(tmp), [], 'the root survived a SIGINT');
  // The wrapper re-raises with the default disposition, so the process dies OF
  // the signal; a shell reports that as 128+n. Either observation is the same
  // event seen from two sides.
  assert.ok(code === 130 || sig === 'SIGINT', `expected 130 or SIGINT, got code=${code} sig=${sig}`);
});

test('SIGTERM removes the root and exits 143', async (t) => {
  const tmp = privateTmp(t);
  const { code, sig } = await signalRun(tmp, 'SIGTERM');
  assert.deepEqual(readdirSync(tmp), [], 'the root survived a SIGTERM');
  assert.ok(code === 143 || sig === 'SIGTERM', `expected 143 or SIGTERM, got code=${code} sig=${sig}`);
});

// A SIGKILL skips the trap by definition. The contract is that it leaves at most
// ONE directory, carrying the `plot-` prefix that plot-reap.sh --sweep-temp
// removes — not a scatter of fixtures across the operator's temp directory.
test('a SIGKILL leaves at most one plot-run directory for the sweep', async (t) => {
  const tmp = privateTmp(t);
  await new Promise((resolve) => {
    const child = spawn('bash', [wrapper, 'sh', '-c', 'mkdir -p "$TMPDIR/plot-fixture-one" "$TMPDIR/plot-fixture-two"; exec sleep 30'], {
      cwd: repoRoot,
      env: { ...process.env, TMPDIR: tmp },
      stdio: 'ignore',
    });
    const waitForFixtures = setInterval(() => {
      const root = readdirSync(tmp).find((n) => n.startsWith('plot-run.'));
      if (root && readdirSync(path.join(tmp, root)).includes('plot-fixture-two')) {
        clearInterval(waitForFixtures);
        child.kill('SIGKILL');
      }
    }, 20);
    child.on('exit', () => { clearInterval(waitForFixtures); resolve(); });
  });
  const left = readdirSync(tmp);
  assert.equal(left.length, 1, `expected one directory, got ${JSON.stringify(left)}`);
  assert.match(left[0], /^plot-run\./, 'the survivor carries the prefix the sweep removes');
});

// ═══════════════════════════════════════════════════════════════════════════
// THE REGISTRY CHECK STILL SEES THE REAL TEMP DIRECTORY
// ═══════════════════════════════════════════════════════════════════════════
//
// check-registry-not-leaked.mjs:116 builds its temp set from
// [os.tmpdir(), TMPDIR, '/tmp', '/var/tmp']. Run INSIDE the private root,
// os.tmpdir() answers the root and /var/folders/.../T drops out of the set — so
// a fixture manifest recorded there would read as clean. The wrapper restores
// the caller's TMPDIR and HOME for that one call, and this proves it.
test('the registry check still fails on a manifest under the original os.tmpdir()', (t) => {
  const tmp = privateTmp(t);

  // A fixture CHECKOUT, because the check resolves its registry through
  // `plot-config.sh get 'Agent registry'` against the repo root — there is no
  // env override to point it elsewhere. A REAL GIT REPOSITORY, because that
  // resolution goes through git rather than the working directory: measured
  // while writing this, a plain temp directory made it answer the OPERATOR's
  // registry, so the fixture manifest was never read and the case passed for
  // the wrong reason.
  const repo = mkdtempSync(path.join(tmpdir(), 'plot-ownedrun-repo-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' });
  mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  mkdirSync(path.join(repo, 'skills', 'plot', 'scripts'), { recursive: true });
  mkdirSync(path.join(repo, '.plot', 'agents'), { recursive: true });
  for (const rel of [
    ['scripts', 'check-registry-not-leaked.mjs'],
    ['scripts', 'owned-run.sh'],
    ['skills', 'plot', 'scripts', 'plot-config.sh'],
  ]) {
    copyFileSync(path.join(repoRoot, ...rel), path.join(repo, ...rel));
  }
  writeFileSync(path.join(repo, 'CLAUDE.md'), '## Plot Config\n\n- **Agent registry:** .plot/agents\n');

  // THE DESK LIES UNDER THE CALLER'S OWN TMPDIR, which is what the check's temp
  // set is built from. `os.tmpdir()` returns `TMPDIR` when it is set, so the
  // real case — a caller whose TMPDIR is the system temp root — is modelled by
  // putting the desk inside whatever TMPDIR this case hands the wrapper.
  const desk = mkdtempSync(path.join(tmp, 'plot-ownedrun-desk-'));
  writeFileSync(
    path.join(repo, '.plot', 'agents', 'fixture.json'),
    JSON.stringify({ worktree: desk, branch: 'bug/fixture' }),
  );

  const env = { ...process.env, TMPDIR: tmp };
  delete env.PLOT_REPO_ROOT;
  const res = spawnSync('bash', [path.join(repo, 'scripts', 'owned-run.sh'), 'sh', '-c', 'exit 0'], {
    encoding: 'utf8',
    cwd: repo,
    env,
  });

  const out = `${res.stdout}${res.stderr}`;
  assert.equal(res.status, 1, `a fixture desk under the caller TMPDIR must still fail:\n${out}`);
  assert.match(out, /fixture\.json|plot-ownedrun-desk-/, 'the check names the leaked manifest');

  // THE POINT OF THE CASE: the check saw the CALLER's temp root, not the private
  // run root. Inside the root, `os.tmpdir()` answers the root and the caller's
  // temp directory drops out of the set entirely — a fixture manifest recorded
  // there would read as clean and the gate would silently stop gating.
  // When this suite itself runs inside `owned-run.sh`, as `test:contracts`
  // does, every path here lies under that ENCLOSING run's root, which is what
  // `os.tmpdir()` answers. That root is masked so the assertion reads only the
  // root the wrapper under test would have made. macOS spells one directory
  // two ways, `/private/var/...` and its `/var/...` symlink, and the check
  // prints both, so the `/private` prefix is dropped before masking.
  const unalias = (s) => s.split('/private/var/').join('/var/');
  const root = unalias(realpathSync(tmpdir()));
  const own = unalias(out).split(root).join('<CALLER_TMP>');
  assert.doesNotMatch(own, /plot-run\./, 'the check must not have run inside the private root');
  assert.ok(out.includes(tmp), `the check's temp set names the caller TMPDIR:\n${out}`);

  rmSync(desk, { recursive: true, force: true });
});
