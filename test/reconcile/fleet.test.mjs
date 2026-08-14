// Contract test for skills/plot/scripts/plot-fleet-scan.sh — the derived fleet
// view. Builds a throwaway git repo (with a local bare "origin") holding one
// wave-structured plan, plants a claimed branch and a merged branch, then
// asserts the scan reports wave eligibility from git state alone.
//
// The scan is READ-ONLY and STATELESS: every fact it prints is re-derived from
// refs on each run. There is no fleet database — that is the design (Manifesto
// Principle 1), and these tests are what hold it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-fleet-scan.sh');

let tmp, repo, report;

function git(cwd, ...args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd });
}
function write(rel, content) {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-'));
  const origin = path.join(tmp, 'origin.git');
  repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  write('CLAUDE.md', `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`);

  // Wave 1 (Tracer) has one branch, merged below → wave 2 becomes eligible.
  // Wave 2 has three branches: one claimed (pushed, empty), one deferred
  // (never eligible), one unclaimed. Wave 3 stays blocked behind wave 2.
  // A pre-wave plan: no ### subheadings, so one unnamed wave. Its branch line
  // must still render as a branch — an empty wave name must not shift fields.
  // It also cites a docs/ FILE PATH and an idea/ branch: neither is
  // implementation work, and neither may enter the wave arithmetic.
  write('plans/2026-01-02-legacy.md', `# Legacy plan without waves

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/no-waves\` — the only implementation branch
- see \`docs/some-note.md\` for background
- planning lived on \`idea/legacy\`
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.symlinkSync('../2026-01-02-legacy.md', path.join(repo, 'plans', 'active', 'legacy.md'));

  write('plans/2026-01-01-fleet.md', `# Fleet plan

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Branches

### Tracer
- \`feature/tracer\` — thin slice

### Implementation
- \`feature/claimed-one\` — taken <!-- claimed: 2026-01-02T09:00Z, session-1 -->
- \`feature/unclaimed\` — free
- \`feature/dropped\` — not needed <!-- deferred: folded into tracer -->

### Wave 3
- \`feature/later\` — blocked behind wave 2
`);
  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.symlinkSync('../2026-01-01-fleet.md', path.join(repo, 'plans', 'active', 'fleet.md'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'plan');
  git(repo, 'push', '-q', 'origin', 'main');

  // Wave 1's branch: real work, merged to main → wave 1 complete.
  git(repo, 'checkout', '-qb', 'feature/tracer');
  write('src/tracer.txt', 'thin slice\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'tracer work');
  git(repo, 'push', '-q', '-u', 'origin', 'feature/tracer');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge tracer', 'feature/tracer');
  git(repo, 'push', '-q', 'origin', 'main');

  // A claim: branch pushed carrying only a CLAIM COMMIT. The commit is what
  // makes claiming exclusive — a branch merely pointing at main does not
  // diverge from it, so a second dispatcher's push would succeed and both
  // would think they held it (see plot-dispatch.sh, "THE CLAIM").
  git(repo, 'checkout', '-qb', 'feature/claimed-one');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/claimed-one');
  git(repo, 'push', '-q', '-u', 'origin', 'feature/claimed-one');
  git(repo, 'checkout', '-q', 'main');

  report = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('fleet: reports the plan with its wave structure', () => {
  assert.match(report, /2026-01-01-fleet\.md/);
  assert.match(report, /Tracer/);
  assert.match(report, /Implementation/);
});

test('fleet: a wave whose branches are all merged reports as complete', () => {
  assert.match(report, /Tracer.*complete/is);
});

test('fleet: the wave after a complete wave is eligible', () => {
  assert.match(report, /Implementation.*eligible/is);
});

test('fleet: a wave behind an incomplete wave is blocked', () => {
  assert.match(report, /Wave 3.*blocked/is);
});

test('fleet: a claimed branch with no commits is reported as claimed', () => {
  assert.match(report, /feature\/claimed-one.*claimed/is);
});

test('fleet: a deferred branch never counts as outstanding work', () => {
  assert.match(report, /feature\/dropped.*deferred/is);
});

test('fleet: emits a machine-countable summary footer', () => {
  // Same contract shape as plot-reconcile-scan.sh: callers read the footer,
  // never re-count the body.
  const footer = report.trim().split('\n').at(-1);
  assert.match(footer, /^summary: /);
  assert.match(footer, /plans=2/);
  // 3 waves in the fleet plan + 1 unnamed wave in the legacy plan.
  assert.match(footer, /waves=4/);
  assert.match(footer, /claimed=1/);
  // eligible counts branches a worker could pick up RIGHT NOW: in an eligible
  // wave, not already claimed, not deferred, not merged. Here that is
  // feature/unclaimed alone — claimed-one is taken, dropped is deferred.
  // feature/unclaimed (fleet plan) + feature/no-waves (legacy plan).
  assert.match(footer, /eligible=2/);
  assert.match(footer, /blocked=1/);
  assert.match(footer, /deferred=1/);
});

test('fleet: branches without a claim note keep their state (IFS collapse)', () => {
  // Regression: tab is an IFS whitespace character, so bash collapses runs of
  // tabs into one separator. With the claim note in a middle column, every
  // unclaimed branch shifted its later fields left and lost its git state —
  // merged branches silently read as "open", which would make a completed wave
  // look outstanding forever. Unclaimed branches must still report truthfully.
  assert.match(report, /feature\/tracer — merged/);
  assert.match(report, /feature\/unclaimed — open/);
  assert.match(report, /feature\/dropped — deferred/);
});

test('fleet: an unnamed wave renders its branch as a branch, not as a wave name', () => {
  // Regression: with no ### subheading the wave name is empty, and the IFS
  // tab-collapse shifted the branch into the wave-name column — the report
  // printed "feature/no-waves — eligible" as a heading with an empty branch
  // under it.
  assert.match(report, /\(unnamed\) — eligible/);
  assert.match(report, /feature\/no-waves — open/);
  assert.doesNotMatch(report, /^ *feature\/no-waves — eligible/m);
});

test('fleet: a docs/ file path in a plan is not treated as a branch', () => {
  // `docs/` is a branch prefix, so the parser scrapes any backticked token
  // that looks like one. A cited file path is not implementation work and must
  // not enter the wave arithmetic.
  assert.doesNotMatch(report, /docs\/some-note\.md/);
});

test('fleet: an idea/ branch is not implementation work', () => {
  // idea/ branches carry the plan itself, never implementation. Counting one
  // as outstanding work would keep a finished wave blocked forever.
  assert.doesNotMatch(report, /idea\/legacy/);
});

test('fleet: --next names one branch a worker may claim right now', () => {
  // /plot-implement asks "what may I take?" and must get an answer it can act
  // on without re-deriving eligibility itself. Bare branch name on stdout,
  // nothing else — a shell can use it directly.
  const out = execFileSync('bash', [scan, '--offline', '--next'],
    { encoding: 'utf8', cwd: repo });
  // feature/unclaimed and feature/no-waves are both free; either is a correct
  // answer, but claimed/deferred/merged branches never are.
  const picked = out.trim();
  assert.match(picked, /^(feature\/unclaimed|feature\/no-waves)$/);
});

test('fleet: strict is the default — an unmerged prior wave blocks the next', () => {
  // The default must be the safe one. `loose` trades rebase safety for
  // throughput, so it has to be asked for explicitly.
  assert.match(report, /Wave 3 — blocked/);
});

test('fleet: --loose opens a wave whose prior branches are pushed but unmerged', () => {
  // The real difference: a prior wave with WORK PUSHED but not merged blocks
  // under strict and opens under loose. That is the throughput/rebase-risk
  // trade the plan makes explicit.
  const lt = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loose-'));
  const bare = path.join(lt, 'origin.git');
  const r = path.join(lt, 'repo');
  git(lt, 'init', '--bare', '-q', '-b', 'main', bare);
  git(lt, 'clone', '-q', bare, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-two.md'),
    '# Two\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n- `feature/first` — has work, not merged\n\n### Two\n- `feature/second` — waits on first\n');
  fs.symlinkSync('../2026-01-01-two.md', path.join(r, 'plans', 'active', 'two.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');
  // feature/first: real work pushed, NOT merged.
  git(r, 'checkout', '-q', '-b', 'feature/first');
  fs.writeFileSync(path.join(r, 'work.txt'), 'done\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'work');
  git(r, 'push', '-q', '-u', 'origin', 'feature/first');
  git(r, 'checkout', '-q', 'main');

  const strict = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: r });
  assert.match(strict, /Two — blocked/, 'strict must block on an unmerged prior wave');

  // --loose no longer opens a wave on pushed work ALONE. It promises "green and
  // ready", which needs the git host; with none reachable here, readiness
  // cannot be verified and loose must degrade to strict rather than assume it.
  // (An earlier version opened the wave on any pushed commit — weaker than
  // promised, and it would build the next wave on possibly-red code.)
  const loose = execFileSync('bash', [scan, '--offline', '--loose'], { encoding: 'utf8', cwd: r });
  assert.match(loose, /Two — blocked/, 'unverifiable readiness must not open the wave');
  assert.match(loose, /cannot verify/i, 'and the report must say why');

  fs.rmSync(lt, { recursive: true, force: true });
});

test('fleet: --list-eligible names every claimable branch, one per line', () => {
  // --next answers "give me one" (pull, for a worker). --list-eligible answers
  // "how many could run" (for a dry run, which changes nothing and so cannot
  // go stale). Both must be machine-readable: no consumer should ever parse
  // the human report.
  const out = execFileSync('bash', [scan, '--offline', '--list-eligible'],
    { encoding: 'utf8', cwd: repo });
  const lines = out.trim().split('\n').filter(Boolean).sort();
  assert.deepEqual(lines, ['feature/no-waves', 'feature/unclaimed']);
});

test('fleet: --next exits 1 in a repo with no plans at all', () => {
  // The no-plans early exit returned 0 regardless of mode, so a caller doing
  // `BRANCH=$(... --next) || exit` would accept an EMPTY branch name as a
  // valid answer and try to claim it. Exit 1 is the contract: "nothing to
  // start", whatever the reason.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-noplans-'));
  const o = path.join(bare, 'origin.git');
  const r = path.join(bare, 'repo');
  git(bare, 'init', '--bare', '-q', '-b', 'main', o);
  git(bare, 'clone', '-q', o, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(r, 'README.md'), '# no plot config here\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'init');
  git(r, 'push', '-q', 'origin', 'main');

  let code = 0, stdout = '';
  try {
    stdout = execFileSync('bash', [scan, '--offline', '--next'], { encoding: 'utf8', cwd: r });
  } catch (e) {
    code = e.status;
    stdout = e.stdout ?? '';
  }
  assert.equal(code, 1, '--next must exit 1 when there is nothing to start');
  assert.equal(stdout.trim(), '', '--next must print nothing but a branch name');
  fs.rmSync(bare, { recursive: true, force: true });
});

test('fleet: --next stays silent when nothing is claimable', () => {
  // Empty output, exit 1: "nothing to start" is a normal state, not an error
  // condition to crash on, but it must be distinguishable from a name.
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-none-'));
  const bare = path.join(blocked, 'origin.git');
  const r = path.join(blocked, 'repo');
  git(blocked, 'init', '--bare', '-q', '-b', 'main', bare);
  git(blocked, 'clone', '-q', bare, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-done.md'),
    '# Done\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n- `feature/gone` — deferred <!-- deferred: no longer needed -->\n');
  fs.symlinkSync('../2026-01-01-done.md', path.join(r, 'plans', 'active', 'done.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');

  let stdout = '', code = 0;
  try {
    stdout = execFileSync('bash', [scan, '--offline', '--next'], { encoding: 'utf8', cwd: r });
  } catch (e) {
    stdout = e.stdout ?? '';
    code = e.status;
  }
  assert.equal(stdout.trim(), '');
  assert.equal(code, 1);
  fs.rmSync(blocked, { recursive: true, force: true });
});

test('fleet: --log-pulse appends one line to the plan, clean pulses included', () => {
  // Lloyd's lesson applied: a pulse that finds nothing wrong must still say so,
  // or an idle fleet and a dead fleet look identical. This is the ONLY thing
  // the pulse ever writes, and it is a log, not state — deleting the whole log
  // changes no behaviour, because the next pulse re-derives everything.
  const plan = path.join(repo, 'plans', '2026-01-01-fleet.md');
  const before = fs.readFileSync(plan, 'utf8');
  assert.ok(!before.includes('<!-- pulse:'), 'precondition: no pulse lines yet');

  execFileSync('bash', [scan, '--offline', '--log-pulse', 'fleet'],
    { encoding: 'utf8', cwd: repo });

  const after = fs.readFileSync(plan, 'utf8');
  const lines = after.split('\n').filter((l) => l.includes('<!-- pulse:'));
  assert.equal(lines.length, 1, 'exactly one pulse line per run');
  assert.match(lines[0], /eligible=\d+/);
  assert.match(lines[0], /claimed=\d+/);

  // A second run appends rather than replacing — the log is a history.
  execFileSync('bash', [scan, '--offline', '--log-pulse', 'fleet'],
    { encoding: 'utf8', cwd: repo });
  const twice = fs.readFileSync(plan, 'utf8').split('\n')
    .filter((l) => l.includes('<!-- pulse:'));
  assert.equal(twice.length, 2);

  // Restore: every other test in this file asserts on an unmodified repo.
  fs.writeFileSync(plan, before);
});

test('fleet: scan is read-only — working tree and refs unchanged', () => {
  const status = git(repo, 'status', '--porcelain');
  assert.equal(status.trim(), '', 'scan must not modify the working tree');
});

test('fleet: the scan stays read-only by default, so internal callers cannot write', () => {
  // A tension worth naming: Lloyd's lesson says log clean pulses or you cannot
  // tell an idle fleet from a dead one. Plot's architecture says the scan is
  // read-only. Both hold — but only because the DEFAULT lives in the skill,
  // not the script.
  //
  // /plot-implement and /plot-dispatch both call this script internally (for
  // --next). If writing were the script's default, claiming a branch would
  // silently amend the plan file mid-dispatch. So: the script writes only when
  // asked, and /plot-fleet — the human-facing command — asks every time.
  const plan = path.join(repo, 'plans', '2026-01-01-fleet.md');
  const before = fs.readFileSync(plan, 'utf8');

  execFileSync('bash', [scan, '--offline', 'fleet'], { encoding: 'utf8', cwd: repo });
  execFileSync('bash', [scan, '--offline', '--next', 'fleet'], { encoding: 'utf8', cwd: repo });

  assert.equal(fs.readFileSync(plan, 'utf8'), before,
    'no invocation without --log-pulse may modify a plan');
});

test('fleet: --loose needs a ready, non-draft PR — not merely pushed work', () => {
  // The plan promises loose means "the prior wave's PRs are green and ready".
  // An earlier implementation accepted ANY pushed commit, so a branch with red
  // CI or a draft PR opened the next wave — the next wave then building on a
  // seam that is not merely unlanded but possibly broken. Strictly worse than
  // the promised semantics, so the code follows the promise.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loose2-'));
  const bare = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', bare);
  git(t, 'clone', '-q', bare, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-l.md'),
    '# L\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n- `feature/first` — pushed, but no ready PR\n\n### Two\n- `feature/second` — waits\n');
  fs.symlinkSync('../2026-01-01-l.md', path.join(r, 'plans', 'active', 'l.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');
  git(r, 'checkout', '-q', '-b', 'feature/first');
  fs.writeFileSync(path.join(r, 'work.txt'), 'done\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'work');
  git(r, 'push', '-q', '-u', 'origin', 'feature/first');
  git(r, 'checkout', '-q', 'main');

  // No git-host CLI is reachable in this sandbox, so PR readiness cannot be
  // established. --loose must then behave like strict rather than assume the
  // best: an unverifiable claim of readiness is not readiness.
  const loose = execFileSync('bash', [scan, '--offline', '--loose'],
    { encoding: 'utf8', cwd: r });
  assert.match(loose, /Two — blocked/,
    'without verifiable PR readiness, --loose must not open the next wave');
  assert.match(loose, /cannot verify|degraded|strict/i,
    'and it must say why, rather than silently behaving like strict');

  fs.rmSync(t, { recursive: true, force: true });
});

test('fleet: --loose DOES open a wave when the host reports a ready PR', () => {
  // Every other --loose test passes --offline, which disables the fetch and so
  // makes loose_verifiable=1 unreachable — the positive path was never
  // exercised, only the degraded one. A stubbed host covers it.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loosepos-'));
  const o = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', o);
  git(t, 'clone', '-q', o, 'repo');
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    '## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n');
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-lp.md'),
    '# LP\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n- `feature/first` — pushed, PR open and ready\n\n### Two\n- `feature/second` — waits on wave one\n');
  fs.symlinkSync('../2026-01-01-lp.md', path.join(r, 'plans', 'active', 'lp.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');
  git(r, 'checkout', '-q', '-b', 'feature/first');
  fs.writeFileSync(path.join(r, 'work.txt'), 'done\n');
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'work');
  git(r, 'push', '-q', '-u', 'origin', 'feature/first');
  git(r, 'checkout', '-q', 'main');

  // Stub the host adapter on PATH: a backend exists, and the PR is ready.
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-hostshim-'));
  const realScripts = path.dirname(scan);
  fs.mkdirSync(path.join(shim, 'scripts'));
  for (const f of fs.readdirSync(realScripts)) {
    if (f.endsWith('.sh')) fs.copyFileSync(path.join(realScripts, f), path.join(shim, 'scripts', f));
  }
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'),
    '#!/usr/bin/env bash\ncase "$1" in\n  backend) echo github ;;\n  pr-state) echo \'{"number":1,"state":"OPEN","draft":false,"url":"x"}\' ;;\n  default-branch) echo main ;;\n  *) echo "{}" ;;\nesac\n');
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);

  const shimScan = path.join(shim, 'scripts', 'plot-fleet-scan.sh');
  // No --offline: the fetch must run for readiness to be considered verifiable.
  const loose = execFileSync('bash', [shimScan, '--loose', 'lp'], { encoding: 'utf8', cwd: r });
  assert.match(loose, /Two — eligible/,
    'a ready, non-draft PR must satisfy loose eligibility');
  assert.match(loose, /loose eligibility/, 'and the banner must say loose is active');

  // Draft PRs must not satisfy it — readiness means ready.
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'),
    '#!/usr/bin/env bash\ncase "$1" in\n  backend) echo github ;;\n  pr-state) echo \'{"number":1,"state":"OPEN","draft":true,"url":"x"}\' ;;\n  default-branch) echo main ;;\n  *) echo "{}" ;;\nesac\n');
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);
  const draft = execFileSync('bash', [shimScan, '--loose', 'lp'], { encoding: 'utf8', cwd: r });
  assert.match(draft, /Two — blocked/, 'a draft PR is not "ready"');

  fs.rmSync(shim, { recursive: true, force: true });
  fs.rmSync(t, { recursive: true, force: true });
});
