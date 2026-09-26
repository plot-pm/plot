// Contract test for the two questions the word `eligible` was answering —
// `plot-fleet-scan.sh` must say which of them it means.
//
// The defect this holds shut, reported 2026-09-25 from a Bitbucket estate at
// 2.20.0 (#994): one wave printed `eligible` with eleven branches, the footer
// read `eligible=0`, and both offer paths answered nothing. Reproduced on the
// GitHub estate while this was built — three waves read `eligible` against
// `claimable=1`. Nothing was lying. The body word answers *are this wave's
// prerequisites met?* (`sliceVerdict`) and the footer key and the offer paths
// answer *can a branch here be claimed now?* (`isClaimable`), and a wave being
// worked on satisfies the first and not the second. One word carried both.
//
// THE FIX IS NAMING, NOT LOGIC. Both computations were already correct, so
// every assertion below is about what the scan SAYS. The two that would catch a
// fix that changed the arithmetic instead are the `--json` verdict and the
// free-branch control.
//
// A SEPARATE FIXTURE from fleet.test.mjs, for the reason fleetunapproved.test.mjs
// states: that file's `Implementation` wave holds a free branch and its
// `eligible=2` footer is the regression lock for the ordinary case. A
// claimed-out wave cannot be added to it without deleting that evidence — and
// that file runs 355-544 s, where this one runs in seconds.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

let tmp, repo, empty, report, json;

