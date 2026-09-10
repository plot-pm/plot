// Contract test for skills/plot/scripts/plot-controller-gate.sh — the gate that
// refuses a controller-owned lifecycle script invoked without a controller
// receipt. Builds throwaway git repos and FIRES THE HOOK, because a hook that
// is registered and never fires is this feature's failure mode: a written file
// is not the evidence, the block is.
//
// THE RECEIPT IS EXERCISED THROUGH THE WRITERS, never by hand. The shell half
// goes through the file the escape and the scripts source; the board half goes
// through `recordActionReceipt`, the function the three endpoints call. A test
// that wrote the file itself would pin the gate's reader against a fixture
// rather than against its writers, which is the drift `plot-pr-merged.sh` was
// extracted to prevent — and here there are two writers that must agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const gate = path.join(scripts, 'plot-controller-gate.sh');
const receipt = path.join(scripts, 'plot-state-receipt.sh');

/** A repository root — the master agent's position, where the gate bites. */
function repo() {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plot-controller-gate-'));
  const dir = path.join(tmp, 'repo');
  mkdirSync(dir, { recursive: true });
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  sh('git commit -qm init --allow-empty');
  mkdirSync(path.join(dir, '.plot', 'state'), { recursive: true });
  return dir;
}

/** Fire the hook exactly as Claude Code does: JSON on stdin, from a cwd. */
function run(cwd, command) {
  return spawnSync('bash', [gate], {
    cwd,
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
  });
}

/** The controller's half, through the file the escape and the scripts source. */
function recordReceipt(dir, script, subject = 'x') {
  execSync(`. "${receipt}" && record_action_receipt "${script}" "${subject}"`, {
    cwd: dir, shell: '/bin/bash', stdio: 'pipe',
  });
}

/** The script's half — spent on its own exit 0, never at the gate. */
function spendReceipt(dir, script) {
  execSync(`. "${receipt}" && spend_action_receipt "${script}"`, {
    cwd: dir, shell: '/bin/bash', stdio: 'pipe',
  });
}

const DISPATCH = 'bash skills/plot/scripts/plot-dispatch.sh some-slug';

test('controller gate: a direct plot-dispatch.sh call is refused and names the endpoint', () => {
  const r = run(repo(), DISPATCH);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /controller-owned action/);
  assert.match(r.stderr, /POST \/api\/dispatch/, 'the refusal names the route to call instead');
});

test('controller gate: the refusal names the escape and says the reason is counted', () => {
  const r = run(repo(), DISPATCH);
  assert.match(r.stderr, /--unowned-action dispatch/);
  assert.match(r.stderr, /unowned-action-writes\.tsv/);
});

test('controller gate: all three gated scripts refuse, each naming its own endpoint', () => {
  for (const [script, action] of [
    ['plot-dispatch.sh', 'dispatch'],
    ['plot-approve.sh', 'approve'],
    ['plot-deliver.sh', 'deliver'],
  ]) {
    const r = run(repo(), `bash skills/plot/scripts/${script} some-slug`);
    assert.equal(r.status, 2, `${script} must block`);
    assert.match(r.stderr, new RegExp(`POST /api/${action}`), `${script} names /api/${action}`);
  }
});

test('controller gate: a controller receipt clears the call', () => {
  const dir = repo();
  recordReceipt(dir, 'plot-dispatch.sh', 'some-slug');
  const r = run(dir, DISPATCH);
  assert.equal(r.status, 0, `must allow (stderr: ${r.stderr})`);
});

test('controller gate: a retry after a FAILED run is allowed on the same receipt', () => {
  // The receipt is spent by the SCRIPT's exit 0, not by the gate. A run that
  // died partway leaves it in place, and re-running is the documented repair.
  const dir = repo();
  recordReceipt(dir, 'plot-dispatch.sh', 'some-slug');
  assert.equal(run(dir, DISPATCH).status, 0, 'first call clears');
  assert.equal(run(dir, DISPATCH).status, 0, 'the retry clears on the same receipt');
});

test('controller gate: a second run after a SUCCESSFUL one is refused', () => {
  const dir = repo();
  recordReceipt(dir, 'plot-dispatch.sh', 'some-slug');
  assert.equal(run(dir, DISPATCH).status, 0);
  spendReceipt(dir, 'plot-dispatch.sh');   // what the script does on exit 0
  assert.equal(run(dir, DISPATCH).status, 2, 'the licence covered one completed action');
});

test('controller gate: a receipt licenses only the script it names', () => {
  const dir = repo();
  recordReceipt(dir, 'plot-dispatch.sh', 'some-slug');
  assert.equal(run(dir, 'bash skills/plot/scripts/plot-deliver.sh some-slug').status, 2);
});

test('controller gate: a call from inside a dispatch worktree is allowed', () => {
  // Without this every dispatched worker breaks: a worker is a `claude -p`
  // process inheriting these same hooks, and it holds no receipt.
  const dir = repo();
  const desk = path.join(dir, '.worktrees', 'feature-x');
  execSync(`git worktree add -q --detach "${desk}"`, { cwd: dir, stdio: 'pipe' });
  const r = run(desk, DISPATCH);
  assert.equal(r.status, 0, `a desk is exempt (stderr: ${r.stderr})`);
});

