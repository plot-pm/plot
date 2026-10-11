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
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, renameSync, rmSync, copyFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Every directory this file creates, removed after its last test by the exact
// path mkdtempSync returned — never by a glob over the shared temp directory.
const made = [];
const scratch = (prefix) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const gate = path.join(scripts, 'plot-controller-gate.sh');
const receipt = path.join(scripts, 'plot-state-receipt.sh');

/** A repository root — the master agent's position, where the gate bites. */
function repo() {
  const tmp = scratch('plot-controller-gate-');
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

test('controller gate: the dispatch refusal names the command bundle first, then the route, then the escape', () => {
  const r = run(repo(), DISPATCH);
  const bundle = r.stderr.indexOf('plot-dispatch-command.mjs');
  assert.ok(bundle >= 0, `names the bundle (stderr: ${r.stderr})`);
  assert.ok(bundle < r.stderr.indexOf('POST /api/dispatch'), 'the bundle comes before the HTTP route');
  assert.ok(bundle < r.stderr.indexOf('--unowned-action'), 'the bundle comes before the escape');
});

test('controller gate: the approve, deliver and release refusals name the endpoint first and no bundle (#1458)', () => {
  // The bundle the old text named is itself refused by this gate with no
  // receipt, so the first repair it printed was a second refusal.
  for (const [command, endpoint] of [
    ['bash skills/plot/scripts/plot-approve.sh some-slug', 'POST /api/approve {"slug":"<slug>"}'],
    ['bash skills/plot/scripts/plot-deliver.sh some-slug', 'POST /api/deliver {"slug":"<slug>"}'],
    ['bash skills/plot/scripts/plot-deliver.sh --release 1.2.3 some-slug', 'POST /api/release {"slug":"<slug>","version":"<version>"}'],
  ]) {
    const r = run(repo(), command);
    assert.equal(r.status, 2, `${command} must block`);
    const at = r.stderr.indexOf(endpoint);
    assert.ok(at >= 0, `${command} names ${endpoint}:\n${r.stderr}`);
    assert.ok(at < r.stderr.indexOf('--unowned-action'), 'the endpoint comes before the escape');
    assert.doesNotMatch(r.stderr, /\.mjs/, 'no bundle is named for this action');
    assert.match(r.stderr, /TWO calls/, 'the two-call order of the escape is named');
  }
});

test('controller gate: every command a refusal prints is itself allowed (#1458)', () => {
  const dir = repo();
  const printed = [];
  for (const [command, action] of [
    [DISPATCH, 'dispatch'],
    ['bash skills/plot/scripts/plot-approve.sh some-slug', 'approve'],
    ['bash skills/plot/scripts/plot-deliver.sh some-slug', 'deliver'],
    ['bash skills/plot/scripts/plot-deliver.sh --release 1.2.3 some-slug', 'release'],
  ]) {
    const r = run(dir, command);
    assert.equal(r.status, 2);
    const escape = escapeOf(r.stderr).cmd.replace('<slug>', 'some-slug').replace('"<reason>"', '"no board"');
    assert.equal(run(dir, escape).status, 0, `the escape printed for ${action} is allowed: ${escape}`);
    printed.push(escape);
    const bundle = r.stderr.split('\n').map((l) => l.trim()).find((l) => /^node .*\.mjs/.test(l));
    if (bundle) assert.equal(run(dir, bundle.replace('<slug>', 'some-slug')).status, 0, `the bundle line is allowed: ${bundle}`);
  }
  assert.equal(printed.length, 4);
});

test('controller gate: the two-call order works, and the chained form is refused', () => {
  const dir = repo();
  const r = run(dir, 'bash skills/plot/scripts/plot-approve.sh some-slug');
  const escape = escapeOf(r.stderr).cmd.replace('<slug>', 'some-slug').replace('"<reason>"', '"no board"');
  assert.equal(run(dir, `${escape} && bash skills/plot/scripts/plot-approve.sh some-slug`).status, 2,
    'a chained call is checked before the receipt exists');
  assert.equal(spawnSync('bash', ['-c', escape], { cwd: dir, encoding: 'utf8' }).status, 0, 'call 1 records the receipt');
  assert.equal(run(dir, 'bash skills/plot/scripts/plot-approve.sh some-slug').status, 0, 'call 2 clears');
});

test('controller gate: running the dispatch command bundle is not refused', () => {
  const r = run(repo(), 'node skills/plot/scripts/board/plot-dispatch-command.mjs some-slug');
  assert.equal(r.status, 0, `must allow (stderr: ${r.stderr})`);
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

// THE BUNDLE IS A SECOND NAME FOR THE SAME ACTION, since `plot-deliver.sh`
// became a launcher — a command running `node .../plot-deliver.mjs` directly
// must be refused exactly as the launcher call is, or an agent could walk
// around the controller simply by skipping the `.sh`.
test('controller gate: a direct call to the deliver bundle refuses, naming /api/deliver', () => {
  const r = run(repo(), 'node skills/plot/scripts/board/plot-deliver.mjs some-slug');
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /POST \/api\/deliver/);
});

test('controller gate: a deliver receipt clears the bundle call, the same receipt the launcher uses', () => {
  const dir = repo();
  recordReceipt(dir, 'plot-deliver.sh', 'some-slug');
  const r = run(dir, 'node skills/plot/scripts/board/plot-deliver.mjs some-slug');
  assert.equal(r.status, 0, `must allow (stderr: ${r.stderr})`);
});

// `plot-approve.sh` became a launcher in `approval-becomes-a-command`; its
// bundle is the same action and must be refused the same way.
test('controller gate: a direct call to the approve bundle refuses, naming /api/approve', () => {
  const r = run(repo(), 'node skills/plot/scripts/board/plot-approve.mjs some-slug');
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /POST \/api\/approve/);
});

test('controller gate: an approve receipt clears the bundle call, the same receipt the launcher uses', () => {
  const dir = repo();
  recordReceipt(dir, 'plot-approve.sh', 'some-slug');
  const r = run(dir, 'node skills/plot/scripts/board/plot-approve.mjs some-slug');
  assert.equal(r.status, 0, `must allow (stderr: ${r.stderr})`);
});

test('controller gate: --dry-run on the approve bundle is allowed, as on the launcher', () => {
  const r = run(repo(), 'node skills/plot/scripts/board/plot-approve.mjs --dry-run some-slug');
  assert.equal(r.status, 0, `must allow (stderr: ${r.stderr})`);
});

test('controller gate: --release on the bundle refuses naming /api/release, not /api/deliver', () => {
  const r = run(repo(), 'node skills/plot/scripts/board/plot-deliver.mjs --release 1.2.3 some-slug');
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /POST \/api\/release/);
});

