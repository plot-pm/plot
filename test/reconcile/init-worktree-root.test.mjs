// Contract test for skills/plot-init/SKILL.md — the `Worktree root` proposal
// and the `.gitignore` line that comes with it.
//
// THE SUBJECT WAS AN INSTRUCTION AND IS NOW THREE THINGS, and that split is
// itself the property. Until 2026-09-09 step 3 stated the whole config block as
// prose and this file could only assert what the skill SAID. `composeAdoption`
// now decides the keys and `plot-write-config.sh` performs the write, so each
// assertion below sits where its property actually lives: the DEFAULT in the
// rule, the APPEND in the performer, and what a person is TOLD in the skill.
//
// Turning signals into a proposal is still the skill's job (Manifesto Principle
// 3). What moved is the write it proposed — which was never a judgement.
//
// WHAT IS BEING PROTECTED IS A PAIR. `Worktree root: .worktrees` with no
// ignore rule turns every dispatched desk into untracked files in
// `git status`, and the operator's next `git add -A` stages a whole checkout.
// The key and the line are one decision, confirmed together and written
// together — so the tests below are mostly about the two never coming apart.
//
// Measured 2026-09-06, which is why the slice exists: this skill named
// `Worktree root` zero times and `.gitignore` zero times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'plot-init', 'SKILL.md');
const readmePath = path.join(repoRoot, 'skills', 'plot-init', 'README.md');
const rulePath = path.join(repoRoot, 'packages', 'domain', 'src', 'rules', 'adoption.ts');
const performerPath = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-write-config.sh');
const skill = fs.readFileSync(skillPath, 'utf8');
const rule = fs.readFileSync(rulePath, 'utf8');
const performer = fs.readFileSync(performerPath, 'utf8');

// ── Case 1: a fresh repository is offered the key AND the line ───────────────

test('init: proposes Worktree root with its default', () => {
  assert.match(skill, /Worktree root/,
    'adoption must name the key it is proposing');
  // THE KEY IS THE RULE'S, and the assertion moved with it. Step 3 stated the
  // whole `## Plot Config` block as prose until 2026-09-09; `composeAdoption`
  // now composes it and `DEFAULT_WORKTREE_ROOT` holds this value, so a markdown
  // block in the skill would be a second answer rather than the contract.
  assert.match(rule, /export const DEFAULT_WORKTREE_ROOT = '\.worktrees';/,
    'the rule must hold the proposed default');
  assert.match(skill, /An empty `worktreeRoot` takes `\.worktrees`/,
    'the skill must say what an unanswered root proposes');
  // In the proposal block, so a user sees it before confirming rather than
  // discovering it in a diff afterwards.
  const proposal = skill.slice(0, skill.indexOf('### 3.'));
  assert.match(proposal, /worktree root `\.worktrees`/,
    'step 2 must name the worktree root in what it proposes');
});

test('init: the key and the .gitignore line are ONE decision', () => {
  // The failure this pair prevents: a configured root with no ignore rule.
  // Either half alone is worse than neither, because the key MOVES desks
  // inside the repository and the line is what keeps them out of `git status`.
  assert.match(skill, /Never write the `Worktree root` key without the matching ignore line/,
    'the guardrail must forbid writing one without the other');
  const proposal = skill.slice(0, skill.indexOf('### 3.'));
  assert.match(proposal, /Confirm both together/,
    'step 2 must confirm the key and the line as one decision');
});

test('init: writes the .gitignore line rather than printing it to paste', () => {
  // PRINTING IT IS THE DEFECT, not the fix. A line left to a human is a line
  // that does not get added, and then every desk is untracked work.
  assert.match(skill, /Do not print it for the user to paste/,
    'the skill must forbid handing the line to the user');
  // THE LINE AND ITS COMMENT MOVED INTO THE PERFORMER. An agent no longer
  // composes them, so asserting them against the skill would assert prose that
  // writes nothing; `plot-write-config.sh` is what appends them.
  assert.match(performer, /printf '%s\\n' "\$ignore_line"/,
    'the performer must write the line it was given');
  // The wording is this repo's own, copied deliberately.
  assert.match(performer, /gathered here by the `Worktree root` key rather than/,
    "the comment above the line must explain what it is");
});

test('init: .gitignore is appended, never rewritten', () => {
  assert.match(skill, /It appends and never\nrewrites/,
    'the write must be an append');
  assert.match(skill, /Never write `\.gitignore` without the confirmation from step 2/,
    'the guardrail must tie the write to the confirmation');
  // AN APPEND TO AN ABSENT FILE IS A CREATE, and `>>` is what makes that true
  // without a branch — the property is the shell's redirection rather than a
  // sentence an agent has to follow.
  assert.match(performer, /\} >> \.gitignore/,
    'an absent file is a create, not a failure');
  assert.match(performer, /grep -qxF "\$ignore_line" \.gitignore/,
    'a line already there is not written twice');
});

test('init: says plainly that .gitignore is a new write surface', () => {
  // It is the one file adoption touches that Plot does not own, and the round
  // asked for that to be explicit rather than folded into the step.
  assert.match(skill, /THIS IS A FILE ADOPTION HAS NEVER TOUCHED/,
    'the skill must flag the new surface');
});

// ── Case 2: a repository that declines, or already has a convention ──────────

