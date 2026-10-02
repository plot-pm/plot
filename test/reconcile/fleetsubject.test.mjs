// Contract test for the merge subject the scan reads as proof that a branch
// with no ref landed.
//
// THE DEFECT, measured 2026-10-01 on a Bitbucket repository (#1139). A branch
// merged and deleted is proven merged by the `Merged in <branch> (pull request
// #N)` commit on the default branch, and Plot read only GitHub's
// `Merge pull request #N from <owner>/<branch>`. Under HTTP 429 the branch
// therefore read `unknown`, its slice never completed, and every later slice of
// its plan was held — on that estate `git log --grep='^Merged in '` returns
// 1723 proofs the scan could not see.
//
// WHAT THIS FILE PINS, and each case is here because a naive implementation
// passes without it:
//
//   both forms          — the whole point; one host's proof must not be the
//                         only one read
//   a backward merge    — `Merge remote-tracking branch 'origin/main' into x`
//                         means main went INTO x, the opposite of landing. The
//                         inversion reports unfinished work as finished
//   a fork owner        — 22 of 200 measured subjects name another account
//   an owner's case     — the comparison is without case, and a repository
//                         whose subject spells its owner differently must still
//                         be read
//   a prefix-sharing    — `bug/flaky-two` must not settle `bug/flaky`
//   name
//   a local-path origin — no owner can be read, so any owner counts: the bare
//                         local origin `fleet.test.mjs:845-900` runs against
//   a reused name       — THE AGE RULE. A later plan reusing a merged branch
//                         name must not have its slice settled by the earlier
//                         merge, and the footer counts the refusal
//   a moved symlink     — a delivery moves the symlink as a git rename, so the
//                         symlink's adding commit is the DELIVERY commit and
//                         reading it loses every subject
//   a plan on its own   — the stated limit: a plan drafted on a side branch
//   branch                keeps a window in which a reused name still counts
//   a renamed plan      — `git mv` lists the file `R` and never `A`, so an
//                         A-only walk would give the plan no subjects at all
//   two plans, one name — only the earlier reads merged
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// EVERY TEMP PATH REMOVED BY THE EXACT NAME `mkdtempSync` RETURNED, never a
// glob over the shared temp directory.
function trackTemp(dir) {
  (trackTemp.paths ??= []).push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of trackTemp.paths ?? []) fs.rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');
const scan = path.join(scripts, 'plot-fleet-scan.sh');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/** A plan body naming its branches in one slice per entry. */
function planBody({ title, phase = 'Approved', slices }) {
  const body = slices
    .map(({ name, branches }) => [
      `### ${name}`,
      '',
      ...branches.map((b) => `- \`${b}\` — do the thing`),
      '',
    ].join('\n'))
    .join('\n');
  return `# ${title}

## Status

- **Phase:** ${phase}
- **Type:** feature

## Branches

${body}`;
}

/**
 * A sandbox repo whose origin is a bare path, so no host is ever asked.
 *
 * `backend` picks which merge subjects the stub `plot-host.sh` claims to write.
 * Every other host question answers as a refused one, which is the #1139
 * condition: the proof must come from the subject or not at all.
 */
