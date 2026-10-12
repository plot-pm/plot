// Contract test for skills/plot/scripts/plot-state-gate.sh — the lifecycle-field
// gate. Builds throwaway git repos to pin what it refuses and what it lets
// through: a hand-written transition blocks and names its command, a creation
// from a template passes, an unchanged State: line passes, and an owning
// script's receipt clears exactly one commit.
//
// THE RECEIPT IS EXERCISED THROUGH THE SAME FILE THE OWNERS SOURCE. A test that
// wrote a receipt by hand would pin the gate's reader against a fixture rather
// than against the writer, which is the drift `plot-pr-merged.sh` was extracted
// to prevent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// EVERY TEMP PATH THIS FILE CREATES, REMOVED BY THE EXACT NAME `mkdtempSync`
// RETURNED. Measured 2026-09-30: this file left 21 directories behind. One
// `process.on('exit')` rather than a cleanup per case, so a new case is covered
// without remembering to add one. Never a glob over the shared temp directory.
// A FUNCTION DECLARATION HOLDING ITS OWN STATE, because `before()` hooks and
// helpers ABOVE this point call it. A function declaration is hoisted whole,
// but a `const` it closes over stays in the temporal dead zone until the
// module reaches it — measured here as `ReferenceError: Cannot access
// 'tempPaths' before initialization`. The list hangs off the function object,
// which exists from the first line of the module.
function trackTemp(dir) {
  (trackTemp.paths ??= []).push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of trackTemp.paths ?? []) rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const gate = path.join(scripts, 'plot-state-gate.sh');
const receipt = path.join(scripts, 'plot-state-receipt.sh');

const plan = (state) => `# P\n\n## Status\n\n- **State:** ${state}\n- **Type:** feature\n`;
const sprint = (state) => `# S\n\n## Status\n\n- **State:** ${state}\n- **Release:** 1.0.0\n`;

// A repo carrying one committed plan, plus whatever the case stages on top.
function repo({ files = {}, committed = {} } = {}) {
  const tmp = trackTemp(mkdtempSync(path.join(tmpdir(), 'plot-state-gate-')));
  const dir = path.join(tmp, 'repo');
  mkdirSync(dir, { recursive: true });
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');

  const write = (rel, body) => {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  for (const [rel, body] of Object.entries(committed)) write(rel, body);
  sh('git add -A && git commit -qm init --allow-empty');
  for (const [rel, body] of Object.entries(files)) write(rel, body);
  sh('git add -A');
  return dir;
}

function run(dir, command = 'git commit -m x') {
  const env = { ...process.env };
  delete env.PLOT_UNATTENDED;
  return spawnSync('bash', [gate], {
    cwd: dir,
    env,
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
  });
}

// The owner's half, through the file the owning scripts source.
function recordReceipt(dir, rel, value) {
  execSync(
    `. "${receipt}" && record_state_receipt "${path.join(dir, rel)}" "${value}"`,
    { cwd: dir, shell: '/bin/bash', stdio: 'pipe' },
  );
}

test('state gate: a hand-written plan transition is refused and names its command', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Approved') },
  });
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /Draft -> Approved/);
  assert.match(r.stderr, /\/plot-approve x/, 'the refusal names the command that owns the write');
});

test('state gate: Approved -> Delivered names /plot-deliver, not /plot-approve', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Approved') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Delivered') },
  });
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\/plot-deliver x/);
});

test('state gate: a hand-written sprint transition names /plot-sprint and its verb', () => {
  const dir = repo({
    committed: { 'docs/sprints/2026-W01-s.md': sprint('Committed') },
    files: { 'docs/sprints/2026-W01-s.md': sprint('Active') },
  });
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /\/plot-sprint s start/, 'Active is reached by `start`');
});

// 2026-09-08's actual input: `State: Planned`, a word the lifecycle does not
// have, written by hand. The gate cannot judge the word — that is
// setSprintState's answer — but it can refuse the writer, which is the whole
// claim: routed to the command, the word would have been refused by name.
test('state gate: a state no lifecycle admits is still refused as a hand edit', () => {
  const dir = repo({
    committed: { 'docs/sprints/2026-W01-s.md': sprint('Planning') },
    files: { 'docs/sprints/2026-W01-s.md': sprint('Planned') },
  });
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Planning -> Planned/);
});

