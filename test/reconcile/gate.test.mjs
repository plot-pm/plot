// Contract test for skills/plot/scripts/plot-phase-gate.sh — the phase gate.
// Builds throwaway git repos to pin: blocks impl commits on Draft plans,
// allows plan-only commits, approved plans, unplanned branches, and
// fails open on malformed input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-phase-gate.sh');

// The gate reads the plan from origin/<main>, so a fixture without a remote
// exercises the fail-open path, not the gate. Every fixture here therefore gets
// a real bare origin and pushes the plan to it: `planPhase` is the phase as
// SHARED, which is the only phase the gate is allowed to act on.
//
// `localPhase` overwrites the plan in the working tree AFTER the push, without
// pushing — the local-only edit that must not change the gate's answer.
// `noRemote` drops the remote entirely, for the offline/fail-open tests.
function repoWith({
  branch, planPhase, stage, unstaged = [], extraPlans = {},
  localPhase = null, noRemote = false,
}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plot-gate-'));
  const dir = path.join(tmp, 'repo');
  mkdirSync(dir, { recursive: true });
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  writeFileSync(path.join(dir, 'README.md'), 'x');

  const slug = branch.includes('/') ? branch.split('/')[1] : branch;
  const planPath = path.join(dir, 'docs', 'plans', `2026-01-01-${slug}.md`);
  const planBody = (phase) => `# P\n\n## Status\n\n- **Phase:** ${phase}\n- **Type:** feature\n`;
  if (planPhase) {
    mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    writeFileSync(planPath, planBody(planPhase));
  }
  for (const [name, phase] of Object.entries(extraPlans)) {
    mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'plans', name), planBody(phase));
  }
  sh('git add -A && git commit -qm init');

  // The shared ref: a bare origin holding exactly what was committed above.
  if (!noRemote) {
    const origin = path.join(tmp, 'origin.git');
    execSync(`git init --bare -q -b main "${origin}"`, { cwd: tmp, stdio: 'pipe' });
    sh(`git remote add origin "${origin}" && git push -q origin main`);
    sh('git remote set-head origin main');
  }

  sh(`git checkout -qb ${branch}`);
  // A local-only phase change: committed here, never pushed.
  if (localPhase) {
    writeFileSync(planPath, planBody(localPhase));
    sh('git add -A && git commit -qm "local-only phase change"');
  }

  for (const f of stage) {
    const full = path.join(dir, f);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, 'y');
  }
  sh('git add -A');
  for (const f of unstaged) {
    const full = path.join(dir, f);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, 'z');
  }
  return dir;
}

// stderr is captured on BOTH paths: the hook's most important message — "phase
// unverified, allowing the commit" — rides an exit 0, so a helper that only
// kept stderr from the failure path could not see the difference between
// failing open and failing silently.
function runGate(cwd, command = 'git commit -m x') {
  const input = JSON.stringify({ tool_input: { command } });
  const r = spawnSync('bash', [gate], { cwd, input, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('gate: blocks impl commit on Draft plan', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Draft', stage: ['src/a.js'] });
  const r = runGate(dir);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /still Draft/);
});

test('gate: allows plan-only commit on Draft plan', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Draft', stage: [] });
  assert.equal(runGate(dir).code, 0);
});

test('gate: allows impl commit on Approved plan', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Approved', stage: ['src/a.js'] });
  assert.equal(runGate(dir).code, 0);
});

test('gate: allows unplanned branch (no plan file)', () => {
  const dir = repoWith({ branch: 'feature/quickfix', planPhase: null, stage: ['src/a.js'] });
  assert.equal(runGate(dir).code, 0);
});

test('gate: ignores non-commit commands', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Draft', stage: ['src/a.js'] });
  assert.equal(runGate(dir, 'git status').code, 0);
});

test('gate: compound git add -A && git commit is caught (index empty)', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Draft', stage: [], unstaged: ['src/a.js'] });
  const r = runGate(dir, 'git add -A && git commit -m x');
  assert.equal(r.code, 2);
});

test('gate: git commit -a stages tracked modifications — caught', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Draft', stage: ['src/a.js'] });
  execSync('git commit -qm setup', { cwd: dir });
  writeFileSync(path.join(dir, 'src', 'a.js'), 'modified');
  const r = runGate(dir, 'git commit -am x');
  assert.equal(r.code, 2);
});

test('gate: git add of only the plan file passes', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Draft', stage: [], unstaged: [] });
  const r = runGate(dir, 'git add docs/plans/2026-01-01-x.md && git commit -m x');
  assert.equal(r.code, 0);
});