function makeRepo({ backend = 'github', owner = 'acme' } = {}) {
  const tmp = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-subject-')));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, 'repo');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  // THE ORIGIN URL IS WHAT THE OWNER IS READ FROM. A bare local path answers
  // `null` — any owner counts — so a test about owners must set a real URL.
  if (owner !== null) {
    git(repo, 'remote', 'set-url', '--push', 'origin', origin);
    git(repo, 'config', 'remote.origin.url', `https://example.com/${owner}/repo.git`);
  }

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** docs/plans/
- **Active index:** docs/plans/active/
- **Delivered index:** docs/plans/delivered/
- **Git host:** ${backend}
`);

  // A STUB HOST THAT REFUSES EVERY QUESTION, which is the throttled condition
  // the proof has to survive.
  //
  // IT IS REACHED THROUGH `PATH` AND THAT IS NOT ENOUGH ON ITS OWN. The scan
  // resolves `plot-host.sh` from `BASH_SOURCE` — its own directory — so this
  // stub answers only the calls Plot makes through `PATH`, and the backend word
  // comes from the repo's `Git host` key and `$PLOT_HOST` instead. The stub
  // still earns its place: it is what records which branches the host was asked
  // about, which is the assertion that a proven branch costs no host call.
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(tmp, 'host.log');
  fs.writeFileSync(path.join(bin, 'plot-host.sh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
case "$1" in
  backend) echo ${JSON.stringify(backend)}; exit 0 ;;
  default-branch) echo main; exit 0 ;;
esac
# Everything else is a refused host: exit 7 is the rate-limit shape, and the
# scan's own verdict words take it from there.
echo "API rate limit exceeded" >&2
exit 7
`, { mode: 0o755 });

  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'delivered'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'plans', 'active', '.gitkeep'), '');
  fs.writeFileSync(path.join(repo, 'docs', 'plans', 'delivered', '.gitkeep'), '');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'fixture');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  return { tmp, repo, bin, log, backend };
}

/** Writes a plan, commits it, and pushes — so its adding commit is on main. */
function addPlan(repo, name, spec) {
  fs.writeFileSync(path.join(repo, 'docs', 'plans', name), planBody(spec));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `plan: ${name}`);
  git(repo, 'push', '-q', 'origin', 'main');
}

/**
 * A merge commit carrying `subject`, with a real second parent.
 *
 * TWO PARENTS, because the walk is `--merges` and a one-parent commit is not in
 * it at all — which is also why a squash-merge estate gets no proof.
 */
function mergeWithSubject(repo, branch, subject, { keepRef = false } = {}) {
  const base = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(repo, `${branch.replace(/\//g, '-')}.txt`), 'work\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', `work on ${branch}`);
  const tip = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'reset', '-q', '--hard', base);
  git(repo, 'merge', '-q', '--no-ff', '-m', subject, tip);
  git(repo, 'push', '-q', 'origin', 'main');
  if (keepRef) git(repo, 'push', '-q', 'origin', `${branch}:${branch}`);
  // The local branch is deleted either way: the scan reads `origin/*`, and a
  // merged-and-deleted branch is the whole population this is about.
  git(repo, 'branch', '-qD', branch);
  return git(repo, 'rev-parse', 'HEAD').trim();
}

/**
 * The environment a fixture scan runs in.
 *
 * `PLOT_HOST` is `plot-host.sh`'s own documented test override (`:379`), and it
 * is what selects the forms — the `Git host` key says the same thing, and both
 * are set so the fixture does not depend on which one the adapter reads first.
 */
const scanEnv = (bin, backend) => ({
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  PLOT_HOST: backend,
});

/** Runs the scan against a fixture, and parses its document. */
function scanJson({ repo, bin, backend }, ...args) {
  return JSON.parse(execFileSync('bash', [scan, '--json', ...args], {
    encoding: 'utf8',
    cwd: repo,
    env: scanEnv(bin, backend),
  }));
}

function scanText({ repo, bin, backend }, ...args) {
  return execFileSync('bash', [scan, ...args], {
    encoding: 'utf8',
    cwd: repo,
    env: scanEnv(bin, backend),
  });
}

/** The branch's record from a scan document, or undefined. */
function branchOf(doc, planFile, branch) {
  for (const plan of doc.plans) {
    if (plan.file !== planFile) continue;
    for (const wave of plan.waves ?? []) {
      for (const b of wave.branches ?? []) if (b.branch === branch) return b;
    }
  }
  return undefined;
}

test("the first host's merge subject proves a branch with no ref", () => {
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  addPlan(repo, '2026-10-01-one.md', {
    title: 'One', slices: [{ name: 'Work', branches: ['bug/flaky'] }],
  });
  mergeWithSubject(repo, 'bug/flaky', 'Merge pull request #12 from acme/bug/flaky');

  const doc = scanJson(fx);
  const b = branchOf(doc, '2026-10-01-one.md', 'bug/flaky');
  assert.equal(b?.state, 'merged', 'a conforming subject proves the landing');
  // AND IT SAYS THE PROOF IS THE SUBJECT, because the host never confirmed it.
  assert.equal(b?.evidence, 'subject');
});