test('state gate: a plan created from a template passes — a creation is not an edit', () => {
  const dir = repo({ files: { 'docs/plans/2026-01-02-new.md': plan('Draft') } });
  const r = run(dir);
  assert.equal(r.status, 0, `a new plan must commit (stderr: ${r.stderr})`);
});

test('state gate: a sprint created from a template passes', () => {
  const dir = repo({ files: { 'docs/sprints/2026-W02-new.md': sprint('Planning') } });
  const r = run(dir);
  assert.equal(r.status, 0, `a new sprint must commit (stderr: ${r.stderr})`);
});

// The common case by a wide margin: a plan gains a Started: record, a branch
// annotation, a Notes paragraph. The State: line rides along in the hunk and is
// not what changed.
test('state gate: an unchanged State line passes while the rest of the plan changes', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Approved') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Approved') + '\n## Notes\n\nmore\n' },
  });
  const r = run(dir);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

test('state gate: a file outside the plan and sprint directories is not its business', () => {
  const dir = repo({
    committed: { 'docs/notes.md': plan('Draft') },
    files: { 'docs/notes.md': plan('Approved') },
  });
  const r = run(dir);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

// A plan that QUOTES a status block to document the format — several in this
// repo do. The reader is scoped to the `## Status` section, so an illustration
// below it is prose, not a transition.
test('state gate: a State line outside the Status section is prose', () => {
  const quoted = (s) => `# P\n\n## Status\n\n- **State:** Draft\n\n## Format\n\n- **State:** ${s}\n`;
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': quoted('Approved') },
    files: { 'docs/plans/2026-01-01-x.md': quoted('Delivered') },
  });
  const r = run(dir);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

test('state gate: an owning script’s receipt clears the transition', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Approved') },
  });
  recordReceipt(dir, 'docs/plans/2026-01-01-x.md', 'Approved');
  const r = run(dir);
  assert.equal(r.status, 0, `the owner must pass (stderr: ${r.stderr})`);
});

// Draft -> Design is a person's move. `plot-needs-design.mjs` writes its receipt
// with the TypeScript `recordStateReceipt` in `entry/ladder.ts`, so this case
// calls that writer, not the shell `record_state_receipt` the owners above use.
test('state gate: Draft -> Design passes with the needs-design bundle’s receipt', async () => {
  const { recordStateReceipt } = await import(
    path.join(here, '..', '..', 'packages', 'board', 'src', 'server', 'entry', 'ladder.ts')
  );
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Design') },
  });
  recordStateReceipt(dir, 'docs/plans/2026-01-01-x.md', 'Design');
  assert.ok(existsSync(path.join(dir, '.plot', 'state', 'state-receipts')), 'the bundle writer left a receipt');
  const r = run(dir);
  assert.equal(r.status, 0, `the bundle's receipt must pass (stderr: ${r.stderr})`);
});

test('state gate: Draft -> Design is refused without a receipt and names needs-design', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Design') },
  });
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /Draft -> Design/);
  assert.match(r.stderr, /needs-design x/, 'the refusal names the command that owns the write');
});

// One approval licenses one commit. A receipt left behind would clear a `sed`
// over the same line a week later, which is the case this gate exists for.
test('state gate: a receipt is spent when it clears', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Approved') },
  });
  recordReceipt(dir, 'docs/plans/2026-01-01-x.md', 'Approved');
  assert.equal(run(dir).status, 0);
  assert.equal(run(dir).status, 2, 'the second commit has no receipt left');
});

// A receipt names a value, not a file. An owner that wrote Approved cannot
// clear a commit staging Delivered — which is the hand edit made after the
// script ran, the one shape a receipt can still catch.
test('state gate: a receipt for another value does not clear', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Delivered') },
  });
  recordReceipt(dir, 'docs/plans/2026-01-01-x.md', 'Approved');
  const r = run(dir);
  assert.equal(r.status, 2, `stderr: ${r.stderr}`);
});

test('state gate: a command that is not a commit is ignored', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Approved') },
  });
  assert.equal(run(dir, 'ls docs/plans').status, 0);
});

