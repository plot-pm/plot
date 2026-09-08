// Contract test for skills/plot-init/SKILL.md — the `Tracker:` and `CI:`
// proposals adoption builds from what the probe read.
//
// THE SUBJECT IS AN INSTRUCTION, NOT A SCRIPT, so this file asserts what the
// skill SAYS. That is the shape `init-worktree-root.test.mjs` uses on the same
// file, and it is the only surface there is: no script proposes a config key,
// because turning a signal into a proposal is the skill's job (Manifesto
// Principle 3).
//
// WHAT IS BEING PROTECTED IS THE DIFFERENCE BETWEEN A READING AND AN ANSWER.
// `plot-detect-repo.sh` reports a recurring ticket prefix and the CI evidence
// in the tree. Neither says which system a team uses — so both are proposals
// carrying their evidence, and the one fact no reading can supply (the Jira
// base URL) is the only question this slice adds.
//
// Measured 2026-09-07, which is why the slice exists: this skill named
// `Tracker:` once, as the hardcoded default `plot`, and `CI:` zero times. A
// team with Jira got `trackerNone`, which answers `unaskable` on every issue
// operation and reads exactly like having no tracker at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'plot-init', 'SKILL.md');
const skill = fs.readFileSync(skillPath, 'utf8');

// Everything a person sees before any file is written.
const proposal = skill.slice(0, skill.indexOf('### 3.'));

// ── The tracker: proposed from a measurement, never from silence ─────────────

test('init: a recurring ticket prefix proposes Tracker: jira', () => {
  assert.match(proposal, /propose `Tracker: jira`/,
    'a measured prefix must yield a tracker proposal');
  assert.match(proposal, /When the proposal carries a `ticket\.prefix`/,
    'the proposal must name the signal it reads');
});

test('init: the evidence travels with the tracker proposal', () => {
  // A bare `jira` cannot be checked. The count is what lets a reader confirm
  // or reject in one read, and it is why the proposal is trustworthy at all.
  assert.match(proposal, /Found `QUACDS` in 38 of 80 commit subjects/,
    'the proposal must print the evidence behind it');
  assert.match(proposal, /A bare `jira` teaches nothing/,
    'the skill must say why the bare value is not enough');
  assert.match(skill, /Never propose `Tracker` or `CI` without the evidence behind it/,
    'the guardrail must require the evidence');
});

test('init: silence never proposes Tracker: none', () => {
  // Half of repositories carry no prefix, so absence is not evidence against
  // a tracker. The silent wrong default is the defect this slice removes.
  assert.match(proposal, /\*\*Absence proves nothing:\*\*/,
    'the skill must state that an empty prefix proves nothing');
  assert.match(skill, /Never write `Tracker: none` from silence/,
    'the guardrail must forbid the proposal from silence');
});

test('init: the base URL is the one thing asked', () => {
  // It is nowhere in git history and `tracker-jira.ts` needs it. Everything
  // else in this proposal is read rather than asked — that is the whole shape.
  assert.match(proposal, /\*\*the base URL is nowhere in git history\*\*/,
    'the skill must say why the URL cannot be read');
  assert.match(proposal, /Which Jira instance\?/,
    'the question itself must appear');
  assert.match(skill, /Never guess the Jira base URL/,
    'the guardrail must forbid guessing it');
});

test('init: the confirmed tracker is written with its URL', () => {
  assert.match(skill, /- \*\*Tracker:\*\* jira https:\/\/acme\.atlassian\.net/,
    'the written form must show the key carrying its URL');
  assert.match(skill, /Write the confirmed `Tracker:` and `CI:` values/,
    'step 3 must write what was confirmed rather than the defaults shown');
});

// ── The CI system: one signal proposes, two ask ──────────────────────────────

test('init: ci_system proposes a CI key', () => {
  assert.match(proposal, /`ci_system` proposes `CI:`/,
    'the reading must yield a proposal');
  assert.match(proposal, /`CI: jenkins`/, 'the jenkins proposal must appear');
  assert.match(proposal, /`CI: github-actions`/,
    'the github-actions proposal must appear');
});