test("the second host's merge subject proves it too — the #1139 defect", () => {
  // The whole reason this plan exists: identical shape, the other form.
  const fx = makeRepo({ backend: 'bitbucket', owner: null });
  const { repo, bin, log } = fx;
  addPlan(repo, '2026-10-01-two.md', {
    title: 'Two',
    slices: [
      { name: 'First', branches: ['bug/landed'] },
      { name: 'Second', branches: ['bug/next'] },
    ],
  });
  mergeWithSubject(repo, 'bug/landed', 'Merged in bug/landed (pull request #1723)');

  const doc = scanJson(fx);
  const first = branchOf(doc, '2026-10-01-two.md', 'bug/landed');
  assert.equal(first?.state, 'merged');
  assert.equal(first?.evidence, 'subject');

  // THE HOST WAS NOT ASKED ABOUT IT. The branch is proven and its plan is not
  // a delivery candidate — the second slice is outstanding — so a question the
  // host is refusing is not put. That spend is the condition #1139 reports.
  const asked = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  assert.ok(
    !/pr-state.*bug\/landed|pr-merged.*bug\/landed/.test(asked),
    `the host was asked about a proven branch:\n${asked}`,
  );

  // AND THE NEXT SLICE IS NOW REACHED, which is the gain. Before the fix the
  // first slice never completed, so everything behind it was held whatever its
  // own state was.
  //
  // `open` RATHER THAN `unknown`, and the difference is the fixture's not the
  // rule's: `unknown` needs `HOST_VERDICT` to be `throttled`, `secondary` or
  // `failed`, and this fixture's host is never ASKED — the scan resolves
  // `plot-host.sh` from its own directory, so the verdict stays `unasked` and
  // the rule answers `open`. Either word is OUTSTANDING to the wave
  // arithmetic; what matters here is that the slice is now evaluated at all.
  assert.equal(branchOf(doc, '2026-10-01-two.md', 'bug/next')?.state, 'open',
    'the next slice is reached and reads as outstanding, not held behind the first');
  // THE SECOND SLICE IS WHAT THE PROOF UNBLOCKED. Its own slice must not read
  // as complete — only the first one did.
  const waves = doc.plans.find((pl) => pl.file === '2026-10-01-two.md').waves;
  assert.equal(waves[0].verdict, 'complete', 'the proven slice settles');
  assert.notEqual(waves[1].verdict, 'complete', 'the outstanding slice does not');
});

test('a backward merge proves nothing', () => {
  // `Merge remote-tracking branch 'origin/main' into x` means main went INTO
  // x — the opposite of landing. Reading it as proof reports unfinished work as
  // finished and opens the next slice on an unlanded seam.
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  addPlan(repo, '2026-10-01-back.md', {
    title: 'Back', slices: [{ name: 'Work', branches: ['bug/backward'] }],
  });
  mergeWithSubject(repo, 'bug/backward', "Merge remote-tracking branch 'origin/main' into bug/backward");

  const b = branchOf(scanJson(fx), '2026-10-01-back.md', 'bug/backward');
  assert.notEqual(b?.state, 'merged');
  assert.equal(b?.evidence, undefined);
});

test('a subject naming another owner proves nothing', () => {
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  addPlan(repo, '2026-10-01-fork.md', {
    title: 'Fork', slices: [{ name: 'Work', branches: ['bug/from-fork'] }],
  });
  mergeWithSubject(repo, 'bug/from-fork', 'Merge pull request #13 from forker/bug/from-fork');

  assert.notEqual(
    branchOf(scanJson(fx), '2026-10-01-fork.md', 'bug/from-fork')?.state,
    'merged',
  );
});