// `git add -A && git commit` stages AFTER this hook runs, so the index alone is
// not what the commit will contain. plot-phase-gate.sh reads the command for
// the same reason, and a gate that read only the index would miss the shape an
// agent types most often.
test('state gate: a commit that stages for itself is still read', () => {
  const dir = repo({ committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') } });
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-x.md'), plan('Approved'));
  const r = run(dir, 'git add -A && git commit -m x');
  assert.equal(r.status, 2, `stderr: ${r.stderr}`);
});

// A quote against the flag is still `-am`: the shell hands git `-amsg`.
test('state gate: -am with the message quoted against it takes the working copy', () => {
  for (const command of ['git commit -am"msg"', "git commit -am'msg'"]) {
    const dir = repo({ committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') } });
    writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-x.md'), plan('Approved'));
    const r = run(dir, command);
    assert.equal(r.status, 2, `${command} must block (stderr: ${r.stderr})`);
  }
});

// The shell expands a glob before git sees it, and a directory pathspec adds
// what it holds; read literally, neither names a file and the edit went through.
test('state gate: a chained git add of a glob or a directory is read', () => {
  for (const command of ['git add docs/plans/*.md && git commit -m x', 'git add docs/plans && git commit -m x']) {
    const dir = repo({ committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') } });
    writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-x.md'), plan('Approved'));
    const r = run(dir, command);
    assert.equal(r.status, 2, `${command} must block (stderr: ${r.stderr})`);
  }
});

test('state gate: a git add from a subdirectory with a .. pathspec is read', () => {
  const dir = repo({ committed: { 'docs/plans/2026-01-01-x.md': plan('Draft'), 'sub/keep.txt': 'k\n' } });
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-x.md'), plan('Approved'));
  const r = run(path.join(dir, 'sub'), 'git add ../docs/plans/2026-01-01-x.md && git commit -m x');
  assert.equal(r.status, 2, `stderr: ${r.stderr}`);
});

// A plain commit takes the index, not the working copy.
test('state gate: a staged transition is refused although the working copy is reverted', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Approved') },
  });
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-x.md'), plan('Draft'));
  const r = run(dir);
  assert.equal(r.status, 2, `stderr: ${r.stderr}`);
  assert.match(r.stderr, /Draft -> Approved/);
});

test('state gate: an unstaged State edit beside a staged Notes hunk passes a plain commit', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': `${plan('Draft')}\n## Notes\n\nA note.\n` },
  });
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-x.md'), `${plan('Approved')}\n## Notes\n\nA note.\n`);
  const r = run(dir);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

const noState = '# P\n\n## Status\n\n- **Type:** feature\n';

// #1611: removing the line and adding it back with another value in a second
// commit wrote any state with no receipt, because each half had no value to
// compare against.
test('state gate: removing a State line is a transition to none and is refused', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': noState },
  });
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /Draft -> \(line removed\)/);
});

test('state gate: adding a State line to a plan HEAD holds none for is refused', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': noState },
    files: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
  });
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /\(no State line\) -> Draft/);
});

test('state gate: the two-commit path of #1611 is refused at the second commit', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Design') },
    files: { 'docs/plans/2026-01-01-x.md': noState },
  });
  assert.equal(run(dir).status, 2, 'the removal is refused on its own');
  // The first commit lands by a route the gate does not see, then the add follows.
  execSync('git commit -qm removed --no-verify', { cwd: dir });
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-x.md'), plan('Draft'));
  execSync('git add -A', { cwd: dir });
  const r = run(dir);
  assert.equal(r.status, 2, `the re-add must block (stderr: ${r.stderr})`);
});

test('state gate: a rename to another date prefix with a changed State is refused', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Design') },
    files: { 'docs/plans/2026-02-02-x.md': plan('Approved') },
  });
  execSync('git rm -q docs/plans/2026-01-01-x.md', { cwd: dir });
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /Design -> Approved/);
  assert.match(r.stderr, /renamed from docs\/plans\/2026-01-01-x\.md/);
});

// The plan's Acceptance names this rename exactly: Design to Draft.
test('state gate: a rename of a Design plan to another date prefix with State: Draft is refused', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Design') },
    files: { 'docs/plans/2026-02-02-x.md': plan('Draft') },
  });
  execSync('git rm -q docs/plans/2026-01-01-x.md', { cwd: dir });
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /Design -> Draft, written by hand \(renamed from docs\/plans\/2026-01-01-x\.md\)/);
});