// --- the gate test pair (an-in-session-approval-has-a-controller slice 2) ---
//
// `plot-deliver.sh --release` is a FOURTH action sharing a script `deliver`
// already names — it must be refused with no receipt, name `POST /api/release`
// rather than `/api/deliver`, and clear on a receipt filed under `release`
// rather than under `deliver`. `plot-approve.sh --who` is the same script and
// the same action the bare form already refuses, so it is refused the same way
// and clears on the same receipt.

const RELEASE = 'bash skills/plot/scripts/plot-deliver.sh --release 1.2.3 some-slug';
const APPROVE_WHO = 'bash skills/plot/scripts/plot-approve.sh --who jwloka some-slug';

test('controller gate: plot-deliver.sh --release is refused with no receipt and names /api/release', () => {
  const r = run(repo(), RELEASE);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /controller-owned action/);
  assert.match(r.stderr, /POST \/api\/release/, 'names /api/release, not /api/deliver');
  assert.doesNotMatch(r.stderr, /POST \/api\/deliver\b/);
});

test('controller gate: plot-approve.sh --who is refused with no receipt and names /api/approve', () => {
  const r = run(repo(), APPROVE_WHO);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /POST \/api\/approve/);
});

test('controller gate: a release receipt clears --release and NOT a bare deliver', () => {
  const dir = repo();
  recordReceipt(dir, 'release', 'some-slug');
  assert.equal(run(dir, RELEASE).status, 0, 'the release receipt clears --release');
  assert.equal(
    run(dir, 'bash skills/plot/scripts/plot-deliver.sh some-slug').status, 2,
    'a release receipt must not license a bare delivery of a different action',
  );
});

