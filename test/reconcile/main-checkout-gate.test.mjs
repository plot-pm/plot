// Wave 2 (bug/main-checkout-stays-clean) of
// docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md.
//
// Wave 1 named the cause: no script wrote to the main checkout — an
// interactive session ran `git commit`/`git reset` against it by hand. This
// proves the guard that closes that gap actually fires: the compiled
// `plot-gate.mjs` bundle, run exactly as `plot-gates.sh` runs it (hook JSON
// on stdin, cwd as the working directory), refuses a mutating git command in
// the MAIN checkout when PLOT_UNATTENDED=1 says an unattended agent runs it,
// allows the same command at a desk (a linked worktree), and allows an
// attended session in the main checkout.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const bundle = path.join(repoRoot, 'skills', 'plot', 'scripts', 'board', 'plot-gate.mjs');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

const temps = [];
after(() => {
  for (const t of temps) fs.rmSync(t, { recursive: true, force: true, maxRetries: 3 });
});

before(() => {
  assert.ok(fs.existsSync(bundle), `${bundle} is missing — run \`pnpm build:board\` before this test`);
});

/** A bare origin plus a `main` checkout clone, with a desk worktree attached. */
const makeEstate = (label) => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `plot-maingate-${label}-`)));
  temps.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const main = path.join(tmp, 'main-checkout');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, main);
  git(main, 'config', 'user.email', 'test@example.invalid');
  git(main, 'config', 'user.name', 'Plot Test');
  git(main, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(main, 'README.md'), 'estate\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-qm', 'init');
  git(main, 'push', '-q', 'origin', 'main');

  const desk = path.join(tmp, 'desks', 'feature-x');
  git(main, 'worktree', 'add', '-q', '-b', 'feature/x', desk, 'origin/main');

  return { tmp, origin, main, desk };
};

/** The environment with PLOT_UNATTENDED set to `value`, or removed where `value` is undefined. */
const envWith = (value) => {
  const env = { ...process.env };
  delete env.PLOT_UNATTENDED;
  if (value !== undefined) env.PLOT_UNATTENDED = value;
  return env;
};
const UNATTENDED = envWith('1');
const ATTENDED = envWith(undefined);

/**
 * Runs the real gate bundle exactly as plot-gates.sh invokes it: hook JSON on
 * stdin, exit code as the answer. `util.promisify(execFile)`'s `input` option
 * hangs this bundle indefinitely (reproduced standalone outside this test, on
 * Node 24) — writing to `child.stdin` directly does not.
 */
const runGateBundle = (cwd, command, env) =>
  new Promise((resolvePromise) => {
    const child = execFile('node', [bundle, '--all'], { cwd, encoding: 'utf8', env }, (error, _stdout, stderr) => {
      resolvePromise({ code: error ? error.code : 0, stderr: stderr ?? '' });
    });
    child.stdin.end(JSON.stringify({ tool_input: { command } }));
  });

test('main-checkout gate: refuses an unattended commit run directly in the main checkout', async () => {
  const { main } = makeEstate('refuse-main');
  const answer = await runGateBundle(main, 'git commit -am "by hand"', UNATTENDED);
  assert.equal(answer.code, 2, `expected a refusal, got exit ${answer.code}, stderr:\n${answer.stderr}`);
  assert.match(answer.stderr, /MAIN checkout/);
});

test('main-checkout gate: refuses an unattended reset run directly in the main checkout', async () => {
  const { main } = makeEstate('refuse-reset');
  const answer = await runGateBundle(main, 'git reset --hard HEAD~1', UNATTENDED);
  assert.equal(answer.code, 2, `expected a refusal, got exit ${answer.code}, stderr:\n${answer.stderr}`);
});

test('main-checkout gate: refuses an unattended git -C <main> commit run from a desk', async () => {
  const { main, desk } = makeEstate('refuse-dash-c');
  const answer = await runGateBundle(desk, `git -C ${main} commit -am "via -C"`, UNATTENDED);
  assert.equal(answer.code, 2, `expected a refusal, got exit ${answer.code}, stderr:\n${answer.stderr}`);
});

test('main-checkout gate: allows an unattended commit at a desk (a linked worktree)', async () => {
  const { desk } = makeEstate('allow-desk');
  const answer = await runGateBundle(desk, 'git commit -am "from a desk"', UNATTENDED);
  assert.equal(answer.code, 0, `expected the desk to be allowed, stderr:\n${answer.stderr}`);
});

test('main-checkout gate: allows an unattended read-only command in the main checkout', async () => {
  const { main } = makeEstate('allow-read');
  const answer = await runGateBundle(main, 'git status --porcelain && git branch --show-current', UNATTENDED);
  assert.equal(answer.code, 0, `expected a read to be allowed, stderr:\n${answer.stderr}`);
});

test('main-checkout gate: allows an attended commit in the main checkout', async () => {
  const { main } = makeEstate('allow-attended');
  const answer = await runGateBundle(main, 'git commit -am "interactive"', ATTENDED);
  assert.equal(answer.code, 0, `expected an attended session to be allowed, got exit ${answer.code}, stderr:\n${answer.stderr}`);
});