test("an owner spelled in another case still proves it", () => {
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  addPlan(repo, '2026-10-01-case.md', {
    title: 'Case', slices: [{ name: 'Work', branches: ['bug/othercase'] }],
  });
  mergeWithSubject(repo, 'bug/othercase', 'Merge pull request #14 from ACME/bug/othercase');

  assert.equal(
    branchOf(scanJson(fx), '2026-10-01-case.md', 'bug/othercase')?.state,
    'merged',
  );
});

test('a branch sharing a prefix is not settled by its neighbour', () => {
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  addPlan(repo, '2026-10-01-prefix.md', {
    title: 'Prefix',
    slices: [{ name: 'Work', branches: ['bug/flaky', 'bug/flaky-two'] }],
  });
  // Only the LONGER name merged. The shorter one must not read as landed.
  mergeWithSubject(repo, 'bug/flaky-two', 'Merge pull request #15 from acme/bug/flaky-two');

  const doc = scanJson(fx);
  assert.equal(branchOf(doc, '2026-10-01-prefix.md', 'bug/flaky-two')?.state, 'merged');
  assert.notEqual(branchOf(doc, '2026-10-01-prefix.md', 'bug/flaky')?.state, 'merged');
});

test('a local-path origin accepts any owner', () => {
  // `fleet.test.mjs:845-900` runs against a bare local origin, and `null` keeps
  // its answer: no owner can be read, so the owner cannot narrow anything.
  const fx = makeRepo({ backend: 'github', owner: null });
  const { repo, bin } = fx;
  addPlan(repo, '2026-10-01-local.md', {
    title: 'Local', slices: [{ name: 'Work', branches: ['bug/any-owner'] }],
  });
  mergeWithSubject(repo, 'bug/any-owner', 'Merge pull request #16 from whoever/bug/any-owner');

  assert.equal(
    branchOf(scanJson(fx), '2026-10-01-local.md', 'bug/any-owner')?.state,
    'merged',
  );
});

test('a reused name whose merge predates its plan proves nothing, and is counted', () => {
  // THE AGE RULE. A later plan may reuse a merged branch name — a reopened
  // ticket does it, and one measured estate holds 87 reused names. Round 1
  // executed the failure: the unstarted reused name read `merged`, its slice
  // read complete, the next slice opened, and the reused slice was never
  // offered to anyone.
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  // The merge happens FIRST, so it is contained in the commit that adds the
  // plan below.
  mergeWithSubject(repo, 'bug/reused', 'Merge pull request #17 from acme/bug/reused');
  addPlan(repo, '2026-10-01-reuse.md', {
    title: 'Reuse', slices: [{ name: 'Work', branches: ['bug/reused'] }],
  });

  const doc = scanJson(fx);
  const b = branchOf(doc, '2026-10-01-reuse.md', 'bug/reused');
  assert.notEqual(b?.state, 'merged', 'a merge older than the plan settles nothing');
  assert.equal(b?.evidence, undefined);
  // AND THE REFUSAL IS REPORTED, so a reader can tell it from a slice that
  // simply has no subject.
  assert.equal(b?.subjectIgnored, 'predates-plan');
  assert.match(scanText(fx), /subject_predates_plan=1/);
});

test('two plans, one reused name: only the earlier reads merged', () => {
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  addPlan(repo, '2026-09-01-earlier.md', {
    title: 'Earlier', slices: [{ name: 'Work', branches: ['bug/shared'] }],
  });
  mergeWithSubject(repo, 'bug/shared', 'Merge pull request #18 from acme/bug/shared');
  // The later plan is added AFTER the merge, so the merge predates it.
  addPlan(repo, '2026-10-01-later.md', {
    title: 'Later', slices: [{ name: 'Work', branches: ['bug/shared'] }],
  });

  const doc = scanJson(fx);
  assert.equal(branchOf(doc, '2026-09-01-earlier.md', 'bug/shared')?.state, 'merged',
    "the plan the merge postdates keeps its proof");
  assert.notEqual(branchOf(doc, '2026-10-01-later.md', 'bug/shared')?.state, 'merged',
    'the plan the merge predates gets none — the proof is keyed by plan');
});