test('controller gate: a deliver receipt does not clear --release', () => {
  const dir = repo();
  recordReceipt(dir, 'plot-deliver.sh', 'some-slug');
  assert.equal(
    run(dir, RELEASE).status, 2,
    'a deliver receipt must not license a release — they are separate actions sharing one script',
  );
});

test('controller gate: an approve receipt clears --who', () => {
  const dir = repo();
  recordReceipt(dir, 'plot-approve.sh', 'some-slug');
  assert.equal(run(dir, APPROVE_WHO).status, 0);
});

test('controller gate: plot-dispatch.sh --release <branch> still clears with no receipt', () => {
  // The ONLY --release that keeps its old exemption: plot-dispatch.sh's
  // returns an abandoned claim to the queue and has no endpoint. Scoping the
  // exemption to this script is what plot-deliver.sh --release needed to stop
  // riding along on it.
  const r = run(repo(), 'bash skills/plot/scripts/plot-dispatch.sh --release feature/x');
  assert.equal(r.status, 0, `--release on plot-dispatch.sh still has no endpoint (stderr: ${r.stderr})`);
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
  // A refusal must name a route. `--stop`, `--restart`, `--start`,
  // `--migrate` and `--release` have no endpoint, and `plot-fleetctl.sh --stop` calls
  // `plot-dispatch.sh --stop` per agent — gating it would break the fleet's own
  // orchestration to point at nothing.
  const dir = repo();
  for (const mode of ['--status', '--dry-run some-slug', '--stop feature/x',
                      '--restart feature/x', '--start 3', '--migrate',
                      '--release feature/x']) {
    assert.equal(run(dir, `bash skills/plot/scripts/plot-dispatch.sh ${mode}`).status, 0,
      `--${mode} names no endpoint, so it is not gated`);
  }
});

test('controller gate: git push is not gated', () => {
  assert.equal(run(repo(), 'git push origin HEAD:main').status, 0);
});

// --- an unpinned merge (#1483 L5) -------------------------------------------

test('controller gate: gh pr merge without a head pin is refused, naming plot-ask.mjs merge', () => {
  for (const cmd of ['gh pr merge 123 --squash', 'bash skills/plot/scripts/plot-host.sh pr-merge 123']) {
    const r = run(repo(), cmd);
    assert.equal(r.status, 2, `${cmd} must block (stderr: ${r.stderr})`);
    assert.match(r.stderr, /plot-ask\.mjs merge <pr> <sha>/);
  }
});

test('controller gate: the same merge pinned with its own program\'s flag is allowed', () => {
  const dir = repo();
  for (const cmd of [
    'gh pr merge 123 --squash --match-head-commit abc123',
    'bash skills/plot/scripts/plot-host.sh pr-merge 123 --match-head abc123',
  ]) assert.equal(run(dir, cmd).status, 0, `${cmd} is pinned`);
});

test('controller gate: the refusal names the pin flag of the program refused (M6)', () => {
  const dir = repo();
  const gh = run(dir, 'gh pr merge 123 --match-head abc123');
  assert.equal(gh.status, 2, 'gh takes --match-head-commit, so --match-head pins nothing');
  assert.match(gh.stderr, /add --match-head-commit <sha>/);
  const host = run(dir, 'bash skills/plot/scripts/plot-host.sh pr-merge 123 --match-head-commit abc123');
  assert.equal(host.status, 2, 'plot-host.sh takes --match-head');
  assert.match(host.stderr, /add --match-head <sha>/);
  assert.doesNotMatch(host.stderr, /--match-head-commit/);
});

