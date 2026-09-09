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
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const gate = path.join(scripts, 'plot-state-gate.sh');
const receipt = path.join(scripts, 'plot-state-receipt.sh');

const plan = (state) => `# P\n\n## Status\n\n- **State:** ${state}\n- **Type:** feature\n`;
const sprint = (state) => `# S\n\n## Status\n\n- **State:** ${state}\n- **Release:** 1.0.0\n`;

// A repo carrying one committed plan, plus whatever the case stages on top.
function repo({ files = {}, committed = {} } = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plot-state-gate-'));
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
  return spawnSync('bash', [gate], {
    cwd: dir,
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

test('state gate: a deleted State line is not a transition', () => {
  const dir = repo({
    committed: { 'docs/plans/2026-01-01-x.md': plan('Draft') },
    files: { 'docs/plans/2026-01-01-x.md': '# P\n\n## Status\n\n- **Type:** feature\n' },
  });
  const r = run(dir);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
});

// Fail-open on its own machinery: outside a git repository the gate can see no
// diff at all, so it allows rather than refusing every commit anywhere.
test('state gate: outside a git repository it allows', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plot-state-gate-nogit-'));
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