test('controller gate: the exemption reads the working directory, never an env var', () => {
  // An env var is something an agent SETS, and this gate exists because a
  // master agent's own assertions cannot be trusted.
  const dir = repo();
  const r = spawnSync('bash', [gate], {
    cwd: dir,
    input: JSON.stringify({ tool_input: { command: DISPATCH } }),
    encoding: 'utf8',
    env: { ...process.env, PLOT_WORKER: '1', PLOT_BRANCH: 'feature/x', PLOT_SLUG: 'x' },
  });
  assert.equal(r.status, 2, 'asserting worker-hood does not clear the gate');
});

test('controller gate: a read-only script is never gated', () => {
  const dir = repo();
  for (const cmd of [
    'bash skills/plot/scripts/plot-fleet-scan.sh',
    'bash skills/plot/scripts/plot-reconcile-scan.sh',
    'bash skills/plot/scripts/plot-pr-state.sh some-slug',
  ]) {
    assert.equal(run(dir, cmd).status, 0, `${cmd} must run with no receipt and no board`);
  }
});

test('controller gate: dispatch modes with no endpoint are not gated', () => {
  // A refusal must name a route. `--stop`, `--restart`, `--start` and
  // `--migrate` have no endpoint, and `plot-fleetctl.sh --stop` calls
  // `plot-dispatch.sh --stop` per agent — gating it would break the fleet's own
  // orchestration to point at nothing.
  const dir = repo();
  for (const mode of ['--status', '--dry-run some-slug', '--stop feature/x',
                      '--restart feature/x', '--start 3', '--migrate']) {
    assert.equal(run(dir, `bash skills/plot/scripts/plot-dispatch.sh ${mode}`).status, 0,
      `--${mode} names no endpoint, so it is not gated`);
  }
});

test('controller gate: gh and git are not gated', () => {
  const dir = repo();
  for (const cmd of ['gh pr merge 123 --squash', 'git push origin HEAD:main']) {
    assert.equal(run(dir, cmd).status, 0, `${cmd} has no endpoint to name`);
  }
});

test('controller gate: it fails OPEN with no .plot/state, and says so', () => {
  const dir = repo();
  rmSync(path.join(dir, '.plot', 'state'), { recursive: true, force: true });
  const r = run(dir, DISPATCH);
  assert.equal(r.status, 0, 'an unconfigured repository still dispatches');
  assert.match(r.stderr, /UNVERIFIED/, 'failing open, not failing silently');
});

test('controller gate: it fails open outside a git repository, and says so', () => {
  const bare = mkdtempSync(path.join(tmpdir(), 'plot-controller-gate-nogit-'));
  const r = run(bare, DISPATCH);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /UNVERIFIED/);
});

test('controller gate: unparseable hook JSON allows', () => {
  const r = spawnSync('bash', [gate], { cwd: repo(), input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
});

test('controller gate: the escape records its reason and clears the call', () => {
  const dir = repo();
  const r = spawnSync('bash',
    [receipt, '--unowned-action', 'dispatch', 'some-slug', 'no board on this machine'],
    { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `the escape must succeed (stderr: ${r.stderr})`);

  const log = path.join(dir, '.plot', 'state', 'unowned-action-writes.tsv');
  assert.ok(existsSync(log), 'the escape is counted');
  const line = readFileSync(log, 'utf8').trim();
  assert.match(line, /dispatch\tsome-slug\tno board on this machine/,
    'the reason is recorded, because an uncounted escape is an off switch');

  assert.equal(run(dir, DISPATCH).status, 0, 'and it clears the gate');
});

test('controller gate: the escape refuses without a reason', () => {
  const dir = repo();
  const r = spawnSync('bash', [receipt, '--unowned-action', 'dispatch', 'some-slug'],
    { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2, 'the reason is required');
  assert.equal(existsSync(path.join(dir, '.plot', 'state', 'unowned-action-writes.tsv')), false);
});

test('controller gate: the escape refuses an action no controller owns', () => {
  const r = spawnSync('bash',
    [receipt, '--unowned-action', 'release', 'x', 'because'], { cwd: repo(), encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not a controller-owned action/);
});

test('controller gate: the path the board writes is the path the gate reads', () => {
  // THE TWO WRITERS MUST AGREE ON ONE PATH. `recordActionReceipt` (TypeScript,
  // called by the three endpoints) and `record_action_receipt` (bash, called by
  // the escape) write the same file, and `plot-controller-gate.sh` reads it.
  // The receipt is named for the ACTION, not the script: the board writes
  // these too, and `check-script-names.sh` refuses a `plot-*.sh` literal
  // outside an adapter. The TS half is asserted against the SOURCE rather than
  // imported, because
  // `node --test` loads no TypeScript — and a dynamic import that silently
  // no-ops is a test that cannot fail. The board's own suite exercises the
  // function; this pins the one string the two spellings must share.
  const dir = repo();
  recordReceipt(dir, 'plot-dispatch.sh', 'some-slug');
  const written = path.join(dir, '.plot', 'state', 'action-receipts', 'dispatch');
  assert.ok(existsSync(written), 'the shell writer puts it here');

  const ts = readFileSync(
    path.join(here, '..', '..', 'packages', 'board', 'src', 'server', 'action-receipt.ts'), 'utf8');
  assert.match(ts, /'\.plot',\s*'state',\s*'action-receipts'/,
    'and the board writer joins the same three segments');
  assert.equal(run(dir, DISPATCH).status, 0, 'which is what the gate reads');
});
