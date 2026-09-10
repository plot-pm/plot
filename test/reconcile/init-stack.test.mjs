// Contract test for skills/plot-init/SKILL.md — the `Tracker:` and `CI:`
// proposals adoption builds from what the probe read.
//
// THE PROPOSAL IS THE SKILL'S AND THE WRITE IS THE RULE'S, so this file asserts
// both surfaces. Turning a signal into a proposal is judgement and stays the
// skill's job (Manifesto Principle 3); which key that proposal becomes is
// `composeAdoption`'s, and has been since 2026-09-09 — before that the key was a
// markdown block in step 3 with an example beside it.
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
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'plot-init', 'SKILL.md');
const rulePath = path.join(repoRoot, 'packages', 'domain', 'src', 'rules', 'adoption.ts');
const skill = fs.readFileSync(skillPath, 'utf8');
const rule = fs.readFileSync(rulePath, 'utf8');

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
  // THE PROPERTY MOVED INTO THE RULE. Step 3 used to instruct an agent to write
  // the confirmed value rather than the example beside it, which is an
  // instruction that had to be followed; `trackerKey` now takes the confirmed
  // answer and falls back to `plot` only where nobody confirmed one, so there is
  // no example to write by mistake.
  assert.match(rule, /if \(tracker === ''\) \{/,
    'the rule must fall back only where nobody confirmed a tracker');
  assert.match(rule, /const value = trackerUrl === '' \? tracker : `\$\{tracker\} \$\{trackerUrl\}`;/,
    'a confirmed tracker must carry its URL where one was supplied');
});

// ── The CI system: one signal proposes, two ask ──────────────────────────────

test('init: ci_signals proposes a CI key', () => {
  assert.match(proposal, /`ci_signals` proposes `CI:`/,
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

test('init: an absent ci_signals writes no key and is not `none`', () => {
  // The field IS emitted since 2026-09-10, so this is no longer the estate's
  // everyday case — but it stays asserted, because a probe too old to report
  // it must degrade rather than invent a reading. "Not read" and "none" are
  // different answers, and only the second licenses writing no key.
  assert.match(proposal, /\*\*An absent `ci_signals` writes no key and says so\.\*\*/,
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

// ── The Jenkins instance: the key the connector refuses without ──────────────
//
// THESE ASSERT PROSE, AND THAT IS DELIBERATE HERE WHERE IT WAS WRONG ABOVE.
// The rule is `proposeJenkins`, asserted behaviourally in
// `packages/domain/test/stack.test.ts`, and the probe field is asserted against
// the script in `init.test.mjs`. What is left is the two QUESTIONS a person is
// asked — which exist only as prose, because only an agent reading this file
// asks them. A test over prose is right for prose and wrong for a rule; the
// three `ci_system` tests beside these are the wrong kind and the plan that
// owns that field deletes them.

test('init: the Jenkins instance is proposed wherever CI: jenkins is', () => {
  assert.match(proposal, /\*\*Where `CI: jenkins` is proposed, propose `Jenkins instance` too\.\*\*/,
    'the connector exits 3 without this key, so adoption must propose it');
});

test('init: one question where the slug was measured', () => {
  assert.match(proposal, /Which job\n> builds this repository\?/,
    'a measured slug leaves only the container path to ask');
});

test('init: two questions where the repository names no Jenkins', () => {
  assert.match(proposal, /Which instance, and\n> which job\?/,
    'a Jenkinsfile says Jenkins builds this without saying which Jenkins');
});

test('init: the instance is never defaulted', () => {
  assert.match(proposal, /\*\*The fallback is a question, never a default\.\*\*/,
    'a wrong slug answers NOT reachable, which reads as a Jenkins that is down');
});

test('init: an unanswered path writes the slug alone', () => {
  assert.match(proposal, /\*\*An unanswered question writes what is left\.\*\*/,
    'a bare-host instance lists at the root scope — wrong but visible');
});

test('init: unattended writes a measured slug and refuses an unmeasured one', () => {
  const unattended = proposal.slice(proposal.indexOf('#### The Jenkins instance'));
  assert.match(unattended, /PLOT-UNASKED: Which Jenkins job builds this\? — default —/,
    'a measured slug is a structural signal and survives unattended');
  assert.match(unattended, /PLOT-UNASKED: Which Jenkins instance, and which job\? — refused —/,
    'an unmeasured slug has nothing to propose, so it refuses');
});

// ── The collector emits the field the reader reads ───────────────────────────
//
// THE PROSE AND THE CODE NAMED TWO DIFFERENT FIELDS, and every test above is a
// prose assertion, so none of them could see it. `stack-readings.ts` reads
// `report.ci_signals`; this skill's docs said `ci_system` in six places, and
// `plot-detect-repo.sh` emitted neither. The result was `ci: null` — *nobody
// looked* — with the rule, the entry and their unit tests all complete.
//
// So this test runs the SCRIPT and asserts the shape a reader consumes. A
// prose test cannot catch a field-name disagreement; only executing the
// collector can.
test('init: plot-detect-repo.sh emits ci_signals with both signal keys', () => {
  const probe = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-detect-repo.sh');
  const out = execFileSync('bash', [probe], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120000,
  });
  const report = JSON.parse(out);

  assert.ok(
    Object.hasOwn(report, 'ci_signals'),
    'the probe must emit `ci_signals` — the field `stack-readings.ts` reads',
  );
  assert.equal(typeof report.ci_signals, 'object');
  assert.notEqual(report.ci_signals, null);

  // The two keys `ciSignalsFrom` tests with `=== true`. A renamed key reads as
  // `present: false`, which is a silent wrong answer rather than a failure.
  assert.equal(typeof report.ci_signals.jenkinsfile, 'boolean',
    '`jenkinsfile` must be a boolean — `ciSignalsFrom` tests it with === true');
  assert.equal(typeof report.ci_signals.gh_workflows, 'boolean',
    '`gh_workflows` must be a boolean — `ciSignalsFrom` tests it with === true');

  // This repository runs GitHub Actions and no Jenkins, so the reading is known.
  assert.equal(report.ci_signals.gh_workflows, true,
    'this repo has .github/workflows/, so the signal must be present');
  assert.equal(report.ci_signals.jenkinsfile, false,
    'this repo runs no Jenkins, so the signal must be absent');
});

// A Jenkinsfile is found wherever git tracks it, never only at the root.
//
// MEASURED, NOT REASONED: the stack this sprint was written for keeps three at
// `.build/pipelines/<project>/<pipeline>/Jenkinsfile` — none of the four paths
// an earlier slice guessed, root included. A root-only probe reads that
// repository as having no CI at all, which is the reading that makes the whole
// adoption path silent.
test('init: a nested Jenkinsfile is a signal', () => {
  const probe = path.join(repoRoot, 'skills', 'plot', 'scripts', 'plot-detect-repo.sh');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ci-signal-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    fs.mkdirSync(path.join(dir, '.build', 'pipelines', 'web', 'release'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.build', 'pipelines', 'web', 'release', 'Jenkinsfile'), 'pipeline {}\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });

    const report = JSON.parse(
      execFileSync('bash', [probe], { cwd: dir, encoding: 'utf8', timeout: 120000 }),
    );
    assert.equal(report.ci_signals.jenkinsfile, true,
      'a Jenkinsfile three directories deep must still be a signal');
    assert.equal(report.ci_signals.gh_workflows, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