test('state gate: a rename that keeps the State passes', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Design') },
    files: { 'docs/plans/2026-02-02-x.md': plan('Design') },
  });
  execSync('git rm -q docs/plans/2026-01-01-x.md', { cwd: dir });
  const r = run(dir);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

test('state gate: a new plan beside an unrelated deletion still passes', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-old.md': plan('Delivered') },
    files: { 'docs/plans/2026-02-02-new.md': plan('Draft') },
  });
  execSync('git rm -q docs/plans/2026-01-01-old.md', { cwd: dir });
  const r = run(dir);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

test('state gate: a controller write carrying its receipt still passes after a rename', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Design') },
    files: { 'docs/plans/2026-02-02-x.md': plan('Approved') },
  });
  execSync('git rm -q docs/plans/2026-01-01-x.md', { cwd: dir });
  recordReceipt(dir, 'docs/plans/2026-02-02-x.md', 'Approved');
  const r = run(dir);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

// #1616 review H3: git pairs a delete and an add as a rename only above its
// similarity threshold. Below it the index holds `D` and `A`, and a gate that
// dropped the `D` read the new path as a creation.
test('state gate: a same-slug rename git does not pair is still refused', () => {
  const filler = (word) => Array.from({ length: 40 }, (_, i) => `${word} line ${i}`).join('\n');
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': `${plan('Design')}\n## Notes\n\n${filler('old')}\n` },
    files: { 'docs/plans/2026-02-02-x.md': `${plan('Approved')}\n## Notes\n\n${filler('new')}\n` },
  });
  execSync('git rm -q docs/plans/2026-01-01-x.md', { cwd: dir });
  const status = execSync('git diff --cached --name-status -M', { cwd: dir, encoding: 'utf8' });
  assert.match(status, /^D\tdocs\/plans\/2026-01-01-x\.md$/m, `the fixture must not pair (got: ${status})`);
  assert.match(status, /^A\tdocs\/plans\/2026-02-02-x\.md$/m);
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /Design -> Approved/);
  assert.match(r.stderr, /renamed from docs\/plans\/2026-01-01-x\.md/);
});

// --- index symlinks ---------------------------------------------------------
//
// #1616 review H1: `docs/plans/active/<slug>.md` and `delivered/<slug>.md` are
// symlinks. Git stores a symlink as its target path and carries no `State:`
// line, but a working-copy read follows the link and returns the plan's text.

const link = (dir, rel, target) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  symlinkSync(target, path.join(dir, rel));
};

test('state gate: a symlink added to the active index passes', () => {
  const dir = repo({ committed: { 'docs/plans/2026-01-01-x.md': plan('Approved') } });
  link(dir, 'docs/plans/active/x.md', '../2026-01-01-x.md');
  for (const command of ['git add -A && git commit -m x', 'git commit -am x']) {
    const r = run(dir, command);
    assert.equal(r.status, 0, `${command} (stderr: ${r.stderr})`);
  }
  execSync('git add -A', { cwd: dir });
  const r = run(dir);
  assert.equal(r.status, 0, `a staged symlink (stderr: ${r.stderr})`);
});

test('state gate: a symlink removed from the active index passes', () => {
  const dir = repo({ committed: { 'docs/plans/2026-01-01-x.md': plan('Approved') } });
  link(dir, 'docs/plans/active/x.md', '../2026-01-01-x.md');
  execSync('git add -A && git commit -qm link --no-verify', { cwd: dir });
  execSync('git rm -q docs/plans/active/x.md', { cwd: dir });
  for (const command of ['git commit -m x', 'git add -A && git commit -m x']) {
    const r = run(dir, command);
    assert.equal(r.status, 0, `${command} (stderr: ${r.stderr})`);
  }
});