test('init: reads the existing convention before proposing one', () => {
  // "Propose, don't interrogate" needs a signal to propose FROM, and a repo
  // with worktrees already somewhere has made the decision already.
  assert.match(skill, /git worktree list/,
    'the skill must read what is already there');
  assert.match(skill, /A repository with its own convention keeps it/,
    'an existing arrangement must be kept, not overridden');
  assert.match(skill, /propose \*\*that\*\* location rather than `\.worktrees`/,
    'the proposal must follow what the repo already does');
});

test('init: never moves existing worktrees — that is --migrate', () => {
  assert.match(skill, /Never move existing worktrees/,
    'adoption is additive; relocating is a different command');
  assert.match(skill, /--migrate/,
    'the skill must name where relocation belongs');
});

test('init: a decline writes neither half', () => {
  // There is no new mechanism for declining: step 2's confirmation already
  // gates every write in step 3, and unattended adoption stops before it.
  assert.ok(skill.includes('> **Unattended (`PLOT_UNATTENDED=1`):** stop, and create nothing.'),
    'step 2 must still stop and create nothing unattended');
  assert.match(skill, /This question declares no unattended shape of its own/,
    'the worktree key must inherit that stop rather than declare a second one');
});

test('init: the worktree question adds no second unattended disclosure', () => {
  // `unattended.test.mjs` counts `**Unattended (` declarations against
  // `PLOT-UNASKED:` lines, and a shape that discloses nothing is a skill
  // silently taking a default. Step 2's stop already covers this key, so a
  // declaration here would be a second disclosure for one stop — which is why
  // the skill states the inheritance in prose instead.
  const declarations = skill.match(/\*\*Unattended \(`PLOT_UNATTENDED=1`\)/g) || [];
  const disclosures = skill.match(/PLOT-UNASKED:/g) || [];
  assert.ok(disclosures.length >= declarations.length,
    `every declared shape needs a disclosure: ${declarations.length} shapes, ${disclosures.length} lines`);
});

// ── The desk's own exclusion belongs to dispatch, and is not touched ─────────

test('init: leaves .git/info/exclude to plot-dispatch', () => {
  // Two rules that look alike and protect different things. The desk's is
  // per-clone BECAUSE a rule in branch content is invisible to a worktree cut
  // from an older branch — so adoption cannot write it even if it wanted to.
  assert.match(skill, /Never touch a desk's `\.git\/info\/exclude`/,
    'the guardrail must keep the desk rule with dispatch');
  assert.match(skill, /invisible to a worktree cut from an\nolder branch/,
    'the skill must say why that rule is per-clone');
});

test('init: the desk exclusion is still written by plot-dispatch.sh', () => {
  // The other half of the same claim, asserted against the script that owns it
  // so this test fails if the rule is ever quietly moved into adoption.
  const dispatch = fs.readFileSync(
    path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-dispatch.sh'), 'utf8');
  assert.match(dispatch, /info\/exclude/,
    'plot-dispatch.sh must still own the desk-level exclusion');
});

// ── The default this proposal changes ───────────────────────────────────────

test('init: says the absent-key default is the repo PARENT, not .worktrees', () => {
  // The reason to propose at all. With no key, dispatch uses `repo_root/..`
  // with a `plot-wt-` prefix, which puts nothing inside the repository — so
  // the ignore line is needed precisely BECAUSE the proposal changes that.
  assert.match(skill, /The absent-key default is not `\.worktrees`/,
    'the skill must not imply the default is what it proposes');
  assert.match(skill, /PARENT/,
    'it must name where desks go without the key');
});

test('init: the skill and plot-config.sh agree about the default', () => {
  // A documented default that drifts from the code is worse than none. This
  // reads the contract file rather than restating it.
  const config = fs.readFileSync(
    path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-config.sh'), 'utf8');
  assert.match(config, /Absent = the default `repo_root\/\.\.`/,
    'plot-config.sh must still document the parent default the skill describes');
});

test('init: an absolute worktree root needs no ignore line', () => {
  // It resolves outside the repository, so a line would match nothing. Writing
  // one anyway is a rule nobody can explain later.
  // THE RULE ANSWERS IT, and the skill states the answer. `ignoreLineFor`
  // returns `''` for an absolute root, and the performer writes nothing on `''`
  // — so the dead rule cannot be written even by a caller that wanted one.
  assert.match(rule, /root\.startsWith\('\/'\) \? '' :/,
    'the rule must answer no line for an absolute root');
  assert.match(skill, /writes none at all for an absolute\nroot/,
    'the skill must state the absolute case rather than writing a dead rule');
});

// ── The dev notes carry the reasoning ───────────────────────────────────────

test('init README: records why adoption writes a file Plot does not own', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');
  assert.match(readme, /## Why adoption writes `\.gitignore`/,
    'the dev notes must explain the new write surface');
  assert.match(readme, /## The desk's own exclusion is a different rule/,
    'and must keep the two ignore rules apart');
});

// ── The skill still parses as a skill ───────────────────────────────────────

test('init: SKILL.md still carries its frontmatter name', () => {
  // `pnpm test` validates every skill, but a broken frontmatter here would
  // surface as a confusing failure in an unrelated place.
  assert.match(skill, /^---\nname: plot-init\n/,
    'frontmatter must survive the edit');
});