test('controller gate: an unpinned plot-host.sh pr-merge passes on bitbucket and says nothing pins there (M6)', () => {
  const dir = repo();
  const cmd = 'bash skills/plot/scripts/plot-host.sh pr-merge 123';
  const bb = spawnSync('bash', [gate], {
    cwd: dir, input: JSON.stringify({ tool_input: { command: cmd } }), encoding: 'utf8',
    env: { ...process.env, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(bb.status, 0, `bitbucket cannot pin (stderr: ${bb.stderr})`);
  assert.match(bb.stderr, /cannot pin a merge to a commit/);
  const gh = spawnSync('bash', [gate], {
    cwd: dir, input: JSON.stringify({ tool_input: { command: 'gh pr merge 123' } }), encoding: 'utf8',
    env: { ...process.env, PLOT_HOST: 'bitbucket' },
  });
  assert.equal(gh.status, 2, 'gh pr merge still pins with --match-head-commit');
});

test('controller gate: a commented pin and a command prefix do not hide an unpinned merge (LOW 7)', () => {
  const dir = repo();
  for (const cmd of ['gh pr merge 12 --squash # --match-head-commit abc', 'command gh pr merge 12', 'exec gh pr merge 12']) {
    assert.equal(run(dir, cmd).status, 2, `${cmd} merges unpinned`);
  }
});

test('controller gate: the merge command the refusal prints is allowed', () => {
  const dir = repo();
  const r = run(dir, 'gh pr merge 123 --squash');
  const printed = r.stderr.split('\n').map((l) => l.trim()).find((l) => /^node .*plot-ask\.mjs merge/.test(l));
  assert.ok(printed, `the refusal prints the controller command:\n${r.stderr}`);
  assert.equal(run(dir, printed.replace('<pr>', '123').replace('<sha>', 'abc123')).status, 0);
});

test('controller gate: an unpinned merge inside a dispatch worktree is allowed', () => {
  const dir = repo();
  const desk = path.join(dir, '.worktrees', 'feature-x');
  execSync(`git worktree add -q --detach "${desk}"`, { cwd: dir, stdio: 'pipe' });
  assert.equal(run(desk, 'gh pr merge 123 --squash').status, 0, 'a desk is exempt');
});

test('controller gate: gh pr view and a merge named in a commit message are not merges', () => {
  const dir = repo();
  for (const cmd of ['gh pr view 123', 'git commit -m "gh pr merge 123"', 'git grep -l "pr merge"']) {
    assert.equal(run(dir, cmd).status, 0, `${cmd} merges nothing`);
  }
});

// --- the reading gaps (#1341, #1449, comments) ------------------------------

test('controller gate: a for-loop word list that the body only reads is not an invocation (#1341)', () => {
  const dir = repo();
  assert.equal(run(dir, 'for f in plot-deliver.sh plot-approve.sh; do cmp $f /tmp/$f; done').status, 0);
  assert.equal(run(dir, 'for f in plot-deliver.sh; do git diff --stat -- $f; wc -l $f; done').status, 0);
  assert.equal(run(dir, 'for f in plot-deliver.sh; do bash $f x; done').status, 2, 'a body that runs $f is a run');
});

test('controller gate: a loop body that is not all readers keeps its word list (H3)', () => {
  const dir = repo();
  for (const cmd of [
    'for f in skills/plot/scripts/plot-deliver.sh; do timeout 600 bash $f s; done',
    'for f in plot-deliver.sh; do bash -e $f s; done',
    'for f in plot-deliver.sh; do eval "bash $f s"; done',
    'for f in plot-deliver.sh; do sudo $f s; done',
    'for f in plot-deliver.sh; do x=$f; bash $x s; done',
    'for f in plot-deliver.sh; do echo $f | xargs bash; done',
    'for f in plot-deliver.sh; do cat $(bash $f s); done',
  ]) {
    const r = run(dir, cmd);
    assert.equal(r.status, 2, `${cmd} must block (stderr: ${r.stderr})`);
  }
});

test('controller gate: a submodule is not a desk (H4)', () => {
  const tmp = scratch('plot-controller-gate-submodule-');
  const sh = (cwd, c) => execSync(c, { cwd, stdio: 'pipe' });
  const init = (dir) => {
    mkdirSync(dir, { recursive: true });
    sh(dir, 'git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
    sh(dir, 'git commit -qm init --allow-empty');
  };
  const mod = path.join(tmp, 'mod');
  const sup = path.join(tmp, 'super');
  init(mod);
  init(sup);
  sh(sup, `git -c protocol.file.allow=always submodule add -q "${mod}" mod`);
  const inner = path.join(sup, 'mod', 'inner');
  mkdirSync(inner, { recursive: true });
  mkdirSync(path.join(sup, 'mod', '.plot', 'state'), { recursive: true });
  const r = run(inner, 'bash skills/plot/scripts/plot-deliver.sh s');
  assert.equal(r.status, 2, `a submodule subdirectory is the master agent's position (stderr: ${r.stderr})`);
});

test('controller gate: --status on approve is a run, because approve has no --status mode (H2)', () => {
  const dir = repo();
  assert.equal(run(dir, 'bash skills/plot/scripts/plot-approve.sh --status some-slug').status, 2);
  assert.equal(run(dir, 'bash skills/plot/scripts/plot-deliver.sh --status some-slug').status, 0);
});

test('controller gate: the value after --who is not a mode (#1449)', () => {
  const dir = repo();
  assert.equal(run(dir, 'node skills/plot/scripts/board/plot-approve.mjs --who --dry-run some-slug').status, 2);
  assert.equal(run(dir, 'node skills/plot/scripts/board/plot-approve.mjs --dry-run some-slug').status, 0);
});

test('controller gate: an unquoted # comments out a named script, a quoted # does not', () => {
  const dir = repo();
  assert.equal(run(dir, 'git status # then plot-deliver.sh x').status, 0);
  assert.equal(run(dir, 'echo "a # b"; bash skills/plot/scripts/plot-deliver.sh x').status, 2);
});

test('controller gate: a .mjs glob resolves like a .sh glob', () => {
  assert.equal(run(repo(), 'node skills/plot/scripts/board/plot-appro?e.mjs some-slug').status, 2);
});

test('controller gate: it fails OPEN with no .plot/state, and says so', () => {
  const dir = repo();
  rmSync(path.join(dir, '.plot', 'state'), { recursive: true, force: true });
  const r = run(dir, DISPATCH);
  assert.equal(r.status, 0, 'an unconfigured repository still dispatches');
  assert.match(r.stderr, /UNVERIFIED/, 'failing open, not failing silently');
});

test('controller gate: it fails open outside a git repository, and says so', () => {
  const bare = scratch('plot-controller-gate-nogit-');
  const r = run(bare, DISPATCH);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /UNVERIFIED/);
});

// --- a missing bundle ALLOWS, and says so ------------------------------------
//
// The launcher shape `plot-state-gate.sh` set: exiting 2 here would block every
// Bash call, including the one that repairs the install.

/** A scratch copy of the gate's own checkout with NO bundle beside it. */
function gateCopy() {
  const tmp = scratch('plot-controller-gate-nobundle-');
  const dir = path.join(tmp, 'scripts');
  mkdirSync(path.join(dir, 'board'), { recursive: true });
  for (const f of [gate, receipt]) copyFileSync(f, path.join(dir, path.basename(f)));
  return { dir, bundle: path.join(dir, 'board', 'plot-gate.mjs') };
}

test('controller gate: a missing bundle allows, exit 0, naming the file and both remedies', () => {
  const { dir, bundle } = gateCopy();
  const r = spawnSync('bash', [path.join(dir, 'plot-controller-gate.sh')], {
    cwd: repo(), input: JSON.stringify({ tool_input: { command: DISPATCH } }), encoding: 'utf8',
  });
  assert.equal(r.status, 0, `must allow (stderr: ${r.stderr})`);
  assert.match(r.stderr, /UNVERIFIED/);
  assert.ok(r.stderr.includes(bundle), 'names the missing file');
  assert.match(r.stderr, /update the plot plugin/, 'names the plugin-update remedy');
  assert.match(r.stderr, /pnpm build:board/, 'names the local-build remedy');
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
  // `release` is a controller-owned action as of this slice — `reject` is the
  // word this estate uses for the one still unowned (`/plot-reject` writing
  // `Rejected:`/`Superseded:` has no controller), so it is the one this test
  // now names.
  const r = spawnSync('bash',
    [receipt, '--unowned-action', 'reject', 'x', 'because'], { cwd: repo(), encoding: 'utf8' });
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
    path.join(here, '..', '..', 'packages', 'fleet', 'src', 'shared', 'action-receipt.ts'), 'utf8');
  assert.match(ts, /'\.plot',\s*'state',\s*'action-receipts'/,
    'and the board writer joins the same three segments');
  assert.equal(run(dir, DISPATCH).status, 0, 'which is what the gate reads');
});

// ---------------------------------------------------------------------------
// THE RATCHET: no command refused today may be allowed after.
//
// This corpus lives in the test rather than in prose because a matching change
// to a refusal is the one place a single false negative costs more than every
// false positive removed. The gate's founding measurement is "five dispatches
// in one session went to this script directly, by the agent that had read the
// rule" — each of these is a way to spell one of those five.
//
// IT IS ALSO WHAT REFUSED COMMAND POSITION. A panel drove the gate with these
// shapes and found a loop body is not command position: `for s in a b; do
// plot-dispatch.sh $s; done` refuses here, and a command-position fix would
// have been blind to it. The corpus is the argument, so it is executable.
// ---------------------------------------------------------------------------

const D = 'skills/plot/scripts/plot-dispatch.sh';

const INVOCATIONS = [
  ['a plain call', `${D} slug`],
  ['a ./relative call', './plot-dispatch.sh slug'],
  ['an absolute path', `/opt/plot/${D} slug`],
  ['bash <script>', `bash ${D} slug`],
  ["sh -c '<script>'", `sh -c '${D} slug'`],
  ['env FOO=1 <script>', `env FOO=1 ${D} slug`],
  ['a for body', `for s in a b; do ${D} $s; done`],
  ['a while body', `while read s; do ${D} $s; done < list`],
  ['an if body', `if true; then ${D} slug; fi`],
  ['a { } group', `{ ${D} slug; }`],
  ['a ( ) subshell', `( ${D} slug )`],
  ['a $( ) substitution', `out=$(${D} slug)`],
  ['source', `source ${D} slug`],
  ['. (dot)', `. ${D} slug`],
  ['xargs', `echo slug | xargs ${D}`],
  ['find -exec', `find . -name x -exec ${D} {} \;`],
];

test('controller gate: every invocation shape in the corpus still refuses', () => {
  const dir = repo();
  const allowed = INVOCATIONS.filter(([, cmd]) => run(dir, cmd).status !== 2);
  assert.deepEqual(allowed.map(([label]) => label), [],
    'no command refused before the heredoc strip may be allowed after');
});

test('controller gate: a loop body refuses, which is why command position was refused', () => {
  // Named separately from the corpus sweep because it is the measurement that
  // reversed this plan's first answer. "Five dispatches in one session" is
  // written as a loop, and a loop body is not command position — so a
  // command-position gate would have missed the defect the gate exists for.
  const r = run(repo(), `for s in a b; do ${D} $s; done`);
  assert.equal(r.status, 2, 'a loop body is an invocation');
});

test('controller gate: a single-quoted heredoc body is data, not a command', () => {
  // THE CASE THIS SLICE IS NAMED FOR, in the reporter's own shape: a commit
  // message explaining which script performed a write. Renaming the script to
  // "the approval" in the prose let the identical commit through, so the gate
  // was buying nothing and costing the traceability CLAUDE.md asks for.
  //
  // THE SPELLING IS LOAD-BEARING. Measured 2026-09-17 against the pre-fix gate,
  // a body line ending `…by plot-dispatch.sh, which owns that write.` ALLOWED
  // already — the comma makes the token `plot-dispatch.sh,` and never a bare
  // match. That draft of this test passed on the old gate, so it pinned the
  // punctuation rather than the strip. The name is followed by a SPACE here,
  // which is the shape that refused.
  const dir = repo();
  const msg = [
    "git commit -F - <<'EOF'",
    'plot: record the delivery',
    '',
    `The State: field was written by ${D} and the receipt proves it.`,
    'EOF',
  ].join('\n');
  assert.equal(run(dir, msg).status, 0, 'a commit message may name the script that wrote a field');
});

test('controller gate: the body is data wherever the name sits in the line', () => {
  // Measured 2026-09-17 before the fix: followed by a space REFUSED, at end of
  // line REFUSED, followed by a period ALLOWED — the last only because the
  // token was `plot-dispatch.sh.` and never a bare match. Pinning one spelling
  // would have passed on the accident rather than on the strip.
  const dir = repo();
  for (const [label, body] of [
    ['followed by a space', `${D} wrote the field.`],
    ['at the end of a line', `the writer is ${D}`],
    ['followed by a period', `written by ${D}.`],
    ['alone on its line', `${D}`],
  ]) {
    const cmd = ["git commit -F - <<'EOF'", 'plot: record', '', body, 'EOF'].join('\n');
    assert.equal(run(dir, cmd).status, 0, `a name ${label} is still prose`);
  }
});

test('controller gate: an UNQUOTED heredoc body is still tokenised', () => {
  // `<<EOF` interpolates, so its body can carry a substitution that is a
  // command. Only the quoted form's contents are provably data, and that is the
  // whole licence for this change.
  const dir = repo();
  const cmd = ['git commit -F - <<EOF', 'plot: record', '', `written by ${D}`, 'EOF'].join('\n');
  assert.equal(run(dir, cmd).status, 2, 'an interpolating body keeps being read as commands');
});

test('controller gate: a heredoc body cannot smuggle a real invocation past the gate', () => {
  // The strip removes a BODY, never a command line. A dispatch sharing the
  // command with a heredoc still refuses — otherwise the fix would have opened
  // the evasion it was meant to close.
  const dir = repo();
  const cmd = [`${D} slug && git commit -F - <<'EOF'`, 'and we recorded it', 'EOF'].join('\n');
  assert.equal(run(dir, cmd).status, 2, 'a real call beside a heredoc is still a real call');
});

test('controller gate: a heredoc body cannot exempt a call by naming a mode', () => {
  // The mode check reads the command too. Measured 2026-09-17: before the strip
  // this ALLOWED, because `--dry-run` inside the body exempted the live call on
  // line 1. The scan tightens the gate here rather than loosening it.
  const dir = repo();
  const cmd = [`${D} slug && git commit -F - <<'EOF'`, 'we also ran --dry-run first', 'EOF'].join('\n');
  assert.equal(run(dir, cmd).status, 2, 'a mode word in prose is not a mode');
});

test('controller gate: a bare grep or sed read still refuses, on purpose', () => {
  // NOT FIXED, and the plan says so rather than implying a completeness it
  // refused. `controllerInvocation` carves out exactly the three reads #1245
  // measured — `ls`, `cat`, `git grep` — and no others; a bare `grep` or `sed`
  // naming a gated script is a known false positive, kept deliberately rather
  // than widened past what was measured.
  const dir = repo();
  for (const cmd of [`grep -c foo ${D}`, `sed -n '1,5p' ${D}`]) {
    assert.equal(run(dir, cmd).status, 2, `${cmd} is a known false positive, kept deliberately`);
  }
});

test('controller gate: ls, cat and git grep on a gated script are reads, not runs', () => {
  // FIXED by this slice (#1245): the token loop refused these because it had
  // no concept of program position. `controllerInvocation` does.
  const dir = repo();
  for (const cmd of [`ls ${D}`, `cat ${D}`, `git grep -l plot-dispatch.sh -- '*.sh'`]) {
    assert.equal(run(dir, cmd).status, 0, `${cmd} is a read, not a run`);
  }
});

test('controller gate: the `bash <script>` form its own callers use still refuses', () => {
  // `test/reconcile/controller-gate.test.mjs` and `plot-install-hooks.sh:246`
  // both drive the gate this way; both must behave as today.
  assert.equal(run(repo(), DISPATCH).status, 2);
});

// --- the escape names a script that exists where the gate runs --------------
//
// On a plugin install the gate runs from the plugin cache and the repository
// has no `skills/`, so a repo-relative escape names nothing. Every test above
// runs the gate from this checkout, where that relative path also resolves;
// this one copies the gate somewhere else, with a space in the path, and fires
// it from a repository that has no `skills/` directory at all.

/**
 * The gate, its receipt script and the gate bundle, copied as a plugin
 * install ships them: `board/` beside the gate, same as `skills/plot/scripts/`.
 */
function pluginCopy() {
  const tmp = scratch('plot-controller-gate-plugin-');
  const dir = path.join(tmp, 'plugin cache', 'plot', '9.9.9', 'scripts');
  mkdirSync(path.join(dir, 'board'), { recursive: true });
  for (const f of [gate, receipt]) copyFileSync(f, path.join(dir, path.basename(f)));
  copyFileSync(path.join(scripts, 'board', 'plot-gate.mjs'), path.join(dir, 'board', 'plot-gate.mjs'));
  return dir;
}

/** The escape line the refusal printed, with the command's words as bash reads them. */
function escapeOf(stderr) {
  const line = stderr.split('\n').find((l) => /--unowned-action /.test(l))?.replace(/^\s*\d+\.\s+/, '');
  assert.ok(line, `the refusal prints an escape line:\n${stderr}`);
  const cmd = line.trim();
  const words = spawnSync('bash', ['-c', `printf '%s\\n' ${cmd.replace(/<slug>/, 's').replace(/"<reason>"/, 'r')}`],
    { encoding: 'utf8' }).stdout.trim().split('\n');
  return { cmd, words };
}

test('controller gate: from a plugin copy, the escape names the receipt script beside the gate', () => {
  const copy = pluginCopy();
  const dir = repo();
  assert.ok(!existsSync(path.join(dir, 'skills')), 'the fixture repository has no skills/');
  const r = spawnSync('bash', [path.join(copy, 'plot-controller-gate.sh')], {
    cwd: dir, input: JSON.stringify({ tool_input: { command: DISPATCH } }), encoding: 'utf8',
  });
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  const { words } = escapeOf(r.stderr);
  assert.equal(words[0], 'bash');
  assert.equal(realpathSync(words[1]), realpathSync(path.join(copy, 'plot-state-receipt.sh')), 'the path is the copy beside the gate, one word');
  assert.ok(existsSync(words[1]), `the printed path exists: ${words[1]}`);
});

test('controller gate: the printed escape runs, from a path with a space, and is counted', () => {
  const copy = pluginCopy();
  const dir = repo();
  const r = spawnSync('bash', [path.join(copy, 'plot-controller-gate.sh')], {
    cwd: dir, input: JSON.stringify({ tool_input: { command: DISPATCH } }), encoding: 'utf8',
  });
  const { cmd } = escapeOf(r.stderr);
  const filled = cmd.replace('<slug>', 'some-slug').replace('"<reason>"', '"the board is not running"');
  const log = path.join(dir, '.plot', 'state', 'unowned-action-writes.tsv');
  const before = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
  const ran = spawnSync('bash', ['-c', filled], { cwd: dir, encoding: 'utf8' });
  assert.equal(ran.status, 0, `the copied command runs: ${filled}\n${ran.stderr}`);
  const after = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  assert.equal(after.length, before + 1, 'the escape is counted');
  assert.match(after.at(-1), /the board is not running/);
});