// PLOT_REPO_ROOT IS SCRUBBED, and the sandbox is the point. Since
// `config-takes-the-callers-root`, `plot-config.sh` prefers an exported
// `PLOT_REPO_ROOT` over `git rev-parse`, so a run inheriting one from a
// dispatched worker reads the HOST repo's `## Plot Config` rather than this
// sandbox's — the hazard `a-sandbox-does-not-inherit-its-host` (#1000) closed
// for the tests that leaked manifests. Measured while this file was written:
// with the variable inherited the scan answered `No plans found in docs/plans/`
// for a fixture declaring `plans/`, so every assertion here failed against an
// estate that was never read. The guard in `plot-config.sh` tests that the
// path is a DIRECTORY, which catches a stale root and cannot catch a valid one
// naming another repository. The env must not decide it.
const sandboxEnv = () => {
  const env = { ...process.env };
  delete env.PLOT_REPO_ROOT;
  return env;
};

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function write(rel, content) {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
const config = `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-claimable-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  write('CLAUDE.md', config);

  // THE MEASURED SHAPE: a one-wave approved plan whose only branch is claimed.
  // No earlier wave blocks it, so the wave answer is `eligible` and correct;
  // the branch is taken, so no offer path will name it and that is correct too.
  write('plans/2026-01-05-claimed-out.md', `# Every candidate is taken

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

### Taken
- \`bug/already-claimed\` — somebody has it <!-- claimed: 2026-01-05T09:00Z, session-1 -->
`);

  // THE CONTROL, and the reason a suffix that fires on every eligible wave does
  // not pass: same shape, same absence of an earlier wave, only the claim
  // differs.
  write('plans/2026-01-06-one-free.md', `# One branch anybody may take

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Free
- \`feature/nobody-has-it\` — startable
`);

  // A SECOND WAVE WITH A FREE BRANCH, and one that was never pushed at all.
  //
  // IT READS `open`, NOT `unknown` — measured while writing this file, and the
  // scan's header says why: a no-ref branch reads `unknown` only where the host
  // is throttled, secondary or failed, and under `host=unasked` nothing
  // contradicted `open`. So this wave keeps bare `eligible` and its branch is
  // counted claimable, which is the right answer and not the one the fixture
  // was first written to demonstrate.
  //
  // THE `unknown` EXCLUSION IS HELD BY CONSTRUCTION RATHER THAN BY A FIXTURE:
  // the suffix fires on a `case "$st" in claimed|wip)` that names the two taken
  // states positively, so no third state can reach it. Producing a real
  // `unknown` needs a host stub that FAILS, which is `fleetderived.test.mjs`'s
  // fixture and a different subject; asserting it here would test the stub.
  write('plans/2026-01-07-second-free.md', `# Another branch anybody may take

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

### Unpushed
- \`bug/never-pushed\` — no ref, and nothing says otherwise
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plans');
  git(repo, 'push', '-q', 'origin', 'main');

  // The claim: a branch pushed carrying only a claim commit, which is what
  // makes claiming exclusive (see plot-dispatch.sh, "THE CLAIM").
  git(repo, 'checkout', '-qb', 'bug/already-claimed');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'plot: claim bug/already-claimed');
  git(repo, 'push', '-q', '-u', 'origin', 'bug/already-claimed');
  git(repo, 'checkout', '-q', 'main');

  // An estate with NO plans at all — the second of the two silences
  // `--list-eligible` must tell apart.
  empty = path.join(tmp, 'empty');
  const emptyOrigin = path.join(tmp, 'empty-origin.git');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', emptyOrigin);
  git(tmp, 'clone', '-q', emptyOrigin, empty);
  git(empty, 'config', 'user.email', 'test@example.invalid');
  git(empty, 'config', 'user.name', 'Plot Test');
  git(empty, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(empty, 'CLAUDE.md'), config);
  fs.mkdirSync(path.join(empty, 'plans', 'active'), { recursive: true });
  git(empty, 'add', '-A');
  git(empty, 'commit', '-qm', 'config only');
  git(empty, 'push', '-q', 'origin', 'main');

  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo, env: sandboxEnv() });
  json = JSON.parse(execFileSync('bash', [scan, '--offline', '--json'],
    { encoding: 'utf8', cwd: repo, env: sandboxEnv() }));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const waveOf = (slug, name) =>
  json.plans.find((p) => p.file.includes(slug)).waves.find((w) => w.name === name);
const footer = () => report.trim().split('\n').at(-1);

// Done-when 2 — the wave line agrees with its branch lines. A reader comparing
// the two no longer has to resolve a contradiction to learn which is true.
test('fleet: a wave whose every branch is taken says so on its own line', () => {
  assert.match(report, /Taken — eligible — someone-is-on-it/);
  assert.match(report, /bug\/already-claimed — claimed/);
});

// The control. A suffix that fires on every eligible wave passes the test above
// and destroys the word for the case an operator acts on.
test('fleet: a wave holding a free branch keeps bare eligible', () => {
  assert.match(report, /Free — eligible$/m);
  assert.doesNotMatch(report, /Free — eligible — /);
});

// THE SUFFIX NAMES THE TAKEN STATES RATHER THAN NEGATING THE CLAIMABLE FLAG —
// that flag is 0 for six different reasons and only `claimed` and `wip` mean a
// person is on it. A branch that was never pushed is one of the other five: it
// is free, so the wave keeps bare `eligible` and nobody is reported on it.
test('fleet: a wave whose branch was never pushed claims nobody is on it', () => {
  assert.match(report, /Unpushed — eligible$/m);
  assert.doesNotMatch(report, /Unpushed — eligible — /);
});

// Done-when 1 — the footer's branch-counting key is named for what it counts,
// and a reader can tell it from the wave counts beside it.
test('fleet: the footer names the branch count claimable', () => {
  assert.match(footer(), /^summary: /);
  // Two free branches across the estate — nobody-has-it and never-pushed —
  // against three waves that all read `eligible`. THAT GAP IS THE DEFECT:
  // before the rename a reader compared `eligible` in three body lines with one
  // `eligible=2` in the footer and had no way to know the two words counted
  // different things. Now the key says which it counts, and the body line of
  // the third wave says it is taken.
  assert.match(footer(), /waves=3/);
  assert.match(footer(), /claimable=2/);
  assert.match(footer(), /claimed=1/);
});

// `eligible=` IS KEPT, carrying the same number. Three tests and
// skills/plot-pulse/SKILL.md read it, so removing it would break consumers the
// rename was not about.
test('fleet: the old eligible key stays beside it with the same value', () => {
  assert.match(footer(), /claimable=2 eligible=2/);
});

// The suffix is PROSE IN THE HUMAN BODY ONLY. `FleetWaveSchema.verdict` is a
// strict enum, so a parsed pulse could not carry a new word — a suffix leaking
// into the machine output would make the board reject the whole payload.
test('fleet: the json verdict of a claimed-out wave is still eligible', () => {
  assert.equal(waveOf('claimed-out', 'Taken').verdict, 'eligible');
  assert.equal(waveOf('one-free', 'Free').verdict, 'eligible');
});

// Done-when 3 — the first of the two silences, with the stdout assertion that
// catches a sentence echoed to the wrong stream. plot-dispatch.sh pipes this
// stdout through `sort -u` and dispatches every line it holds.
test('fleet: --list-eligible says on stderr when every candidate is taken', () => {
  const r = spawnSync('bash', [scan, '--offline', '--list-eligible', 'claimed-out'],
    { encoding: 'utf8', cwd: repo, env: sandboxEnv() });
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), '');
  assert.match(r.stderr, /nothing claimable/);
  assert.match(r.stderr, /1 branch\(es\) in eligible waves are taken/);
});

// Done-when 3 — the second silence. An estate with no plans exits before the
// candidate set exists, so it must NOT claim branches are taken.
test('fleet: --list-eligible on an empty estate does not claim work is taken', () => {
  const r = spawnSync('bash', [scan, '--offline', '--list-eligible'],
    { encoding: 'utf8', cwd: empty, env: sandboxEnv() });
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), '');
  assert.doesNotMatch(r.stderr, /are taken/);
});

// The third case: a free branch is still named, on stdout, and nothing is said
// about silence. A fix that prints the sentence unconditionally fails here.
test('fleet: --list-eligible still names a free branch on stdout', () => {
  const r = spawnSync('bash', [scan, '--offline', '--list-eligible', 'one-free'],
    { encoding: 'utf8', cwd: repo, env: sandboxEnv() });
  assert.equal(r.status, 0);
  assert.deepEqual(r.stdout.trim().split('\n').filter(Boolean), ['feature/nobody-has-it']);
  assert.doesNotMatch(r.stderr, /nothing claimable/);
});

// Done-when 4 — `--next` IS UNTOUCHED. Its exit-1 contract is shipped,
// documented and tested twice, and a worker reading it has nothing to read a
// sentence with, so the stderr sentence must not appear on this path.
test('fleet: --next stays silent on both streams when nothing is claimable', () => {
  const r = spawnSync('bash', [scan, '--offline', '--next', 'claimed-out'],
    { encoding: 'utf8', cwd: repo, env: sandboxEnv() });
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), '');
  assert.equal(r.stderr.trim(), '');
});