// /plot-reject steps 4, 5 and 7, as SKILL.md writes them.
test('state gate: /plot-reject moving the symlink back with its receipted write passes', () => {
  const dir = repo({ committed: { 'docs/plans/2026-01-01-x.md': plan('Delivered') } });
  link(dir, 'docs/plans/delivered/x.md', '../2026-01-01-x.md');
  execSync('git add -A && git commit -qm delivered --no-verify', { cwd: dir });
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-x.md'), plan('Approved'));
  const e = unowned(dir, 'docs/plans/2026-01-01-x.md', 'Approved', '/plot-reject has no controller');
  assert.equal(e.status, 0, `escape must succeed (stderr: ${e.stderr})`);
  execSync('git rm -q docs/plans/delivered/x.md', { cwd: dir });
  link(dir, 'docs/plans/active/x.md', '../2026-01-01-x.md');
  execSync('git add docs/plans/active/x.md docs/plans/2026-01-01-x.md', { cwd: dir });
  const r = run(dir, 'git add docs/plans/ docs/sprints/ && git commit -m "plot: reject x"');
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

// The delivery's own write: the plan flips to Delivered under the owner's
// receipt and its symlink moves from active/ to delivered/.
test('state gate: a receipted delivery moving the symlink to delivered passes', () => {
  const dir = repo({ committed: { 'docs/plans/2026-01-01-x.md': plan('Approved') } });
  link(dir, 'docs/plans/active/x.md', '../2026-01-01-x.md');
  execSync('git add -A && git commit -qm approved --no-verify', { cwd: dir });
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-x.md'), plan('Delivered'));
  recordReceipt(dir, 'docs/plans/2026-01-01-x.md', 'Delivered');
  execSync('git rm -q docs/plans/active/x.md', { cwd: dir });
  link(dir, 'docs/plans/delivered/x.md', '../2026-01-01-x.md');
  const r = run(dir, 'git add -A && git commit -m "plot: deliver x"');
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

test('state gate: a symlink move beside a hand-written plan transition still refuses the plan', () => {
  const dir = repo({ committed: { 'docs/plans/2026-01-01-x.md': plan('Delivered') } });
  link(dir, 'docs/plans/delivered/x.md', '../2026-01-01-x.md');
  execSync('git add -A && git commit -qm delivered --no-verify', { cwd: dir });
  writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-x.md'), plan('Approved'));
  execSync('git rm -q docs/plans/delivered/x.md', { cwd: dir });
  link(dir, 'docs/plans/active/x.md', '../2026-01-01-x.md');
  const r = run(dir, 'git add -A && git commit -m x');
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /docs\/plans\/2026-01-01-x\.md\n {4}Delivered -> Approved/);
  assert.doesNotMatch(r.stderr, /active\/x\.md/, 'the symlink is not a transition');
});

// Fail-open on its own machinery: outside a git repository the gate can see no
// diff at all, so it allows rather than refusing every commit anywhere.
test('state gate: outside a git repository it allows', () => {
  const dir = trackTemp(mkdtempSync(path.join(tmpdir(), 'plot-state-gate-nogit-')));
  const r = run(dir);
  assert.equal(r.status, 0);
});

test('state gate: unparseable hook input allows', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Approved') },
  });
  const r = spawnSync('bash', [gate], { cwd: dir, input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
});

// --- the named escape ------------------------------------------------------
//
// Three writes have no owning script today: /plot-approve step 3b under
// `Review: in-session` or `ballot` (plot-approve.sh:190 refuses both by name),
// /plot-release writing `State: Released`, and /plot-reject running the
// lifecycle backwards. A gate refusing the only available method stops work
// rather than routing it — which is why this slice waited at all — so the
// escape is named, per-write, and RECORDED, in plot-dispatch.sh's
// `--allow-local` tradition.

function unowned(dir, rel, value, reason) {
  return spawnSync('bash', [receipt, '--unowned', rel, value, reason], {
    cwd: dir,
    encoding: 'utf8',
  });
}

test('state gate: the named escape clears a write no script owns', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Delivered') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Approved') },
  });
  assert.equal(run(dir).status, 2, 'refused before the escape');
  const e = unowned(dir, 'docs/plans/2026-01-01-x.md', 'Approved', '/plot-reject has no controller');
  assert.equal(e.status, 0, `escape must succeed (stderr: ${e.stderr})`);
  assert.equal(run(dir).status, 0, 'and cleared after it');
});

// The escape is countable, which is the whole difference between a visible gap
// and a gate that is turned off. Each use is one line naming a routing gap the
// later slices of the-master-agent-uses-the-controllers close.
test('state gate: the escape records the gap it names', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Delivered') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Approved') },
  });
  unowned(dir, 'docs/plans/2026-01-01-x.md', 'Approved', 'Review: in-session');
  const log = path.join(dir, '.plot', 'state', 'unowned-state-writes.tsv');
  assert.ok(existsSync(log), 'the escape writes a log');
  assert.match(readFileSync(log, 'utf8'), /Review: in-session/);
});