test('gate: suffix-colliding plan slug does not false-block', () => {
  // branch feature/x, its own plan Approved; unrelated Draft plan *-refactor-x.md
  const dir = repoWith({
    branch: 'feature/x', planPhase: 'Approved', stage: ['src/a.js'],
    extraPlans: { '2026-03-01-refactor-x.md': 'Draft' },
  });
  assert.equal(runGate(dir).code, 0);
});

test('gate: blocks branch under explicit .plot/hold', () => {
  const dir = repoWith({ branch: 'TICKET-123-work', planPhase: null, stage: ['src/a.js'] });
  mkdirSync(path.join(dir, '.plot'), { recursive: true });
  writeFileSync(path.join(dir, '.plot', 'hold'), 'TICKET-123-work review pending\n');
  const r = runGate(dir);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /review hold/);
});

test('gate: hold is exact string match — prefixes and regex chars never cross-match', () => {
  // prefix entry must not match the longer branch
  const a = repoWith({ branch: 'TICKET-123-work', planPhase: null, stage: ['src/a.js'] });
  mkdirSync(path.join(a, '.plot'), { recursive: true });
  writeFileSync(path.join(a, '.plot', 'hold'), 'TICKET-123 review pending\n');
  assert.equal(runGate(a).code, 0);
  // dot in a DIFFERENT branch's entry must not wildcard-match this branch
  const b = repoWith({ branch: 'hotfix-1.2', planPhase: null, stage: ['src/a.js'] });
  mkdirSync(path.join(b, '.plot'), { recursive: true });
  writeFileSync(path.join(b, '.plot', 'hold'), 'hotfix-1x2 review pending\n');
  assert.equal(runGate(b).code, 0);
  // and the branch's own dotted entry must fire
  writeFileSync(path.join(b, '.plot', 'hold'), 'hotfix-1.2 review pending\n');
  assert.equal(runGate(b).code, 2);
});

test('gate: hold lets story/plan-only commits pass, incl. sub-unit story homes', () => {
  const dir = repoWith({ branch: 'TICKET-9-x', planPhase: null, stage: [] });
  mkdirSync(path.join(dir, '.plot'), { recursive: true });
  writeFileSync(path.join(dir, '.plot', 'hold'), 'TICKET-9-x plan in review\n');
  const r = runGate(dir, 'git add docs/stories/s/STORY-s.md clients/acme/stories/s/STORY-s.md && git commit -m x');
  assert.equal(r.code, 0);
});

test('gate: fails open on malformed input', () => {
  const dir = repoWith({ branch: 'feature/x', planPhase: 'Draft', stage: ['src/a.js'] });
  const r = (() => {
    try {
      execFileSync('bash', [gate], { cwd: dir, input: 'not json', encoding: 'utf8' });
      return { code: 0 };
    } catch (e) { return { code: e.status }; }
  })();
  assert.equal(r.code, 0);
});

// --- The gate reads what was SHARED, not what is in the working tree --------
//
// Both directions were reproduced in a sandbox 2026-08-18. The working tree is
// the least trustworthy surface in a repo with several agents in it: it carries
// whatever branch was last checked out plus whatever is uncommitted, and
// neither is a fact anyone else shares.

test('gate: a local-only approval does not open the gate', () => {
  // The serious direction. Draft on origin/main, Approved only on this branch
  // and never pushed. Manifesto P2 is "plans are approved before
  // implementation" — a gate that accepts an approval nobody else can see
  // enforces "someone typed Approved in this filesystem" instead.
  const dir = repoWith({
    branch: 'feature/x', planPhase: 'Draft', localPhase: 'Approved',
    stage: ['src/a.js'],
  });
  const r = runGate(dir);
  assert.equal(r.code, 2, 'an unpushed approval must not open the gate');
  assert.match(r.stderr, /still Draft/);
  // The refusal names the ref it read, so the operator knows where to look.
  assert.match(r.stderr, /origin\/main/);
});

test('gate: a shared approval is not hidden by a local Draft copy', () => {
  // The mirror direction: Approved on origin/main, an older Draft copy on the
  // checked-out branch. Refusing here is how correctly-approved work got
  // blocked three times in one session.
  const dir = repoWith({
    branch: 'feature/x', planPhase: 'Approved', localPhase: 'Draft',
    stage: ['src/a.js'],
  });
  assert.equal(runGate(dir).code, 0, 'a shared approval must not be hidden by a local copy');
});

