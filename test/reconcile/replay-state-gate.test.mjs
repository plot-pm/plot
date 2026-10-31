// Contract test for skills/plot/scripts/plot-state-gate.sh's replay carve-out:
// a rebase or cherry-pick stopped on a conflict re-presents the commit it is
// replaying, and the receipt its first run spent is already gone. The gate
// must clear that replay with no second receipt — but only when the picked
// commit's OWN before/after (against its own first parent) matches the
// uncleared transition exactly, so a revert (whose before/after are the
// receipted change's own swapped) and an unrelated picked change still refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Every temp path this file creates, removed by the exact name `mkdtempSync`
// returned — never a glob over the shared temp directory.
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

const plan = (state) => `# P\n\n## Status\n\n- **State:** ${state}\n- **Type:** feature\n`;

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

// A repo with a Draft plan committed, then a second commit changing it to
// `pickedState` — the commit a rebase/cherry-pick is replaying. A paused
// rebase has not advanced the branch ref past the commit it stopped on, so
// HEAD is moved back to the parent with `update-ref` (which touches neither
// the index nor the worktree) before the picked content is staged again as
// `stagedState` — the same shape `git rebase` leaves a conflict in. No
// receipt is recorded for the picked commit: this fixture is its SECOND
// presentation to the gate, after the receipt its first run spent is gone.
function replayRepo({ pickedState, stagedState }) {
  const tmp = trackTemp(mkdtempSync(path.join(tmpdir(), 'plot-replay-gate-')));
  const dir = path.join(tmp, 'repo');
  mkdirSync(dir, { recursive: true });
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');

  const planPath = path.join(dir, 'docs', 'plans', '2026-01-01-x.md');
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, plan('Draft'));
  sh('git add -A && git commit -qm init');
  const base = sh('git rev-parse HEAD').toString().trim();

  writeFileSync(planPath, plan(pickedState));
  sh('git add -A && git commit -qm picked');
  const picked = sh('git rev-parse HEAD').toString().trim();

  sh(`git update-ref refs/heads/main ${base}`);
  writeFileSync(path.join(dir, '.git', 'REBASE_HEAD'), `${picked}\n`);
  writeFileSync(planPath, plan(stagedState));
  sh('git add -A');
  return dir;
}

test('replay state gate: a rebase stopped on a receipted Draft -> Design commit allows the replay', () => {
  const dir = replayRepo({ pickedState: 'Design', stagedState: 'Design' });
  const r = run(dir);
  assert.equal(r.status, 0, `the replay must clear with no second receipt (stderr: ${r.stderr})`);
});

// `git revert --no-commit` on a conflict-free revert leaves `REVERT_HEAD`,
// never `REBASE_HEAD` or `CHERRY_PICK_HEAD` — confirmed against real git, not
// assumed. `pickedHead()` reads neither name here, so this case never reaches
// the replay carve-out at all and refuses the ordinary way, with no receipt
// to clear it. This is the plan's own settled reason no `REVERT_HEAD` reading
// was added: a revert's before/after are the receipted change's own swapped,
// so even a hypothetical reading could never make `pickedClears` agree.
test('replay state gate: a revert of a receipted commit still refuses', () => {
  const tmp = trackTemp(mkdtempSync(path.join(tmpdir(), 'plot-replay-gate-')));
  const dir = path.join(tmp, 'repo');
  mkdirSync(dir, { recursive: true });
  const sh = (c) => execSync(c, { cwd: dir, stdio: 'pipe' });
  sh('git init -q -b main && git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  const planPath = path.join(dir, 'docs', 'plans', '2026-01-01-x.md');
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, plan('Draft'));
  sh('git add -A && git commit -qm init');
  writeFileSync(planPath, plan('Design'));
  sh('git add -A && git commit -qm design');
  const design = sh('git rev-parse HEAD').toString().trim();
  sh(`git revert --no-commit ${design}`);

  const r = run(dir);
  assert.equal(r.status, 2, `a revert must still be refused (stderr: ${r.stderr})`);
  assert.match(r.stderr, /Design -> Draft/);
});

// Catches a naive "clear any REBASE_HEAD" implementation: REBASE_HEAD exists
// and the working tree carries an uncleared transition, but the picked
// commit's OWN before/after (Draft -> Approved) does not match the staged
// transition (Draft -> Design) — so this replay must still be refused.
test('replay state gate: a picked commit with a different before/after still refuses', () => {
  const dir = replayRepo({ pickedState: 'Approved', stagedState: 'Design' });
  const r = run(dir);
  assert.equal(r.status, 2, `an unrelated picked change must not clear this transition (stderr: ${r.stderr})`);
  assert.match(r.stderr, /Draft -> Design/);
});