test('state gate: the escape refuses without a reason', () => {
  const dir = repo({ committed: { 'docs/plans/2026-01-01-x.md': plan('Delivered') } });
  const r = spawnSync('bash', [receipt, '--unowned', 'docs/plans/2026-01-01-x.md', 'Approved'], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(r.status, 2, 'a gap nobody wrote down is one nobody closes');
  assert.match(r.stderr, /reason/);
});

test('state gate: the escape is spent like any other receipt', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Delivered') },
    files: { 'docs/plans/2026-01-01-x.md': plan('Approved') },
  });
  unowned(dir, 'docs/plans/2026-01-01-x.md', 'Approved', 'r');
  assert.equal(run(dir).status, 0);
  assert.equal(run(dir).status, 2, 'one escape licenses one commit');
});

// Sourcing must never execute the escape: the three owning scripts source this
// file and pass no arguments, and a bare $1 under `set -u` would abort them at
// load — with plot-approve.sh's own `set -uo pipefail` in force.
test('state gate: the receipt file is safe to source under set -u', () => {
  const r = spawnSync('bash', ['-c', `set -euo pipefail; . "${receipt}"; echo ok`], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /ok/);
});

// --- the spike approval is a second transition with its own receipt key -----
const spikePlan = (state, spike = '') =>
  `# P\n\n## Status\n\n- **State:** ${state}\n${spike ? `- **Spike approved:** ${spike}\n` : ''}- **Type:** feature\n`;
const SPIKE_PATH = 'docs/plans/2026-01-01-x.md';
const SPIKE_RECORD = '2026-10-12, jwloka, in-session';

// A receipt under an arbitrary key, written the way `record_state_receipt` does:
// the file is named by the git blob oid of the whole key string.
const recordKeyedReceipt = (dir, key, value) => {
  const oid = execSync('git hash-object --stdin', { cwd: dir, input: key, encoding: 'utf8' }).trim();
  const receipts = path.join(dir, '.plot', 'state', 'state-receipts');
  mkdirSync(receipts, { recursive: true });
  writeFileSync(path.join(receipts, oid), `${key}\t${value}\n`);
};

test('state gate: a hand-written Spike approved record is refused and names the spike command', () => {
  const dir = repo({
    committed: { [SPIKE_PATH]: spikePlan('Design') },
    files: { [SPIKE_PATH]: spikePlan('Design', SPIKE_RECORD) },
  });
  const r = run(dir);
  assert.equal(r.status, 2, `must block (stderr: ${r.stderr})`);
  assert.match(r.stderr, /plot-approve\.mjs --spike x/);
});

test('state gate: the spike receipt clears the record, once', () => {
  const dir = repo({
    committed: { [SPIKE_PATH]: spikePlan('Design') },
    files: { [SPIKE_PATH]: spikePlan('Design', SPIKE_RECORD) },
  });
  recordKeyedReceipt(dir, `${SPIKE_PATH}#Spike approved`, SPIKE_RECORD);
  assert.equal(run(dir).status, 0, 'the owner must pass');
  assert.equal(run(dir).status, 2, 'the receipt is spent');
});

test('state gate: a State receipt does not clear the spike record', () => {
  const dir = repo({
    committed: { [SPIKE_PATH]: spikePlan('Design') },
    files: { [SPIKE_PATH]: spikePlan('Design', SPIKE_RECORD) },
  });
  recordReceipt(dir, SPIKE_PATH, SPIKE_RECORD);
  assert.equal(run(dir).status, 2);
});

test('state gate: a spike receipt does not clear a State transition', () => {
  const dir = repo({
    committed: { [SPIKE_PATH]: spikePlan('Draft') },
    files: { [SPIKE_PATH]: spikePlan('Approved') },
  });
  recordKeyedReceipt(dir, `${SPIKE_PATH}#Spike approved`, 'Approved');
  assert.equal(run(dir).status, 2);
});

test('state gate: removing a Spike approved record is refused and no command owns it', () => {
  const dir = repo({
    committed: { [SPIKE_PATH]: spikePlan('Design', SPIKE_RECORD) },
    files: { [SPIKE_PATH]: spikePlan('Design') },
  });
  const r = run(dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No command removes/);
});