test('a plan read through a moved symlink keeps its subjects', () => {
  // A delivery moves the symlink as a git RENAME, so the symlink's adding
  // commit is the delivery commit — later than every merge the plan's branches
  // made. Reading it instead of the dated file loses every subject: measured on
  // the estate that reported #1139, one delivered plan keeps 4 of 4 subjects
  // through its target and 0 of 4 through its symlink.
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  addPlan(repo, '2026-09-01-moved.md', {
    title: 'Moved',
    slices: [
      { name: 'First', branches: ['bug/already-landed'] },
      { name: 'Second', branches: ['bug/still-open'] },
    ],
  });
  const plans = path.join(repo, 'docs', 'plans');
  fs.symlinkSync(path.join('..', '2026-09-01-moved.md'), path.join(plans, 'active', 'moved.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'link it active');
  git(repo, 'push', '-q', 'origin', 'main');

  mergeWithSubject(repo, 'bug/already-landed', 'Merge pull request #19 from acme/bug/already-landed');

  // NOW MOVE THE LINK, after the merge — the shape a delivery produces.
  git(repo, 'mv', 'docs/plans/active/moved.md', 'docs/plans/delivered/moved.md');
  git(repo, 'commit', '-qm', 'deliver it');
  git(repo, 'push', '-q', 'origin', 'main');

  assert.equal(
    branchOf(scanJson(fx), '2026-09-01-moved.md', 'bug/already-landed')?.state,
    'merged',
    'the age comes from the dated file, never from the symlink a delivery moved',
  );
});

test('a renamed plan keeps the first add’s age', () => {
  // With git's default rename detection a `git mv` of a plan lists the file `R`
  // and never `A`, so an A-only walk leaves the current path out of the answer
  // and the plan gets NO subjects at all. Measured on `origin/main`: 4 of 392
  // dated plans have no `A` entry for their current path.
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  addPlan(repo, '2026-09-01-old-title.md', {
    title: 'Old title', slices: [{ name: 'Work', branches: ['bug/renamed-plan'] }],
  });
  mergeWithSubject(repo, 'bug/renamed-plan', 'Merge pull request #20 from acme/bug/renamed-plan');
  git(repo, 'mv', 'docs/plans/2026-09-01-old-title.md', 'docs/plans/2026-09-01-new-title.md');
  git(repo, 'commit', '-qm', 'retitle the plan');
  git(repo, 'push', '-q', 'origin', 'main');

  assert.equal(
    branchOf(scanJson(fx), '2026-09-01-new-title.md', 'bug/renamed-plan')?.state,
    'merged',
    'the R line is followed to the original A, so the age survives a retitle',
  );
});

test('a plan drafted on its own branch keeps a window — the stated limit', () => {
  // THE LIMIT THE PLAN STATES RATHER THAN HIDES. A plan whose adding commit
  // lies on a side branch excludes only the merges before that branch forked,
  // so a reused name merged on main between the fork and the plan's own merge
  // still counts for it. The plain walk is chosen over `--first-parent`
  // deliberately: first-parent closes this window AND excludes the merge of a
  // plan written on the work branch it implements, which sends that plan's own
  // slice to the host.
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  const forkPoint = git(repo, 'rev-parse', 'HEAD').trim();

  // The plan is written on its own branch, cut at the fork point.
  git(repo, 'checkout', '-q', '-b', 'idea/windowed', forkPoint);
  fs.writeFileSync(path.join(repo, 'docs', 'plans', '2026-10-01-window.md'), planBody({
    title: 'Window', slices: [{ name: 'Work', branches: ['bug/in-window'] }],
  }));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan on its own branch');
  const planTip = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', 'main');

  // Meanwhile the branch merges on main — AFTER the fork, so it is not
  // contained in the plan's adding commit.
  mergeWithSubject(repo, 'bug/in-window', 'Merge pull request #21 from acme/bug/in-window');

  // Then the plan's own branch merges.
  git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #22 from acme/idea/windowed', planTip);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'branch', '-qD', 'idea/windowed');

  assert.equal(
    branchOf(scanJson(fx), '2026-10-01-window.md', 'bug/in-window')?.state,
    'merged',
    'a merge inside the side-branch window counts — the limit, asserted not assumed',
  );
});

test('a branch WITH a ref is never settled by a subject naming it', () => {
  // THE REF CHECK STAYS IN FRONT. A branch name can be reused: merge
  // `bug/flaky`, delete it, then recreate it for a second attempt. The first
  // attempt's subject is still on the default branch and is now stale evidence
  // — it describes work that landed, while the branch of that name carries new
  // work that has not.
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  addPlan(repo, '2026-10-01-recreated.md', {
    title: 'Recreated', slices: [{ name: 'Work', branches: ['bug/recreated'] }],
  });
  mergeWithSubject(repo, 'bug/recreated', 'Merge pull request #23 from acme/bug/recreated');
  // Recreate it with new, unlanded work.
  git(repo, 'checkout', '-q', '-b', 'bug/recreated');
  fs.writeFileSync(path.join(repo, 'second-attempt.txt'), 'new work\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'the second attempt');
  git(repo, 'push', '-q', 'origin', 'bug/recreated');
  git(repo, 'checkout', '-q', 'main');

  const b = branchOf(scanJson(fx), '2026-10-01-recreated.md', 'bug/recreated');
  assert.notEqual(b?.state, 'merged', 'a ref-carrying branch never reaches the subject arm');
  assert.equal(b?.evidence, undefined);
});

test('a backend with no form proves nothing, and says so', () => {
  const fx = makeRepo({ backend: 'gitlab', owner: 'acme' });
  const { repo, bin } = fx;
  addPlan(repo, '2026-10-01-noform.md', {
    title: 'No form', slices: [{ name: 'Work', branches: ['bug/no-form'] }],
  });
  mergeWithSubject(repo, 'bug/no-form', 'Merge pull request #24 from acme/bug/no-form');

  assert.notEqual(
    branchOf(scanJson(fx), '2026-10-01-noform.md', 'bug/no-form')?.state,
    'merged',
  );
  // `none` is a MEASUREMENT of this estate's history — it says the default
  // branch carries no conforming subject — and it is not the same answer as
  // `unaskable`, which says the rule could not be asked at all.
  assert.match(scanText(fx), /merge_detect=none/);
});

test('a missing bundle answers unaskable, and every branch goes to the host', () => {
  // THE FOOTER WORD FOR *THE RULE COULD NOT BE ASKED*. On GitHub this is worse
  // than before this plan, and the plan says so: the shell regex that answered
  // is removed, so a GitHub estate loses its subject proof while the bundle
  // cannot answer. Reported rather than hidden is the whole of the contract.
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo, bin } = fx;
  addPlan(repo, '2026-10-01-nobundle.md', {
    title: 'No bundle', slices: [{ name: 'Work', branches: ['bug/unaskable'] }],
  });
  mergeWithSubject(repo, 'bug/unaskable', 'Merge pull request #25 from acme/bug/unaskable');

  // A stub `node` that refuses THIS bundle and runs every other one, so the
  // branch-state call still answers and only the subject rule is silenced.
  const realNode = execFileSync('bash', ['-lc', 'command -v node'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(bin, 'node'), `#!/usr/bin/env bash
case "$*" in *plot-merge-subject.mjs*) exit 127 ;; esac
exec ${JSON.stringify(realNode)} "$@"
`, { mode: 0o755 });

  const text = scanText(fx);
  assert.match(text, /merge_detect=unaskable/);
  assert.notEqual(
    branchOf(scanJson(fx), '2026-10-01-nobundle.md', 'bug/unaskable')?.state,
    'merged',
    'with no rule to ask, the branch falls through to the host as it did before',
  );
});

/**
 * Replaces the fixture's host with one that ANSWERS: `pr-list` names each given
 * branch's PR as MERGED, and every call is logged.
 *
 * THE SCRIPTS ARE COPIED, because the scan resolves `plot-host.sh` from its own
 * directory and a stub reached through `PATH` is never asked. This is
 * `fleetlisting.test.mjs`'s arrangement.
 */
function answeringHost(fx, merged) {
  const scriptsCopy = path.join(fx.tmp, 'scripts');
  fs.cpSync(scripts, scriptsCopy, { recursive: true });
  const rows = merged
    .map((b, i) => `{"number":${100 + i},"state":"MERGED","head":"${b}","draft":false}`)
    .join('\n');
  fs.writeFileSync(path.join(scriptsCopy, 'plot-host.sh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(fx.log)}
case "$1" in
  backend) echo ${JSON.stringify(fx.backend)}; exit 0 ;;
  default-branch) echo main; exit 0 ;;
  pr-list)
    case "$*" in *"--state open"*) exit 0 ;; esac
    cat <<'ROWS'
${rows}
ROWS
    exit 0 ;;
  pr-state)
    echo '{"state":"MERGED"}'; exit 0 ;;
esac
exit 4
`, { mode: 0o755 });
  return path.join(scriptsCopy, 'plot-fleet-scan.sh');
}

test('a delivery candidate drops the subject evidence once the host says merged', () => {
  // THE DEFECT, measured 2026-10-02 on this estate: the candidate argument
  // `branch_readings` tests was never passed, so the host was never asked about
  // a subject-proven branch. 32 of 39 merged branches read `evidence: subject`,
  // `allSlicesConfirmed` answered `unknown` for every plan whose refs were
  // deleted at merge, and auto-deliver held them all.
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo } = fx;
  addPlan(repo, '2026-10-02-done.md', {
    title: 'Done',
    slices: [
      { name: 'First', branches: ['bug/first-landed'] },
      { name: 'Second', branches: ['bug/second-landed'] },
    ],
  });
  mergeWithSubject(repo, 'bug/first-landed', 'Merge pull request #31 from acme/bug/first-landed');
  mergeWithSubject(repo, 'bug/second-landed', 'Merge pull request #32 from acme/bug/second-landed');

  const scanCopy = answeringHost(fx, ['bug/first-landed', 'bug/second-landed']);
  const doc = JSON.parse(execFileSync('bash', [scanCopy, '--json'], {
    encoding: 'utf8', cwd: repo, env: { ...process.env, PLOT_HOST: 'github' },
  }));

  for (const br of ['bug/first-landed', 'bug/second-landed']) {
    const b = branchOf(doc, '2026-10-02-done.md', br);
    assert.equal(b?.state, 'merged', `${br} reads merged`);
    assert.equal(b?.evidence, undefined, `${br}: the host confirmed it, so the subject is no longer the proof`);
  }
});

test('a plan that is not a candidate keeps its subject evidence under an answering host', () => {
  // The second slice is outstanding, so nothing is about to be delivered and
  // the subject is enough for the wave gate. The branch is not confirmed.
  const fx = makeRepo({ backend: 'github', owner: 'acme' });
  const { repo } = fx;
  addPlan(repo, '2026-10-02-half.md', {
    title: 'Half',
    slices: [
      { name: 'First', branches: ['bug/half-landed'] },
      { name: 'Second', branches: ['bug/half-next'] },
    ],
  });
  mergeWithSubject(repo, 'bug/half-landed', 'Merge pull request #33 from acme/bug/half-landed');

  const scanCopy = answeringHost(fx, ['bug/half-landed']);
  const doc = JSON.parse(execFileSync('bash', [scanCopy, '--json'], {
    encoding: 'utf8', cwd: repo, env: { ...process.env, PLOT_HOST: 'github' },
  }));

  const b = branchOf(doc, '2026-10-02-half.md', 'bug/half-landed');
  assert.equal(b?.state, 'merged');
  assert.equal(b?.evidence, 'subject', 'not a delivery candidate, so the host is not consulted');
});