test('gate: offline — allows the commit AND says the phase went unverified', () => {
  // A PreToolUse hook that refused every commit when origin/<main> is
  // unreadable would make the repo unusable offline, and the fail-open is a
  // deliberate property. But a silent allow is indistinguishable from a gate
  // that ran and passed, so it must SAY the gate did not run. Both halves are
  // the contract; testing only the exit code would let the line rot away.
  const dir = repoWith({
    branch: 'feature/x', planPhase: 'Draft', stage: ['src/a.js'], noRemote: true,
  });
  const r = runGate(dir);
  assert.equal(r.code, 0, 'offline must not block the commit');
  assert.match(r.stderr ?? '', /phase unverified/,
    'failing open silently is the failure mode this line exists to prevent');
  assert.match(r.stderr ?? '', /git fetch/, 'it must say how to restore the gate');
  // Name what could not be read — an operator must not have to guess.
  assert.match(r.stderr ?? '', /cannot read origin\/main/);
});

// `Impl: same branch` puts the plan ON THE WORK BRANCH — it is never on
// origin/<main>, by design. The plan for this fix assumed plans live on the
// shared default branch; this flow is the case it did not anticipate. For it,
// "approved where everyone can see it" means the shared copy of THIS branch.
function repoSameBranch({ branch, sharedPhase, localPhase = null, push = true }) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'plot-gate-sb-'));
  const dir = path.join(tmp, 'repo');
  mkdirSync(dir, { recursive: true });
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  const slug = branch.split('/')[1];
  const planBody = (phase) => `# P\n\n## Status\n\n- **Phase:** ${phase}\n- **Type:** feature\n- **Impl:** here, same branch\n`;

  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  writeFileSync(path.join(dir, 'README.md'), 'x');
  sh('git add -A && git commit -qm init');
  const origin = path.join(tmp, 'origin.git');
  execSync(`git init --bare -q -b main "${origin}"`, { cwd: tmp, stdio: 'pipe' });
  sh(`git remote add origin "${origin}" && git push -q origin main`);
  sh('git remote set-head origin main');

  // The plan rides the work branch, and is never on main.
  sh(`git checkout -qb ${branch}`);
  mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  const planPath = path.join(dir, 'docs', 'plans', `2026-01-01-${slug}.md`);
  writeFileSync(planPath, planBody(sharedPhase));
  sh('git add -A && git commit -qm plan');
  if (push) sh(`git push -q origin ${branch}`);
  if (localPhase) {
    writeFileSync(planPath, planBody(localPhase));
    sh('git add -A && git commit -qm "local-only phase change"');
  }

  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'a.js'), 'y');
  sh('git add -A');
  return dir;
}

test('gate: same-branch flow — Draft on the shared branch still blocks', () => {
  // The plan is on origin/feature/x, not origin/main. Reading only origin/main
  // would find no plan and stop gating this flow entirely.
  const dir = repoSameBranch({ branch: 'feature/x', sharedPhase: 'Draft' });
  const r = runGate(dir);
  assert.equal(r.code, 2, 'a shared Draft plan on the work branch must still block');
  assert.match(r.stderr, /still Draft/);
});

test('gate: same-branch flow — Approved on the shared branch unblocks', () => {
  const dir = repoSameBranch({ branch: 'feature/x', sharedPhase: 'Approved' });
  assert.equal(runGate(dir).code, 0);
});

test('gate: same-branch flow — a local-only approval still does not open the gate', () => {
  // Draft on origin/feature/x, Approved only in a local commit. The same-branch
  // fallback must not become a loophole: it is still a SHARED ref.
  const dir = repoSameBranch({
    branch: 'feature/x', sharedPhase: 'Draft', localPhase: 'Approved',
  });
  const r = runGate(dir);
  assert.equal(r.code, 2, 'the same-branch ref must be the shared one, not the local one');
  assert.match(r.stderr, /still Draft/);
});

test('gate: an unshared plan allows the commit and says the phase went unverified', () => {
  // Bootstrap: /plot-idea wrote a plan and nothing has been pushed yet. The
  // plan is on no shared ref, so nothing was verified — but an unshared plan is
  // not evidence of a Draft either, and this hook must not block a repo out of
  // its own bootstrap. Allow, and say so.
  const dir = repoSameBranch({ branch: 'feature/x', sharedPhase: 'Draft', push: false });
  const r = runGate(dir);
  assert.equal(r.code, 0, 'an unpushed plan must not block the bootstrap');
  assert.match(r.stderr, /phase unverified/);
  assert.match(r.stderr, /Push the plan/);
});