test('init: two signals ask rather than tie-break on the git host', () => {
  // A team on GitHub running Jenkins is common, and a silently wrong `CI:`
  // sends every build-status lookup to the wrong system.
  assert.match(proposal, /One signal proposes, two signals ask/,
    'the rule must be stated');
  assert.match(proposal, /Found a `Jenkinsfile` and `\.github\/workflows\/`\. Which runs your PRs\?/,
    'the question must name both signals');
  assert.match(skill, /Never tie-break the CI system on the git host/,
    'the guardrail must forbid the tie-break');
});

test('init: `none` is a reading, not a key', () => {
  // Writing `CI: none` records a choice the repo never made — the same silent
  // default, one layer along.
  assert.match(proposal, /\*\*`none` is a reading, not a key\.\*\*/,
    'the skill must distinguish the reading from the key');
  assert.match(skill, /Writing `CI: none` because the probe said `none`/,
    'the mistakes table must name it');
});

test('init: an absent ci_system writes no key and is not `none`', () => {
  // The field is specified and not yet emitted, so adoption must degrade
  // rather than invent a reading. "Not read" and "none" are different answers.
  assert.match(proposal, /\*\*An absent `ci_system` writes no key and says so\.\*\*/,
    'the skill must handle a probe that does not report the field');
  assert.match(proposal, /which is not the same as `none`/,
    'an unread field must not collapse into the `none` reading');
});

test('init: the CI proposal needs no credential', () => {
  // Whether `jen` authenticates is /plot-board-setup's question and it already
  // asks it. Adoption reads files.
  assert.match(proposal, /It reads files and asks nothing about credentials/,
    'the skill must keep adoption out of the credential question');
});

// ── Unattended: the proposal survives, the question does not ─────────────────

test('init: unattended proposes from a signal and names the gap', () => {
  // A half-configured tracker that announces its gap beats `trackerNone`
  // answering `unaskable` for a reason nobody can see.
  assert.match(proposal, /propose\n> `Tracker: jira` with the URL unset — and \*\*say the URL is missing\*\*/,
    'a measured signal must still propose unattended, with the gap named');
  assert.match(proposal, /PLOT-UNASKED: Which Jira base URL\?/,
    'the tracker disclosure must be present');
  assert.match(proposal, /PLOT-UNASKED: Which CI runs the PRs\?/,
    'the CI disclosure must be present');
});

test('init: unattended refuses the CI key on two signals', () => {
  assert.match(proposal, /two\n> signals refuse rather than guess/,
    'two signals must refuse rather than guess unattended');
  assert.match(proposal, /both signals found, no CI key written/,
    'the refusal must say no key was written');
});

test('init: the refusal is for absence, never for a present signal', () => {
  assert.match(proposal, /The refusal is for the \*absence\* of a signal, never for its presence/,
    'a measured signal must not be refused along with the unmeasured one');
});

test('init: the two disclosures belong to step 2s single stop', () => {
  // Step 2 already stops and writes nothing unattended. These name what that
  // stop PRINTS — a second stop would be a second disclosure for one halt.
  assert.match(skill, /\*\*The tracker and CI disclosures above are part of what that stop prints\*\*/,
    'the skill must tie the two disclosures to the existing stop');
  assert.ok(skill.includes('> **Unattended (`PLOT_UNATTENDED=1`):** stop, and create nothing.'),
    'step 2 must still stop and create nothing unattended');
});

test('init: every unattended declaration still discloses', () => {
  // The same invariant `unattended.test.mjs` holds across skills: a shape that
  // declares an unattended path and discloses nothing is a skill silently
  // taking a default.
  const declarations = skill.match(/\*\*Unattended \(`PLOT_UNATTENDED=1`\)/g) || [];
  const disclosures = skill.match(/PLOT-UNASKED:/g) || [];
  assert.ok(disclosures.length >= declarations.length,
    `every unattended declaration must disclose: ${declarations.length} declared, ${disclosures.length} disclosed`);
});
