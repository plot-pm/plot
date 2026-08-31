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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
  //
  // Readiness now rides the ROLLUP, not the draft flag alone: `--loose` opens a
  // wave only when the prior wave's PR is green AND non-draft, and it reads that
  // from the ONE `pr-list --rich` the scan already makes — never a per-branch
  // `pr-state`. So the signal lives in the `pr-list` reply here; `pr-state`
  // remains stubbed as a witness that it is NOT consulted on this path.
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-hostshim-'));
  const realScripts = path.dirname(scan);
  fs.mkdirSync(path.join(shim, 'scripts'));
  for (const f of fs.readdirSync(realScripts)) {
    if (f.endsWith('.sh')) fs.copyFileSync(path.join(realScripts, f), path.join(shim, 'scripts', f));
  }
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'),
    '#!/usr/bin/env bash\ncase "$1" in\n  backend) echo github ;;\n  pr-state) echo \'{"number":1,"state":"OPEN","draft":false,"url":"x"}\' ;;\n  pr-list) echo \'{"number":1,"title":"t","state":"OPEN","head":"feature/first","draft":false,"checks":"green","mergeable":"mergeable","review":"","url":"x","failing_checks":[]}\' ;;\n  default-branch) echo main ;;\n  *) echo "{}" ;;\nesac\n');
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);

  const shimScan = path.join(shim, 'scripts', 'plot-fleet-scan.sh');
  // No --offline: the fetch must run for readiness to be considered verifiable.
  const loose = execFileSync('bash', [shimScan, '--loose', 'lp'], { encoding: 'utf8', cwd: r });
  assert.match(loose, /Two — eligible/,
    'a ready, green, non-draft PR must satisfy loose eligibility');
  assert.match(loose, /loose eligibility/, 'and the banner must say loose is active');

  // Draft PRs must not satisfy it — readiness means ready. The rollup is green
  // but the PR is a draft, so the wave must stay blocked.
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'),
    '#!/usr/bin/env bash\ncase "$1" in\n  backend) echo github ;;\n  pr-state) echo \'{"number":1,"state":"OPEN","draft":true,"url":"x"}\' ;;\n  pr-list) echo \'{"number":1,"title":"t","state":"OPEN","head":"feature/first","draft":true,"checks":"green","mergeable":"mergeable","review":"","url":"x","failing_checks":[]}\' ;;\n  default-branch) echo main ;;\n  *) echo "{}" ;;\nesac\n');
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);
  const draft = execFileSync('bash', [shimScan, '--loose', 'lp'], { encoding: 'utf8', cwd: r });
  assert.match(draft, /Two — blocked/, 'a draft PR is not "ready"');

  fs.rmSync(shim, { recursive: true, force: true });
  fs.rmSync(t, { recursive: true, force: true });
});

// --- --json: the machine rendering -----------------------------------------
//
// The scan's prose is a HUMAN interface, not a contract (Manifesto Principle
// 3). That is exactly why `--json` exists: the board must not screen-scrape
// lines like "  Tracer — eligible", where a wording change would silently
// break it. Two properties matter, and the second matters more.

test('--json leaves the human report byte-identical', () => {
  const prose = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
  // Same run, same repo, no --json: adding a machine mode must not reshape the
  // rendering people read. This is the regression that protects the change.
  const again = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
  assert.equal(again, prose, 'the prose report must be stable across runs');
  const json = execFileSync('bash', [scan, '--offline', '--json'], { encoding: 'utf8', cwd: repo });
  assert.doesNotMatch(json, /^plot-fleet pulse/m, '--json must not emit the prose banner');
  assert.doesNotMatch(json, /Pulse complete/, '--json must not emit the prose footer');
});

test('--json emits one parseable object carrying the derived state', () => {
  const out = execFileSync('bash', [scan, '--offline', '--json'], { encoding: 'utf8', cwd: repo });
  const doc = JSON.parse(out); // throws → test fails, which is the assertion

  assert.equal(doc.main, 'main');
  assert.ok(Array.isArray(doc.plans), 'plans must be an array');

  const fleet = doc.plans.find((p) => p.file.includes('2026-01-01-fleet.md'));
  assert.ok(fleet, 'the wave-structured plan must appear');

  const names = fleet.waves.map((w) => w.name);
  assert.deepEqual(names, ['Tracer', 'Implementation', 'Wave 3'],
    'wave order and names come from the plan, unchanged');

  const byName = (n) => fleet.waves.find((w) => w.name === n);
  assert.equal(byName('Tracer').verdict, 'complete');
  assert.equal(byName('Implementation').verdict, 'eligible');
  assert.equal(byName('Wave 3').verdict, 'blocked');

  // The state vocabulary is the script's INTERNAL one, not the prose labels:
  // "wip", never "in progress". The board must not parse a human label.
  const impl = byName('Implementation').branches;
  const find = (b) => impl.find((x) => x.branch === b);
  assert.equal(find('feature/claimed-one').state, 'claimed');
  assert.equal(find('feature/unclaimed').state, 'open');
  assert.equal(find('feature/dropped').state, 'deferred');
  assert.equal(find('feature/dropped').deferred, true);
  assert.ok(find('feature/claimed-one').claimed.includes('session-1'),
    'the claim note travels with the branch');

  // House style, matching plot-plan-meta.sh: `branch`, and "" (not null) for
  // an absent claim. Two JSON conventions in one repo is the thing to avoid.
  assert.equal(find('feature/unclaimed').claimed, '');

  assert.equal(doc.summary.plans, 2, 'both fixture plans are counted');
  assert.equal(doc.summary.deferred, 1);
  assert.equal(doc.summary.blocked, 1);
});

test('--json composes with other flags rather than implying them', () => {
  // A flag that silently changed network behaviour would make the board's data
  // depend on HOW it asked rather than WHAT it asked for.
  const a = execFileSync('bash', [scan, '--offline', '--json'], { encoding: 'utf8', cwd: repo });
  const b = execFileSync('bash', [scan, '--json', '--offline'], { encoding: 'utf8', cwd: repo });
  assert.deepEqual(JSON.parse(a), JSON.parse(b), 'flag order must not matter');

  // --next is a different output mode and wins: it prints one branch name.
  const next = execFileSync('bash', [scan, '--offline', '--json', '--next'],
    { encoding: 'utf8', cwd: repo }).trim();
  assert.doesNotMatch(next, /[{}]/, '--next stays a bare branch name, not JSON');
});

// --- a merged-and-deleted branch is not an unstarted branch ------------------
//
// `branch_state()` used to open with one question — does the remote ref exist?
// Absence carries two meanings and the answer `open` served both: a branch that
// was never started, and a branch whose PR merged and whose ref was deleted at
// merge. The wave arithmetic reads `open` as OUTSTANDING, so a finished wave
// stayed open forever and `--next` named finished work as the next thing to
// start — which is exactly the question plot-dispatch.sh asks before fanning
// out.
//
// The evidence that survives the ref is the merge commit on the default branch,
// matched by an ANCHORED subject:
//
//     ^Merge pull request #<n> from <owner>/<branch>$
//
// Read the plan (docs/plans/2026-08-16-fleet-sees-merged-branches.md) before
// changing any of this. Two structural filters that looked right were measured
// and REMOVED, and the tests below are what keep them out:
//
//   * a first-parent filter — catches zero traps the anchored pattern misses
//     (108 = 108 on this repo) and breaks GitFlow. Pinned by the develop test.
//   * a second-parent counter-check — PR merges and backward merges are
//     identical under it. Pinned by the backward-merge test.
//
// Assertions here are PER LINE. Whole-output regexes have fooled this suite
// three times by matching across report lines or into the summary footer.

// One report line at a time — see above.
const lines = (out, re) => out.split('\n').filter((l) => re.test(l));
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const branchLine = (out, br) => {
  const found = lines(out, new RegExp(`^ {6}${rx(br)} — `));
  assert.equal(found.length, 1, `expected exactly one report line for ${br}`);
  return found[0];
};
const waveLine = (out, name) => {
  const found = lines(out, new RegExp(`^ {2}${name} — `));
  assert.equal(found.length, 1, `expected exactly one wave line for ${name}`);
  return found[0];
};
const footerOf = (out) => {
  const found = lines(out, /^summary: /);
  assert.equal(found.length, 1, 'exactly one summary footer');
  return found[0];
};

// A throwaway repo with a bare "origin", a Plot config, and one plan. Returns
// helpers bound to it. `main` names the default branch, so the develop fixture
// can prove MAIN resolution is honoured rather than assumed.
function makeRepo(prefix, planBody, { main = 'main' } = {}) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const bare = path.join(t, 'origin.git');
  const r = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', main, bare);
  git(t, 'clone', '-q', bare, r);
  git(r, 'config', 'user.email', 'test@example.invalid');
  git(r, 'config', 'user.name', 'Plot Test');
  git(r, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(r, 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(r, 'CLAUDE.md'),
    `## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n${
      main === 'main' ? '' : `- **Main branch:** ${main}\n`}`);
  fs.writeFileSync(path.join(r, 'plans', '2026-01-01-p.md'), planBody);
  fs.symlinkSync('../2026-01-01-p.md', path.join(r, 'plans', 'active', 'p.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', main);
  return {
    dir: r,
    root: t,
    // Merge `br` into `into` the way GitHub does, with the anchored subject.
    prMerge(br, into = main, owner = 'plot-pm') {
      git(r, 'checkout', '-q', into);
      git(r, 'merge', '-q', '--no-ff', '-m',
        `Merge pull request #7 from ${owner}/${br}`, br);
    },
    work(br, file, from = main) {
      git(r, 'checkout', '-q', from);
      git(r, 'checkout', '-qb', br);
      fs.writeFileSync(path.join(r, file), 'work\n');
      git(r, 'add', '-A');
      git(r, 'commit', '-qm', `work on ${br}`);
    },
    push(...args) { git(r, 'push', '-q', ...args); },
    run(extra = [], env = {}) {
      return execFileSync('bash', [scan, '--offline', ...extra],
        { encoding: 'utf8', cwd: r, env: { ...process.env, ...env } });
    },
    cleanup() { fs.rmSync(t, { recursive: true, force: true }); },
  };
}

const ONE_WAVE = (branch) =>
  `# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n- \`${branch}\` — the work\n`;

test('fleet: a merged-and-deleted branch reports merged, not open', () => {
  // The defect itself. The branch's PR merged, the ref was deleted at merge —
  // and the scan called it unstarted work, so its wave never completed.
  const f = makeRepo('plot-fleet-merged-', ONE_WAVE('feature/landed'));
  f.work('feature/landed', 'landed.txt');
  f.push('-u', 'origin', 'feature/landed');
  f.prMerge('feature/landed');
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/landed');   // the deletion at merge

  const out = f.run();
  assert.match(branchLine(out, 'feature/landed'), / — merged$/);
  assert.match(waveLine(out, 'One'), / — complete$/);
  assert.match(footerOf(out), /\bmerge_detect=pr-merge\b/);
  f.cleanup();
});

test('fleet: --next does not name a merged-and-deleted branch', () => {
  // The assertion that matters most: --next is the interface plot-dispatch.sh
  // acts on, so a wrong answer here re-dispatches finished work — recreating
  // the deleted ref and handing a worker a diff that is already on main.
  const f = makeRepo('plot-fleet-next-', ONE_WAVE('feature/landed'));
  f.work('feature/landed', 'landed.txt');
  f.push('-u', 'origin', 'feature/landed');
  f.prMerge('feature/landed');
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/landed');

  let code = 0, stdout = '';
  try {
    stdout = execFileSync('bash', [scan, '--offline', '--next'],
      { encoding: 'utf8', cwd: f.dir });
  } catch (e) { code = e.status; stdout = e.stdout ?? ''; }
  assert.equal(stdout.trim(), '', '--next must not offer finished work');
  assert.equal(code, 1, 'nothing to start is exit 1, not an empty name');
  f.cleanup();
});

test('fleet: a backward merge is not evidence that the branch merged', () => {
  // THE inversion, and it fails silently. `Merge remote-tracking branch
  // 'origin/main' into X` also names a branch, with the OPPOSITE meaning: main
  // was pulled INTO X, not X onto main. A name-only grep reads it as merge
  // evidence and reports UNFINISHED work as finished — opening the next wave on
  // an unlanded seam, which is strictly worse than the bug being fixed.
  //
  // The defence is the SHAPE of the subject, anchored end to end. A second-
  // parent counter-check was tested and does not discriminate: PR merges and
  // backward merges both have a distinct second-parent tip.
  const f = makeRepo('plot-fleet-backward-', ONE_WAVE('feature/pulling'));
  // Give main a commit of its own so the backward merge is a real merge.
  git(f.dir, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(f.dir, 'main.txt'), 'main moved\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'main moves on');
  f.push('origin', 'main');

  // feature/pulling merges MAIN INTO ITSELF and is never merged back.
  git(f.dir, 'checkout', '-qb', 'feature/pulling', 'HEAD~1');
  fs.writeFileSync(path.join(f.dir, 'pulling.txt'), 'in flight\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'in-flight work');
  git(f.dir, 'merge', '-q', '--no-ff', '-m',
    "Merge remote-tracking branch 'origin/main' into feature/pulling", 'main');
  f.push('-u', 'origin', 'feature/pulling');
  git(f.dir, 'checkout', '-q', 'main');

  const out = f.run();
  // The ref still exists here, so this branch reads wip — the point is that it
  // is NOT merged, however its backward-merge subject names it.
  assert.doesNotMatch(branchLine(out, 'feature/pulling'), / — merged$/);
  assert.match(waveLine(out, 'One'), / — eligible$/,
    'a branch that only pulled main in has not settled its wave');

  // And with the ref deleted — the arm the merge lookup lives in — the backward
  // merge on main must still not count. This is the assertion that fails if the
  // anchoring is ever loosened to a name grep.
  f.push('origin', '--delete', 'feature/pulling');
  const gone = f.run();
  assert.match(branchLine(gone, 'feature/pulling'), / — open$/,
    'a backward-merge subject must never be read as merge evidence');
  f.cleanup();
});

test('fleet: a GitFlow feature merged via develop reads merged', () => {
  // This is the case that killed the first-parent filter. A feature merged into
  // `develop`, where `develop` later merges into the default branch, is NOT on
  // the default branch's first-parent chain — but its work IS an ancestor.
  // Candidates are what is REACHABLE, so the two-level shape is found.
  //
  // Without this test the filter comes back: "119 merges → 109 on the chain,
  // all 11 backward merges gone" is persuasive and was measured against the
  // wrong baseline (raw merges, not the anchored pattern — which scores 108 to
  // 108, i.e. the filter catches nothing extra).
  const f = makeRepo('plot-fleet-gitflow-', ONE_WAVE('feature/alpha'));
  git(f.dir, 'checkout', '-qb', 'develop');
  f.push('-u', 'origin', 'develop');

  f.work('feature/alpha', 'alpha.txt', 'develop');
  f.push('-u', 'origin', 'feature/alpha');
  f.prMerge('feature/alpha', 'develop');            // level 1: into develop
  f.push('origin', 'develop');

  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'merge', '-q', '--no-ff', '-m',
    "Merge branch 'develop'", 'develop');           // level 2: develop → main
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/alpha');

  const out = f.run();
  assert.match(branchLine(out, 'feature/alpha'), / — merged$/,
    'reachability finds a feature that landed via develop');
  assert.match(waveLine(out, 'One'), / — complete$/);
  f.cleanup();
});

test('fleet: a PR merged into an abandoned branch does not read as merged', () => {
  // The mirror of the GitFlow case, and what makes reachability safe. A
  // conforming merge subject that is NOT reachable from the default branch must
  // not count — the work never arrived. This is the assertion that fails if
  // someone later broadens the search to --all.
  const f = makeRepo('plot-fleet-abandoned-', ONE_WAVE('feature/sub'));
  git(f.dir, 'checkout', '-qb', 'feature/big');
  fs.writeFileSync(path.join(f.dir, 'big.txt'), 'stack base\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'stack base');
  f.push('-u', 'origin', 'feature/big');

  f.work('feature/sub', 'sub.txt', 'feature/big');
  f.push('-u', 'origin', 'feature/sub');
  f.prMerge('feature/sub', 'feature/big');          // conforming subject …
  f.push('origin', 'feature/big');                  // … but feature/big never lands
  f.push('origin', '--delete', 'feature/sub');
  git(f.dir, 'checkout', '-q', 'main');

  const out = f.run();
  assert.match(branchLine(out, 'feature/sub'), / — open$/,
    'a merge that never reached the default branch is not evidence');
  f.cleanup();
});

test('fleet: detection uses the configured default branch, not a literal main', () => {
  // MAIN resolution already existed; this pins that DETECTION uses it. The
  // fixture has no branch named `main` at all, so a hardcoded `origin/main`
  // would find nothing and the branch would read open.
  const f = makeRepo('plot-fleet-develop-', ONE_WAVE('feature/on-develop'),
    { main: 'develop' });
  f.work('feature/on-develop', 'd.txt', 'develop');
  f.push('-u', 'origin', 'feature/on-develop');
  f.prMerge('feature/on-develop', 'develop');
  f.push('origin', 'develop');
  f.push('origin', '--delete', 'feature/on-develop');

  const out = f.run();
  assert.match(branchLine(out, 'feature/on-develop'), / — merged$/);
  assert.match(footerOf(out), /\bmain=develop\b/);
  assert.equal(lines(out, /origin\/main/).length, 0, 'no branch named main exists');
  f.cleanup();
});

test('fleet: a reused branch name does not inherit the old merge verdict', () => {
  // Merge `bug/flaky`, delete it, recreate it for a second attempt — a normal
  // thing to do when work is reopened. The FIRST attempt's merge subject is
  // still on the default branch, and it is now stale evidence.
  //
  // Correct today only BY PLACEMENT: the merge lookup lives in the no-ref arm,
  // and a recreated branch has a ref, so it never reaches the lookup. Hoisting
  // the merge check to the top of branch_state() reads like a cheap early
  // answer and would silently report in-flight work as merged. This test is
  // what holds the ordering.
  const f = makeRepo('plot-fleet-reused-', ONE_WAVE('bug/flaky'));
  f.work('bug/flaky', 'attempt1.txt');
  f.push('-u', 'origin', 'bug/flaky');
  f.prMerge('bug/flaky');
  f.push('origin', 'main');
  f.push('origin', '--delete', 'bug/flaky');

  // Second attempt, same name, new work that has NOT landed. The local branch
  // survived the merge — only the remote ref was deleted — so drop it first,
  // which is what reopening the work actually looks like.
  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'branch', '-qD', 'bug/flaky');
  f.work('bug/flaky', 'attempt2.txt');
  f.push('-u', 'origin', 'bug/flaky');
  git(f.dir, 'checkout', '-q', 'main');

  const out = f.run();
  assert.match(branchLine(out, 'bug/flaky'), / — in progress$/,
    'the ref check must precede the merge lookup');
  assert.match(waveLine(out, 'One'), / — eligible$/,
    'and the wave must stay open on the new attempt');
  f.cleanup();
});

test('fleet: the merge history is read once per run, not once per branch', () => {
  // branch_state() runs per branch and the board polls every 5s, so a `git log`
  // inside that loop is O(history × branches) where O(history + branches) is
  // available — measured 197ms vs 79ms on a 2000-merge fixture.
  //
  // Timing cannot catch this in a small fixture, so COUNT the invocations. A
  // git shim on PATH records argv; the scan calls git by bare name throughout.
  const f = makeRepo('plot-fleet-once-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    ['a', 'b', 'c', 'd', 'e'].map((n) => `- \`feature/${n}\` — work\n`).join(''));
  for (const n of ['a', 'b', 'c', 'd', 'e']) {
    f.work(`feature/${n}`, `${n}.txt`);
    f.push('-u', 'origin', `feature/${n}`);
    f.prMerge(`feature/${n}`);
    f.push('origin', 'main');
    f.push('origin', '--delete', `feature/${n}`);
  }

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gitshim-'));
  const argvLog = path.join(shim, 'git.argv');
  const realGit = execFileSync('bash', ['-lc', 'command -v git'],
    { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(shim, 'git'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}
exec ${JSON.stringify(realGit)} "$@"
`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);

  execFileSync('bash', [scan, '--offline'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
  });

  const walks = fs.readFileSync(argvLog, 'utf8').split('\n')
    .filter((l) => l.startsWith('log ') && l.includes('--merges'));
  assert.equal(walks.length, 1,
    `the merge walk must happen once per run, saw ${walks.length}`);
  fs.rmSync(shim, { recursive: true, force: true });
  f.cleanup();
});

test('fleet: a saturated merge walk is reported, never silent', () => {
  // The cap exists as a guard against a pathological history, not as an
  // optimisation (measured: cap 500 = 7.7ms, no cap = 11.8ms on 2000 merges).
  // A BLIND cap re-creates this plan's own bug: at --max-count=300 against 2000
  // merges an early merge is not found and reads `open`, and precisely the
  // long-hanging plans suffer it. So saturation is stated.
  //
  // merge_detect=truncated is its own value rather than folded into pr-merge: a
  // capped walk did detect, but not exhaustively, and a reader deciding whether
  // to trust an `open` needs those apart.
  const f = makeRepo('plot-fleet-trunc-', ONE_WAVE('feature/early'));
  f.work('feature/early', 'early.txt');
  f.push('-u', 'origin', 'feature/early');
  f.prMerge('feature/early');
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/early');
  // Three later merges, so a limit of 1 saturates and hides the early one.
  for (const n of ['x', 'y', 'z']) {
    f.work(`feature/${n}`, `${n}.txt`);
    f.prMerge(`feature/${n}`);
  }
  f.push('origin', 'main');
  git(f.dir, 'checkout', '-q', 'main');

  const capped = f.run([], { PLOT_MERGE_SCAN_LIMIT: '1' });
  assert.match(footerOf(capped), /\bmerge_detect=truncated\b/);
  assert.equal(lines(capped, /note: merge scan hit its limit of 1\b/).length, 1,
    'the saturated walk must say it stopped looking');
  // And the branch beyond the limit keeps `open` — acceptable ONLY because the
  // scan said it stopped looking.
  assert.match(branchLine(capped, 'feature/early'), / — open$/);

  // Uncapped, the same repo finds it.
  const full = f.run();
  assert.match(branchLine(full, 'feature/early'), / — merged$/);
  assert.match(footerOf(full), /\bmerge_detect=pr-merge\b/);
  assert.equal(lines(full, /note: merge scan hit its limit/).length, 0);
  f.cleanup();
});

test('fleet: merge_detect=none when the default branch offers no PR merges', () => {
  // A squash/rebase repo leaves no conforming merge commit, so there is nothing
  // to find. `open` is still the answer — no third state, no guessing — but the
  // reader must be able to tell "nothing was merged" from "this repo does not
  // leave the evidence I look for".
  const f = makeRepo('plot-fleet-none-detect-', ONE_WAVE('feature/squashed'));
  const out = f.run();
  assert.match(branchLine(out, 'feature/squashed'), / — open$/);
  assert.match(footerOf(out), /\bmerge_detect=none\b/);
  f.cleanup();
});

test('fleet: a branch with no merge commit keeps open — no third state', () => {
  // The fix may only move a branch from `open` to `merged`, and only on
  // positive evidence. Where the signal is absent — squash merges, a
  // hand-rewritten subject, a branch genuinely never started — today's answer
  // stands. A branch here IS detected (so merge_detect is pr-merge, not none),
  // which is what makes the untouched branch's `open` meaningful.
  const f = makeRepo('plot-fleet-nostate-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/landed` — merged\n- `feature/never` — never started\n');
  f.work('feature/landed', 'l.txt');
  f.push('-u', 'origin', 'feature/landed');
  f.prMerge('feature/landed');
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/landed');

  const out = f.run();
  assert.match(branchLine(out, 'feature/landed'), / — merged$/);
  assert.match(branchLine(out, 'feature/never'), / — open$/);
  assert.match(footerOf(out), /\bmerge_detect=pr-merge\b/);
  // The state vocabulary is unchanged: no new word entered the report. Only
  // BRANCH lines are inspected — the six-space indent — since wave lines carry
  // verdicts (complete/eligible/blocked) in the same `— ` shape and a looser
  // pattern would sweep them in.
  const notes = lines(out, /^ {6}\S+ — /).map((l) => l.split(' — ')[1]);
  assert.deepEqual(notes.filter((n) =>
    !['merged', 'open', 'deferred', 'in progress'].includes(n) && !n.startsWith('claimed')),
    [], 'detection must not introduce a fourth branch state');
  f.cleanup();
});

test('fleet: a hand-rewritten merge subject keeps open rather than guessing', () => {
  // The honest bound. `Merge PR #44: <title>` is a real PR merge carrying no
  // branch name, and no amount of anchoring recovers it — nor can it be
  // recovered structurally, since matching by commit identity needs the tip SHA
  // the deleted ref no longer provides.
  const f = makeRepo('plot-fleet-rewritten-', ONE_WAVE('feature/renamed'));
  f.work('feature/renamed', 'r.txt');
  f.push('-u', 'origin', 'feature/renamed');
  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'merge', '-q', '--no-ff', '-m',
    'Merge PR #44: release pipeline — OIDC trusted publishing', 'feature/renamed');
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/renamed');

  const out = f.run();
  assert.match(branchLine(out, 'feature/renamed'), / — open$/,
    'no branch name in the subject means no evidence, not a guess');
  f.cleanup();
});

test('fleet: detection reads git only — no plan annotation, no host call', () => {
  // Two properties in one fixture, both load-bearing.
  //
  // Plans carry `→ #<n>` annotations and using them would be cheaper, but "the
  // missing annotation and the missing delivery have the same cause": a fix
  // depending on annotations misses exactly the sloppy plans that hang. Live
  // proof — board-reads-git had BOTH branches merged and NEITHER annotated.
  // The plan here carries no annotation and detection must still succeed.
  //
  // And the default path makes no host calls at all. That is the whole reason
  // the board can poll this every 5s; a metered scan on a 5s timer would dwarf
  // the 560 GraphQL calls/hour seven boards already cost. A `gh`/`bb` stub that
  // fails loudly catches any reintroduction.
  const f = makeRepo('plot-fleet-gitonly-', ONE_WAVE('feature/unannotated'));
  f.work('feature/unannotated', 'u.txt');
  f.push('-u', 'origin', 'feature/unannotated');
  f.prMerge('feature/unannotated');
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/unannotated');

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-nohost-'));
  const callLog = path.join(shim, 'host.calls');
  for (const cli of ['gh', 'bb']) {
    fs.writeFileSync(path.join(shim, cli), `#!/usr/bin/env bash
printf '%s %s\\n' ${JSON.stringify(cli)} "$*" >> ${JSON.stringify(callLog)}
exit 1
`);
    fs.chmodSync(path.join(shim, cli), 0o755);
  }

  const out = execFileSync('bash', [scan, '--offline'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
  });
  assert.match(branchLine(out, 'feature/unannotated'), / — merged$/,
    'detection must not depend on a → #<n> annotation');
  assert.equal(fs.existsSync(callLog), false,
    `the default path must make no host calls, saw: ${
      fs.existsSync(callLog) ? fs.readFileSync(callLog, 'utf8') : ''}`);
  fs.rmSync(shim, { recursive: true, force: true });
  f.cleanup();
});

test('fleet: a branch name carrying regex metacharacters matches only itself', () => {
  // The branch name is interpolated into an ERE, so `+` `(` `)` `?` — all
  // legal in a git ref name — must be escaped. Both failure directions matter:
  // an unescaped metacharacter can make a name match a DIFFERENT branch's
  // subject (a false `merged`, the dangerous direction), or fail to match its
  // OWN subject (a silent `open`, which is this plan's bug again).
  //
  // Two names git actually permits. `.` and `?` are not usable here — git
  // rejects `?` in a ref name outright, and the plan parser drops any branch
  // whose last segment carries a dot, treating it as a cited file path.
  // `{2}` covers the wildcard direction: unescaped it is a repetition
  // quantifier and matches the doubled-letter name instead.
  const f = makeRepo('plot-fleet-meta-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/a+b` — merged, name carries a plus\n' +
    '- `feature/x{2}` — never merged; `feature/xx` did merge\n');
  f.work('feature/a+b', 'plus.txt');
  f.push('-u', 'origin', 'feature/a+b');
  f.prMerge('feature/a+b');
  // A merge naming a DIFFERENT branch. Were `feature/x{2}` interpolated raw,
  // `x{2}` would mean "two x" and match this `feature/xx`.
  f.work('feature/xx', 'other.txt');
  f.prMerge('feature/xx');
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/a+b');
  git(f.dir, 'checkout', '-q', 'main');

  const out = f.run();
  assert.match(branchLine(out, 'feature/a+b'), / — merged$/,
    'a name with a plus must match its own merge subject');
  assert.match(branchLine(out, 'feature/x{2}'), / — open$/,
    'another branch’s merge subject is not this branch’s evidence');
  f.cleanup();
});

test('fleet: --json carries the merged state and the detection source', () => {
  // The board reads the machine rendering, never the prose. A merged-and-
  // deleted branch must arrive as state `merged` — the value classify() routes
  // to group `done` — and the footer's merge_detect must travel with it, so a
  // reader can tell a trustworthy `open` from a truncated one.
  const f = makeRepo('plot-fleet-json-', ONE_WAVE('feature/landed'));
  f.work('feature/landed', 'l.txt');
  f.push('-u', 'origin', 'feature/landed');
  f.prMerge('feature/landed');
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/landed');

  const doc = JSON.parse(f.run(['--json']));
  const wave = doc.plans[0].waves[0];
  assert.equal(wave.verdict, 'complete');
  assert.equal(wave.branches.find((b) => b.branch === 'feature/landed').state, 'merged');
  assert.equal(doc.summary.merge_detect, 'pr-merge');
  f.cleanup();
});

// --- squash merges: the case with no local evidence at all -------------------
//
// The walk above finds a branch whose PR produced a MERGE COMMIT. A squash
// merge produces none — one parent, and a subject naming the PR number rather
// than the branch — so a branch squash-merged and deleted reads `open`, the
// same word used for work nobody has started. Its wave never completes and the
// next wave stays blocked forever, which is what makes this a defect rather
// than a cosmetic one.
//
// The remaining source is the host, and these tests pin BOTH directions: the
// answer it supplies, and the answer it must never fabricate.

// A shim directory holding every real script with plot-host.sh replaced. The
// scan resolves its siblings by path, so the copy is what makes the stub
// reachable — the same shape the --loose host tests use.
function hostShim(body) {
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-sqhost-'));
  const realScripts = path.dirname(scan);
  fs.mkdirSync(path.join(shim, 'scripts'));
  for (const f of fs.readdirSync(realScripts)) {
    if (f.endsWith('.sh')) fs.copyFileSync(path.join(realScripts, f), path.join(shim, 'scripts', f));
  }
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'), body);
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);
  return {
    scan: path.join(shim, 'scripts', 'plot-fleet-scan.sh'),
    dir: shim,
    cleanup() { fs.rmSync(shim, { recursive: true, force: true }); },
  };
}

// Squash-merge `br` the way GitHub does: replay its tree onto the default
// branch as ONE commit whose subject names the PR number, never the branch.
function squashMerge(f, br, pr, main = 'main') {
  git(f.dir, 'checkout', '-q', main);
  git(f.dir, 'merge', '-q', '--squash', br);
  git(f.dir, 'commit', '-qm', `feat: the work (#${pr})`);
  // The premise, pinned rather than assumed: a squash merge has ONE parent, so
  // the merge walk has nothing to match. If git ever changed this, the tests
  // below would still pass while testing something else.
  const parents = git(f.dir, 'log', '-1', '--format=%p').trim().split(/\s+/);
  assert.equal(parents.length, 1, 'a squash merge must produce a single-parent commit');
}

test('fleet: a squash-merged, deleted branch reports merged and completes its wave', () => {
  // The defect, end to end. Wave One's only branch was squash-merged and its
  // ref deleted; nothing local names it. The wave must complete — and wave Two
  // must become eligible, which is the consequence that matters: a wave that
  // cannot complete blocks its successor permanently.
  const f = makeRepo('plot-fleet-squash-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/squashed` — squash-merged and deleted\n\n### Two\n' +
    '- `feature/next` — waits on wave one\n');
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 42);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state)
    case "$2" in
      feature/squashed) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
      *) echo '{"state":"NONE"}' ;;
    esac ;;
  *) echo "{}" ;;
esac
`);
  // No --offline: that flag promises no network, and the host is the point.
  const out = execFileSync('bash', [h.scan, 'p'], { encoding: 'utf8', cwd: f.dir });
  assert.match(branchLine(out, 'feature/squashed'), / — merged$/,
    'a squash-merged branch is merged, not open');
  assert.match(waveLine(out, 'One'), / — complete$/);
  assert.match(waveLine(out, 'Two'), / — eligible$/,
    'the successor wave must become reachable — the blocked-forever symptom');
  h.cleanup();
  f.cleanup();
});

test('fleet: an unreachable host keeps open — it never fabricates merged', () => {
  // THE LOAD-BEARING DIRECTION. On 2026-08-17 GitHub returned 503 all
  // afternoon; a scan that read an outage as MERGED would settle waves on work
  // that never landed and open the next wave onto a seam that does not exist.
  // `plot-host.sh` exits non-zero on transport failure, and that must degrade
  // to exactly the answer this scan gave before the host was ever consulted.
  const f = makeRepo('plot-fleet-squash503-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/squashed` — squash-merged and deleted\n\n### Two\n' +
    '- `feature/next` — waits on wave one\n');
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 42);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state) echo "plot-host: HTTP 503 (server error)" >&2; exit 1 ;;
  *) echo "{}" ;;
esac
`);
  const out = execFileSync('bash', [h.scan, 'p'], { encoding: 'utf8', cwd: f.dir });
  assert.match(branchLine(out, 'feature/squashed'), / — open$/,
    'an unreachable host must never become a fabricated merged');
  assert.match(waveLine(out, 'One'), / — eligible$/);
  assert.match(waveLine(out, 'Two'), / — blocked$/,
    'and the wave arithmetic must read exactly as it did before');
  h.cleanup();
  f.cleanup();
});

test('fleet: a host reporting NONE or CLOSED leaves the branch open', () => {
  // The other two arms of the three-way reply. Only an explicit MERGED may
  // move a branch off `open`: a lookup miss means no PR was ever opened, and a
  // CLOSED PR means the work was abandoned — neither is landed work, and
  // reading either as `merged` would settle a wave on nothing.
  const f = makeRepo('plot-fleet-squashnone-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/nopr` — never had a PR\n- `feature/closed` — PR closed unmerged\n');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state)
    case "$2" in
      feature/closed) echo '{"number":9,"state":"CLOSED","draft":false,"url":"x"}' ;;
      *) echo '{"state":"NONE"}' ;;
    esac ;;
  *) echo "{}" ;;
esac
`);
  const out = execFileSync('bash', [h.scan, 'p'], { encoding: 'utf8', cwd: f.dir });
  assert.match(branchLine(out, 'feature/nopr'), / — open$/);
  assert.match(branchLine(out, 'feature/closed'), / — open$/,
    'a closed, unmerged PR is not landed work');
  h.cleanup();
  f.cleanup();
});

// --- a branch reset to the default branch ------------------------------------
//
// The mirror of the squash case above, and the two pull in OPPOSITE directions:
//
//   | shape          | ancestry says          | truth          |
//   |----------------|------------------------|----------------|
//   | squash-merged  | not an ancestor → open | merged         |
//   | reset to main  | is an ancestor → merged| holds nothing  |
//
// A branch pointing AT the default branch is trivially an ancestor of it, so
// every ancestry test passes and the scan called it `merged`. But zero commits
// ahead means it carries no work — and *no work* is not *landed*.
//
// Measured 2026-08-29: `feature/one-deliver-rule-decides-in-the-domain` was
// reset to `origin/main` so a worker could rebuild it, its PR (#511) having
// been CLOSED, never merged. The scan read it `merged`, completed its wave, and
// opened `Transitions` on the strength of work that does not exist.
//
// The discriminator is the OTHER direction. A genuinely merged branch is
// BEHIND main — main advanced past it — while a branch reset to main is EQUAL
// to it: ahead 0 AND behind 0. That is a `rev-list` count, offline, and it must
// stay that way: `a-throttled-host-says-so` measured plot-pr-merged.sh
// answering `not merged` for three genuinely merged branches while throttled,
// and this reading must not inherit that failure mode.

test('fleet: a branch reset to the default branch reads open, not merged', () => {
  // THE DEFECT. The branch exists, points exactly at main, and holds nothing.
  // `merged` would settle its wave and open the successor onto a seam that was
  // never written.
  const f = makeRepo('plot-fleet-reset-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/wiped` — reset to main, rebuild pending\n\n### Two\n' +
    '- `feature/next` — waits on wave one\n');
  // Give main a commit of its own first, so "points at main" is a real
  // position rather than the empty initial state.
  git(f.dir, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(f.dir, 'main.txt'), 'main moved\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'main moves on');
  f.push('origin', 'main');

  // The branch as a worker leaves it after `git reset --hard origin/main`:
  // a ref at main's tip, carrying nothing of its own.
  git(f.dir, 'branch', 'feature/wiped', 'main');
  f.push('-u', 'origin', 'feature/wiped');

  const out = f.run();
  assert.match(branchLine(out, 'feature/wiped'), / — open$/,
    'zero commits ahead means it carries no work — no work is not landed');
  assert.match(waveLine(out, 'One'), / — eligible$/,
    'a wave holding an empty branch has not completed');
  assert.match(waveLine(out, 'Two'), / — blocked$/,
    'and the successor must not open on work that does not exist');
  f.cleanup();
});

test('fleet: a reset branch reads open without asking the host', () => {
  // NO NEW HOST CALL, asserted rather than promised. The check is `rev-list`,
  // offline, and a host that cannot answer at all must leave the reading
  // unchanged — the failure mode `a-throttled-host-says-so` measured.
  const f = makeRepo('plot-fleet-resetnohost-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/wiped` — reset to main\n');
  git(f.dir, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(f.dir, 'main.txt'), 'main moved\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'main moves on');
  f.push('origin', 'main');
  git(f.dir, 'branch', 'feature/wiped', 'main');
  f.push('-u', 'origin', 'feature/wiped');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state|pr-list) echo "plot-host: HTTP 503 (server error)" >&2; exit 1 ;;
  *) echo "{}" ;;
esac
`);
  // No --offline: the host is reachable in principle and simply fails. The
  // reading must be identical to the offline run above.
  const out = execFileSync('bash', [h.scan, 'p'], { encoding: 'utf8', cwd: f.dir });
  assert.match(branchLine(out, 'feature/wiped'), / — open$/,
    'the reset check is local; a failing host may not change it');
  h.cleanup();
  f.cleanup();
});

test('fleet: a branch behind main still reads merged — the regression that matters', () => {
  // THE OTHER DIRECTION, and the one this change could plausibly break. The
  // crude rule "zero commits ahead means open" is correct for the reset case
  // and WRONG here: a branch merged with a fast-forward or left behind by a
  // moving main also counts zero ahead, and its work IS on main.
  //
  // Testing only the reset case passes with that crude rule and proves nothing.
  // Both directions, or neither is proven.
  const f = makeRepo('plot-fleet-behind-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/landed` — merged, ref kept\n\n### Two\n' +
    '- `feature/next` — waits on wave one\n');
  f.work('feature/landed', 'landed.txt');
  f.push('-u', 'origin', 'feature/landed');
  f.prMerge('feature/landed');
  f.push('origin', 'main');
  // The ref survives the merge — so this takes the ref-exists arm, where the
  // reset check lives, rather than the merge-subject lookup.
  const out = f.run();
  assert.match(branchLine(out, 'feature/landed'), / — merged$/,
    'a branch whose work is on main is merged, however few commits it is ahead');
  assert.match(waveLine(out, 'One'), / — complete$/);
  assert.match(waveLine(out, 'Two'), / — eligible$/);
  f.cleanup();
});

test('fleet: a squash-merged branch whose ref was restored still reads merged', () => {
  // The squash path, re-pinned from THIS side. Its mirror plan
  // (`a-squash-merged-branch-is-not-quiet`) fixes the opposite error, and a fix
  // for one can break the other. A squash-merged branch is behind main but has
  // commits main does not contain BY SUBJECT, so it still finds them; a branch
  // reset to main has neither. This asserts the reset check did not swallow it.
  const f = makeRepo('plot-fleet-resetsquash-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/squashed` — squash-merged, ref pushed back\n');
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 42);
  f.push('origin', 'main');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state)
    case "$2" in
      feature/squashed) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
      *) echo '{"state":"NONE"}' ;;
    esac ;;
  pr-list) echo '{"number":42,"title":"feat: the work","state":"MERGED","head":"feature/squashed","draft":false,"checks":"green","mergeable":"mergeable","review":"","url":"x","failing_checks":[]}' ;;
  *) echo "{}" ;;
esac
`);
  const out = execFileSync('bash', [h.scan, 'p'], { encoding: 'utf8', cwd: f.dir });
  assert.match(branchLine(out, 'feature/squashed'), / — merged$/,
    'the reset check must not swallow a squash-merged branch');
  f.cleanup();
  h.cleanup();
});

test('fleet: the host is asked once per absent branch, and never for a present ref', () => {
  // COST, which is what decides whether this can live under a 5-second poll.
  // `branch_state` runs inside a command substitution — a subshell — so a
  // cached answer held in a variable would be discarded and every branch would
  // pay again. The count is asserted rather than assumed: one call for the
  // absent branch, none for the branch whose ref is still there, and no repeat.
  const f = makeRepo('plot-fleet-squashcost-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/gone` — squash-merged and deleted\n- `feature/here` — still pushed\n');
  f.work('feature/gone', 'g.txt');
  f.push('-u', 'origin', 'feature/gone');
  squashMerge(f, 'feature/gone', 42);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/gone');
  f.work('feature/here', 'h.txt');
  f.push('-u', 'origin', 'feature/here');
  git(f.dir, 'checkout', '-q', 'main');

  const h = hostShim(`#!/usr/bin/env bash
[ "$1" = pr-state ] && printf '%s\\n' "$2" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  const calls = path.join(h.dir, 'calls.txt');
  execFileSync('bash', [h.scan, 'p'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PLOT_TEST_CALLS: calls },
  });
  const asked = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(asked, ['feature/gone'],
    'exactly one call, for the branch with no ref — a present ref answers locally');
  h.cleanup();
  f.cleanup();
});

test('fleet: --offline asks no host, so a squashed branch still reads open', () => {
  // --offline promises no network and the board's ambient pulse relies on it.
  // The host lookup is gated on the same flag: an offline scan reports exactly
  // what it reported before this fix existed. A stub that fails loudly on any
  // call would be indistinguishable from an outage here, so the CALL ITSELF is
  // what the assertion watches.
  const f = makeRepo('plot-fleet-squashoffline-', ONE_WAVE('feature/squashed'));
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 42);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  const h = hostShim(`#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  const calls = path.join(h.dir, 'calls.txt');
  const out = execFileSync('bash', [h.scan, '--offline', 'p'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PLOT_TEST_CALLS: calls },
  });
  assert.match(branchLine(out, 'feature/squashed'), / — open$/,
    '--offline keeps the pre-fix answer rather than reaching the host');
  assert.equal(fs.existsSync(calls), false,
    `--offline must make no host call, saw: ${
      fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : ''}`);
  h.cleanup();
  f.cleanup();
});

test('fleet: two branch names that collapse to one cache key keep separate verdicts', () => {
  // The cache is a FILE PER BRANCH, so the key must be INJECTIVE. Under a naive
  // slash-to-underscore mapping `feature/a_b/c` and `feature/a/b_c` both become
  // `feature_a_b_c` — two legal refs, one key — and the branch asked second
  // inherits the first's answer. When that answer is `merged`, a wave settles
  // on a branch nobody looked at: the fabricated verdict this change is careful
  // to avoid, arriving through the cache rather than through the host.
  //
  // Only the first is squash-merged; the second never existed.
  const f = makeRepo('plot-fleet-squashkey-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/a_b/c` — squash-merged and deleted\n- `feature/a/b_c` — never started\n');
  f.work('feature/a_b/c', 'k.txt');
  f.push('-u', 'origin', 'feature/a_b/c');
  squashMerge(f, 'feature/a_b/c', 42);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/a_b/c');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state)
    case "$2" in
      feature/a_b/c) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
      *) echo '{"state":"NONE"}' ;;
    esac ;;
  *) echo "{}" ;;
esac
`);
  const out = execFileSync('bash', [h.scan, 'p'], { encoding: 'utf8', cwd: f.dir });
  assert.match(branchLine(out, 'feature/a_b/c'), / — merged$/);
  assert.match(branchLine(out, 'feature/a/b_c'), / — open$/,
    'a branch nobody merged must not inherit another branch\'s verdict');
  h.cleanup();
  f.cleanup();
});

test('fleet: a recreated branch is not merged, whatever the host remembers', () => {
  // The ordering invariant, now with a second way to break it. A branch name
  // can be reused: merge `feature/retry`, delete it, recreate it for a second
  // attempt. The host still answers MERGED — about the FIRST attempt — while
  // the branch of that name carries new work that has not landed.
  //
  // The host lookup is safe only BY PLACEMENT, inside the no-ref arm. A
  // recreated branch HAS a ref, so it must never reach the lookup at all.
  const f = makeRepo('plot-fleet-squashreuse-', ONE_WAVE('feature/retry'));
  f.work('feature/retry', 'a.txt');
  f.push('-u', 'origin', 'feature/retry');
  squashMerge(f, 'feature/retry', 42);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/retry');
  // Deleting the REMOTE ref leaves the local branch behind; the second attempt
  // recreates the name, which is the whole premise here.
  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'branch', '-qD', 'feature/retry');
  // Second attempt, unlanded.
  f.work('feature/retry', 'b.txt');
  f.push('-u', 'origin', 'feature/retry');
  git(f.dir, 'checkout', '-q', 'main');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  const out = execFileSync('bash', [h.scan, 'p'], { encoding: 'utf8', cwd: f.dir });
  assert.match(branchLine(out, 'feature/retry'), / — in progress$/,
    'stale host evidence must not settle a wave on unlanded work');
  h.cleanup();
  f.cleanup();
});

// --- the stale tracking ref: a leftover that DISABLES the host lookup --------
//
// `git fetch` does not remove remote-tracking refs for branches deleted
// upstream; only `--prune` does. So a branch merged with --delete-branch
// leaves `refs/remotes/origin/<br>` behind on every machine that fetched it.
//
// That leftover is not cosmetic. branch_state() picks its arm on the ref's
// PRESENCE: with the ref there the scan takes the ancestry path, which a
// squash merge breaks by construction, and the host lookup that would have
// answered `merged` lives in the other arm and is never reached. Measured
// 2026-08-18 — a wave could not be dispatched at all until someone happened to
// prune by hand.
//
// The distinction these tests turn on: the deletion must happen SOMEWHERE
// ELSE. `push origin --delete` from the repo under test removes that repo's
// tracking ref as a side effect, which is why every test above it passes
// without a prune. A SECOND CLONE deleting the branch is what the host does at
// merge, and it is the only shape that leaves the stale ref behind.
function deleteUpstreamElsewhere(f, br) {
  const other = path.join(f.root, `other-${br.replace(/[^a-z0-9]/gi, '-')}`);
  git(f.root, 'clone', '-q', path.join(f.root, 'origin.git'), other);
  git(other, 'config', 'user.email', 'test@example.invalid');
  git(other, 'config', 'user.name', 'Plot Test');
  git(other, 'push', '-q', 'origin', '--delete', br);
}

test('fleet: a stale tracking ref does not outrank the host', () => {
  // The defect end to end. The branch was squash-merged and deleted UPSTREAM,
  // but this checkout still holds its tracking ref. The ref must be pruned by
  // the scan's own fetch, so the no-ref arm is entered and the host answers.
  //
  // This test FAILS against the unpruned script — verified by stashing the fix
  // and running it, which reported `in progress` / blocked. A test that passes
  // both ways would not be testing this.
  const f = makeRepo('plot-fleet-staleref-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/squashed` — squash-merged, deleted upstream\n\n### Two\n' +
    '- `feature/next` — waits on wave one\n');
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 42);
  f.push('origin', 'main');
  deleteUpstreamElsewhere(f, 'feature/squashed');
  // The local branch goes; the stale REMOTE-TRACKING ref is what remains, and
  // it is the whole premise. Pinned rather than assumed — if a future git
  // pruned on plain fetch, this test would still pass while testing nothing.
  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'branch', '-qD', 'feature/squashed');
  assert.equal(
    git(f.dir, 'for-each-ref', '--format=%(refname)',
      'refs/remotes/origin/feature/squashed').trim(),
    'refs/remotes/origin/feature/squashed',
    'the premise: a stale tracking ref survives a deletion made elsewhere');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state)
    case "$2" in
      feature/squashed) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
      *) echo '{"state":"NONE"}' ;;
    esac ;;
  *) echo "{}" ;;
esac
`);
  // No --offline: the fetch is what prunes, and the prune is the point.
  const out = execFileSync('bash', [h.scan, 'p'], { encoding: 'utf8', cwd: f.dir });
  assert.match(branchLine(out, 'feature/squashed'), / — merged$/,
    'a stale ref must not keep a squash-merged branch in wip');
  assert.match(waveLine(out, 'One'), / — complete$/);
  assert.match(waveLine(out, 'Two'), / — eligible$/,
    'the consequence that mattered: the next wave could not be dispatched');
  assert.equal(
    git(f.dir, 'for-each-ref', '--format=%(refname)',
      'refs/remotes/origin/feature/squashed').trim(), '',
    'the scan’s fetch must have pruned the ref it no longer has upstream');
  h.cleanup();
  f.cleanup();
});

test('fleet: the prune uses an explicit refspec — a narrow fetch prunes nothing', () => {
  // THE TRAP, pinned. `git fetch --prune origin <main>` prunes only
  // `refs/remotes/origin/<main>`: naming a refspec scopes the prune to that
  // refspec's destination namespace. The obvious fix — a bare `--prune` on the
  // narrow fetch this scan already makes — is therefore a NO-OP for exactly
  // the branches the prune exists to clear.
  //
  // Asserted against git directly rather than through the scan, because it is
  // git's behaviour that makes the scan's refspec load-bearing. If a future git
  // changed this, the line in the scan would look redundant and be removed.
  const f = makeRepo('plot-fleet-prunescope-', ONE_WAVE('feature/gone'));
  f.work('feature/gone', 'g.txt');
  f.push('-u', 'origin', 'feature/gone');
  deleteUpstreamElsewhere(f, 'feature/gone');
  const ref = () => git(f.dir, 'for-each-ref', '--format=%(refname)',
    'refs/remotes/origin/feature/gone').trim();

  git(f.dir, 'fetch', '-q', '--prune', 'origin', 'main');
  assert.equal(ref(), 'refs/remotes/origin/feature/gone',
    'a refspec-scoped prune leaves refs outside that refspec alone');

  git(f.dir, 'fetch', '-q', '--prune', 'origin', 'main',
    '+refs/heads/*:refs/remotes/origin/*');
  assert.equal(ref(), '',
    'restating the heads refspec is what widens the prune to the whole mirror');
  f.cleanup();
});

test('fleet: pruning never touches a live ref — unmerged work still reads wip', () => {
  // The other direction. A branch with a ref and real unlanded work must be
  // untouched by the prune and keep reading `wip`, whatever the host says
  // about anything. A prune that removed live refs would report in-flight work
  // as merged and open the next wave onto it.
  const f = makeRepo('plot-fleet-prunelive-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/working` — real work, unlanded\n' +
    '- `feature/squashed` — merged and deleted upstream\n');
  f.work('feature/working', 'w.txt');
  f.push('-u', 'origin', 'feature/working');
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 42);
  f.push('origin', 'main');
  deleteUpstreamElsewhere(f, 'feature/squashed');
  git(f.dir, 'checkout', '-q', 'main');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  const out = execFileSync('bash', [h.scan, 'p'], { encoding: 'utf8', cwd: f.dir });
  assert.match(branchLine(out, 'feature/working'), / — in progress$/,
    'a live ref with unlanded work is not the prune’s business');
  assert.match(branchLine(out, 'feature/squashed'), / — merged$/);
  assert.equal(
    git(f.dir, 'for-each-ref', '--format=%(refname)',
      'refs/remotes/origin/feature/working').trim(),
    'refs/remotes/origin/feature/working',
    'a branch the remote still has must keep its tracking ref');
  h.cleanup();
  f.cleanup();
});

test('fleet: a recreated branch survives the prune and is never merged', () => {
  // The ordering invariant, re-pinned against the prune. The no-ref arm's
  // placement is what keeps a recreated branch honest, and pruning is safe
  // only because it does not reorder those arms — it removes refs the remote
  // no longer has, and a recreated branch IS on the remote.
  //
  // The distinguishing shape: a stale ref for a DIFFERENT branch is present
  // and pruneable in the same run, so a prune that removed refs indiscriminately
  // would take the recreated branch's ref too and hand it to the host, which
  // still answers MERGED about the first attempt.
  const f = makeRepo('plot-fleet-prunereuse-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/retry` — recreated for a second attempt\n' +
    '- `feature/done` — merged and deleted upstream\n');
  f.work('feature/done', 'd.txt');
  f.push('-u', 'origin', 'feature/done');
  squashMerge(f, 'feature/done', 41);
  f.push('origin', 'main');
  deleteUpstreamElsewhere(f, 'feature/done');

  f.work('feature/retry', 'a.txt');
  f.push('-u', 'origin', 'feature/retry');
  squashMerge(f, 'feature/retry', 42);
  f.push('origin', 'main');
  deleteUpstreamElsewhere(f, 'feature/retry');
  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'branch', '-qD', 'feature/retry');
  // The second attempt: same name, new work, pushed — so the ref is LIVE.
  f.work('feature/retry', 'b.txt');
  f.push('-u', 'origin', 'feature/retry');
  git(f.dir, 'checkout', '-q', 'main');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  const out = execFileSync('bash', [h.scan, 'p'], { encoding: 'utf8', cwd: f.dir });
  assert.match(branchLine(out, 'feature/retry'), / — in progress$/,
    'stale host evidence must not settle a wave on unlanded work');
  assert.match(branchLine(out, 'feature/done'), / — merged$/,
    'the pruneable ref in the same run must still have been pruned');
  h.cleanup();
  f.cleanup();
});

test('fleet: --offline cannot prune, and says so', () => {
  // The decided answer to the plan's Open Point. --offline skips the fetch, so
  // it cannot prune; a stale ref survives and the branch reads `wip`. That is
  // honest for a scan that asked nothing — but it must be STATED, because the
  // symptom (a finished wave that will not complete) looks nothing like
  // "you passed --offline".
  const f = makeRepo('plot-fleet-offlineprune-', ONE_WAVE('feature/squashed'));
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 42);
  f.push('origin', 'main');
  deleteUpstreamElsewhere(f, 'feature/squashed');
  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'branch', '-qD', 'feature/squashed');

  const out = f.run();   // f.run() passes --offline
  assert.match(branchLine(out, 'feature/squashed'), / — in progress$/,
    'an offline scan keeps whatever local refs exist — the honest answer');
  assert.match(out, /--offline skipped the fetch, so stale remote-tracking refs were/,
    'the consequence must be stated, not left to be discovered');
  assert.match(out, /may read wip/);
  assert.equal(
    git(f.dir, 'for-each-ref', '--format=%(refname)',
      'refs/remotes/origin/feature/squashed').trim(),
    'refs/remotes/origin/feature/squashed',
    '--offline must not reach the network to prune');
  f.cleanup();
});

// --- a worktree with uncommitted work is not quiet ---------------------------
//
// The fleet derives state from refs, and an agent editing files writes none —
// so a branch someone is actively working reads as abandoned, on the one
// machine that could have known better. The scan already stands where the
// answer is: `git worktree list --porcelain` names every worktree and its
// branch, and `git -C <path> status --porcelain` says whether it is dirty.
//
// The signal is strictly ONE-DIRECTIONAL, and these tests are what hold that.
// It may only ADD an answer where this machine knows more; it may never
// downgrade one. A machine with no worktree for a branch — every detached
// worker, every teammate's laptop, every CI run — must answer exactly as it did
// before this field existed.
//
// Read docs/plans/2026-08-16-fleet-sees-local-work.md before changing any of
// it.

/**
 * Add a worktree for `br` at `<repo>/../wt-<name>`, returning the path GIT will
 * report for it.
 *
 * Realpath-resolved, because that is what git prints: on macOS `os.tmpdir()`
 * yields `/var/folders/…`, a symlink to `/private/var/folders/…`. The scan
 * passes git's own answer through untouched — a path the reader is meant to
 * `cd` into — so the fixture compares against the same string rather than
 * against the one it happened to construct.
 */
function addWorktree(f, br, name) {
  const wt = path.join(f.root, `wt-${name}`);
  git(f.dir, 'worktree', 'add', '-q', wt, br);
  return fs.realpathSync(wt);
}

test('fleet: a dirty local worktree reports local_dirty, with its path', () => {
  // The field itself. `feature/wip-here` carries pushed work whose last commit
  // is old; the worktree's uncommitted edits are the only evidence anyone is on
  // it, and git can see none of it from refs.
  const f = makeRepo('plot-fleet-dirty-', ONE_WAVE('feature/wip-here'));
  f.work('feature/wip-here', 'w.txt');
  f.push('-u', 'origin', 'feature/wip-here');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/wip-here', 'dirty');
  fs.writeFileSync(path.join(wt, 'w.txt'), 'edited but not committed\n');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/wip-here');
  assert.equal(b.local_dirty, true, 'uncommitted changes must be reported');
  assert.equal(b.local_worktree, wt, 'and the path travels with them');
  // The git state itself is untouched: local knowledge adds a field, it does
  // not rewrite what the refs say.
  assert.equal(b.state, 'wip');
  f.cleanup();
});

test('fleet: a CLEAN worktree lifts nothing, but still reports its path', () => {
  // The one place the clean/dirty distinction inverts, and consistently so:
  // dirtiness is evidence of WORK, presence is evidence of LOCATION. A clean
  // checkout is equally consistent with finished and never-started, so it is
  // not evidence of work — but "where did I put this" is exactly the question
  // it does answer, and the plan modal is the place that asks it.
  const f = makeRepo('plot-fleet-clean-', ONE_WAVE('feature/clean-here'));
  f.work('feature/clean-here', 'c.txt');
  f.push('-u', 'origin', 'feature/clean-here');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/clean-here', 'clean');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/clean-here');
  assert.equal(b.local_dirty, false, 'a clean tree is not evidence of work');
  assert.equal(b.local_worktree, wt, 'but it is evidence of location');
  f.cleanup();
});

test('fleet: a branch with no worktree on this machine answers exactly as before', () => {
  // The assertion that keeps the change ADDITIVE. Without it, a regression that
  // downgrades branches living on other machines — which is nearly all of them
  // — would pass unnoticed.
  const f = makeRepo('plot-fleet-nowt-', ONE_WAVE('feature/elsewhere'));
  f.work('feature/elsewhere', 'e.txt');
  f.push('-u', 'origin', 'feature/elsewhere');
  git(f.dir, 'checkout', '-q', 'main');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/elsewhere');
  assert.equal(b.local_dirty, false);
  assert.equal(b.local_worktree, '', 'absent is absent — never a path that does not exist');
  assert.equal(b.state, 'wip', 'and the refs answer is untouched');
  f.cleanup();
});

test('fleet: a MISSING worktree directory is detected, not mistaken for clean', () => {
  // The trap in miniature. A worktree directory can be deleted without `git
  // worktree remove`, and the entry survives in `git worktree list`. `git
  // status` there exits 128 and prints NOTHING — so a check written as "is the
  // output non-empty" reads `clean` and is right BY ACCIDENT, because empty
  // output would then mean both "clean" and "I could not look".
  //
  // `git worktree list --porcelain` marks such entries `prunable`, so they are
  // skipped before `git status` is ever asked. Asserting only the outcome would
  // pass on the accident; this asserts the DETECTION, by counting the status
  // calls that were made. Zero of them ran against the deleted directory.
  const f = makeRepo('plot-fleet-gonewt-', ONE_WAVE('feature/vanished'));
  f.work('feature/vanished', 'v.txt');
  f.push('-u', 'origin', 'feature/vanished');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/vanished', 'gone');
  fs.rmSync(wt, { recursive: true, force: true });   // deleted, never pruned

  // A git shim on PATH records argv, so the skip can be asserted rather than
  // inferred from an outcome that would look identical either way.
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gitshim-wt-'));
  const argvLog = path.join(shim, 'git.argv');
  const realGit = execFileSync('bash', ['-lc', 'command -v git'],
    { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(shim, 'git'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}
exec ${JSON.stringify(realGit)} "$@"
`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);

  const out = execFileSync('bash', [scan, '--offline', '--json'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
  });
  const b = JSON.parse(out).plans[0].waves[0].branches
    .find((x) => x.branch === 'feature/vanished');
  assert.equal(b.local_dirty, false, 'a tree that cannot be looked at is not evidence');
  assert.equal(b.local_worktree, '', 'and a path that does not exist is not offered');

  const statusCalls = fs.readFileSync(argvLog, 'utf8').split('\n')
    .filter((l) => l.startsWith('-C ') && l.includes(' status '));
  assert.equal(statusCalls.filter((l) => l.includes(wt)).length, 0,
    'the prunable entry must be skipped, not probed and misread as clean');

  fs.rmSync(shim, { recursive: true, force: true });
  f.cleanup();
});

test('fleet: the worktree list is read once per run, not once per branch', () => {
  // Same rule as the merge walk above, for the same reason: branch_state runs
  // per branch and the board polls every 5 s, so the naive shape is
  // O(worktrees × branches) where O(worktrees + branches) is available. Counted
  // rather than timed — a timing assertion cannot catch a call that is merely
  // cheap today.
  const f = makeRepo('plot-fleet-wtonce-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    ['a', 'b', 'c'].map((n) => `- \`feature/${n}\` — work\n`).join(''));
  for (const n of ['a', 'b', 'c']) {
    f.work(`feature/${n}`, `${n}.txt`);
    f.push('-u', 'origin', `feature/${n}`);
  }
  git(f.dir, 'checkout', '-q', 'main');

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gitshim-wt2-'));
  const argvLog = path.join(shim, 'git.argv');
  const realGit = execFileSync('bash', ['-lc', 'command -v git'],
    { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(shim, 'git'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}
exec ${JSON.stringify(realGit)} "$@"
`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);

  execFileSync('bash', [scan, '--offline'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
  });
  const walks = fs.readFileSync(argvLog, 'utf8').split('\n')
    .filter((l) => l.startsWith('worktree list'));
  assert.equal(walks.length, 1,
    `the worktree list must be read once per run, saw ${walks.length}`);
  fs.rmSync(shim, { recursive: true, force: true });
  f.cleanup();
});

test('fleet: the local signal stays git-only — no host call, and no cap', () => {
  // Two properties in one fixture.
  //
  // No host call: the default path is what lets the board poll every 5 s, and a
  // metered call here would dwarf the GraphQL budget the board already spends.
  // A `gh`/`bb` stub that records any invocation catches a reintroduction.
  //
  // No cap: measured at 6.6 ms per worktree, twenty cost ~133 ms against a scan
  // that already runs 500-1050 ms. A cap would be stock against a problem the
  // numbers rule out, and caps drop results silently unless they also report
  // saturation. Asserted by COUNT — every worktree is probed — since a runtime
  // assertion cannot tell a dropped result from a fast one.
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  const f = makeRepo('plot-fleet-nocap-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    names.map((n) => `- \`feature/${n}\` — work\n`).join(''));
  const trees = {};
  for (const n of names) {
    f.work(`feature/${n}`, `${n}.txt`);
    f.push('-u', 'origin', `feature/${n}`);
    git(f.dir, 'checkout', '-q', 'main');
    trees[n] = addWorktree(f, `feature/${n}`, n);
    fs.writeFileSync(path.join(trees[n], `${n}.txt`), 'uncommitted\n');
  }

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-nohost-wt-'));
  const callLog = path.join(shim, 'host.calls');
  for (const cli of ['gh', 'bb']) {
    fs.writeFileSync(path.join(shim, cli), `#!/usr/bin/env bash
printf '%s %s\\n' ${JSON.stringify(cli)} "$*" >> ${JSON.stringify(callLog)}
exit 1
`);
    fs.chmodSync(path.join(shim, cli), 0o755);
  }

  const out = execFileSync('bash', [scan, '--offline', '--json'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
  });
  const branches = JSON.parse(out).plans[0].waves[0].branches;
  for (const n of names) {
    const b = branches.find((x) => x.branch === `feature/${n}`);
    assert.equal(b.local_dirty, true, `feature/${n} must not be dropped by a cap`);
  }
  assert.equal(fs.existsSync(callLog), false,
    'the local signal must make no host calls');
  fs.rmSync(shim, { recursive: true, force: true });
  f.cleanup();
});

// --- a locked worktree is an answer, not an absence --------------------------
//
// `.git/index.lock` means *an agent is writing HERE, RIGHT NOW* — the most
// informative state a worktree can be in, and precisely what the fleet view
// exists to show. Until #167 the scan computed that fact and threw it away:
// `git status` failed under the lock, the loop hit `continue`, and the branch
// answered from refs as though this machine held no worktree for it. The row
// read *claimed, no commits yet* while a commit was in flight.
//
// THE LOCK IS OBSERVED DIRECTLY, and that corrects the plan. It expected a lock
// to announce itself by FAILING `git status`. Measured on 2026-08-17 it does
// not: `git status --porcelain` exits 0 under a held lock in every ordinary
// condition, because it takes the index lock only when it decides to WRITE a
// refreshed index — which it skips whenever cached stat info already answers.
// The failure the plan was written from is real and RACY. Keying the signal on
// that exit code would report a lock on some runs and not others for the same
// worktree in the same state, and these tests would be the flakiest in the file.
// So the lock file itself is the observation, and the test asserts it that way.
//
// The two properties these tests hold, and neither survives without the other:
//   * LOCKED IS REPORTED — `local_locked:true`, with the path, because the
//     directory demonstrably exists.
//   * LOCKED IS NOT MISSING — the two are separate observations rather than one
//     exit code carrying two meanings, and collapsing them would recreate the
//     absence ambiguity in a new place.
//
// Read docs/plans/2026-08-17-board-survives-its-agents.md before changing any of
// it.

/** Hold `index.lock` in a worktree's OWN git dir — where a linked one keeps it. */
function lockWorktree(wt) {
  const gitDir = execFileSync('git', ['-C', wt, 'rev-parse', '--absolute-git-dir'],
    { encoding: 'utf8' }).trim();
  const lock = path.join(gitDir, 'index.lock');
  fs.writeFileSync(lock, '');
  return lock;
}

test('fleet: a LOCKED worktree is reported as locked, not skipped', () => {
  // The defect itself, in the shape an agent mid-`commit` produces: a linked
  // worktree with an uncommitted edit and the index lock held.
  const f = makeRepo('plot-fleet-locked-', ONE_WAVE('feature/being-written'));
  f.work('feature/being-written', 'b.txt');
  f.push('-u', 'origin', 'feature/being-written');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/being-written', 'locked');
  fs.writeFileSync(path.join(wt, 'b.txt'), 'mid-write\n');
  const lock = lockWorktree(wt);

  // The fixture must hold the lock where a LINKED worktree actually keeps it —
  // in its own git dir under `<repo>/.git/worktrees/<name>`, not beside the
  // repository's index. A scan that tested `$wt/.git/index.lock` would report
  // every dispatched agent's worktree unlocked, so if this assertion ever fails
  // the test below is proving nothing.
  assert.equal(fs.existsSync(lock), true);
  assert.match(lock, /\.git\/worktrees\/[^/]+\/index\.lock$/,
    'a linked worktree keeps its index lock in its OWN git dir');
  assert.equal(fs.existsSync(path.join(wt, '.git', 'index.lock')), false,
    'and NOT at $wt/.git/index.lock — `.git` there is a pointer file');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/being-written');
  assert.equal(b.local_locked, true, 'a write is in progress and must be said');
  assert.equal(b.local_worktree, wt,
    'the path travels: something is writing in that directory, so it is there');
  // The two facts are INDEPENDENT, and this fixture holds both at once: the tree
  // has an uncommitted edit AND a write is in progress. Each is reported on its
  // own evidence, and neither is derived from the other — a lock is not a
  // dirtiness measurement, and dirtiness is not a lock.
  assert.equal(b.local_dirty, true,
    'the edit is still observed — the lock does not suppress the other signal');
  // The refs answer is untouched, as it is for every other local signal.
  assert.equal(b.state, 'wip');
  f.cleanup();
});

test('fleet: a lock is reported on a CLEAN worktree too', () => {
  // The assertion that keeps `local_locked` from being a flavour of
  // `local_dirty`. With a dirty tree beneath it the shipped signal would cover
  // for the new one and the pair could not be told apart — so this fixture holds
  // a lock and NOTHING else, which is what a worktree mid-`git commit` looks
  // like the instant after `git add` has moved the edits into the index.
  const f = makeRepo('plot-fleet-lockclean-', ONE_WAVE('feature/clean-lock'));
  f.work('feature/clean-lock', 'cl.txt');
  f.push('-u', 'origin', 'feature/clean-lock');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/clean-lock', 'cleanlock');
  lockWorktree(wt);

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/clean-lock');
  assert.equal(b.local_dirty, false, 'nothing is uncommitted here — this is the point');
  assert.equal(b.local_locked, true, 'and the write in progress is still seen');
  f.cleanup();
});

test('fleet: a LOCKED worktree is distinguishable from a MISSING one', () => {
  // The pairing that keeps the fix from recreating the ambiguity it removes.
  // Both worktrees fail `git status` with identical empty output; only the
  // interrogation of the failure separates them, and only a fixture holding both
  // at once can assert that it happened.
  const f = makeRepo('plot-fleet-lockvsgone-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n'
    + '- `feature/locked` — mid-write\n- `feature/gone` — its directory was deleted\n');
  for (const n of ['locked', 'gone']) {
    f.work(`feature/${n}`, `${n}.txt`);
    f.push('-u', 'origin', `feature/${n}`);
    git(f.dir, 'checkout', '-q', 'main');
  }
  const lockedWt = addWorktree(f, 'feature/locked', 'lk');
  fs.writeFileSync(path.join(lockedWt, 'locked.txt'), 'mid-write\n');
  lockWorktree(lockedWt);
  const goneWt = addWorktree(f, 'feature/gone', 'gn');
  fs.rmSync(goneWt, { recursive: true, force: true });   // deleted, never pruned

  const branches = JSON.parse(f.run(['--json'])).plans[0].waves[0].branches;
  const locked = branches.find((x) => x.branch === 'feature/locked');
  const gone = branches.find((x) => x.branch === 'feature/gone');

  assert.equal(locked.local_locked, true, 'the locked one says a write is happening');
  assert.equal(locked.local_worktree, lockedWt);
  // The missing one keeps the answer it has always given: nothing observed, so
  // nothing reported. Absent is ABSENT — not locked, and not clean either.
  assert.equal(gone.local_locked, false,
    'a vanished worktree is not a write in progress');
  assert.equal(gone.local_worktree, '',
    'and no path is offered for a directory that is not there');
  assert.equal(gone.local_dirty, false);
  f.cleanup();
});

test('fleet: the scan does not retry or wait on a lock', () => {
  // A lock held through a rebase can last seconds; the next poll is 4 s away and
  // will find it unlocked. A scan that blocks on one worktree makes the pulse
  // late for every branch on the board — a worse version of the defect being
  // fixed. Reporting beats blocking.
  //
  // Asserted by COUNTING the status calls rather than by timing: a timing
  // assertion cannot tell a retry that happened to be fast from no retry at all,
  // and it would be the flakiest test in the file. Exactly one `git status` per
  // worktree, lock or no lock.
  const f = makeRepo('plot-fleet-noretry-', ONE_WAVE('feature/held'));
  f.work('feature/held', 'h.txt');
  f.push('-u', 'origin', 'feature/held');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/held', 'held');
  fs.writeFileSync(path.join(wt, 'h.txt'), 'mid-write\n');
  lockWorktree(wt);

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gitshim-lock-'));
  const argvLog = path.join(shim, 'git.argv');
  const realGit = execFileSync('bash', ['-lc', 'command -v git'],
    { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(shim, 'git'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}
exec ${JSON.stringify(realGit)} "$@"
`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);

  const out = execFileSync('bash', [scan, '--offline', '--json'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
  });
  const b = JSON.parse(out).plans[0].waves[0].branches
    .find((x) => x.branch === 'feature/held');
  assert.equal(b.local_locked, true, 'the lock must still be reported');

  const statusCalls = fs.readFileSync(argvLog, 'utf8').split('\n')
    .filter((l) => l.startsWith('-C ') && l.includes(' status ') && l.includes(wt));
  assert.equal(statusCalls.length, 1,
    `a locked worktree must be asked ONCE and reported, saw ${statusCalls.length} status calls`);

  fs.rmSync(shim, { recursive: true, force: true });
  f.cleanup();
});

test('fleet: a branch with no worktree reports local_locked false', () => {
  // The assertion that keeps the signal ADDITIVE, in the same shape the other
  // two local signals already have. Every detached worker, every teammate's
  // laptop, every CI run is this case, and false is the answer that changes
  // nothing.
  const f = makeRepo('plot-fleet-nolock-', ONE_WAVE('feature/remote-only'));
  f.work('feature/remote-only', 'r.txt');
  f.push('-u', 'origin', 'feature/remote-only');
  git(f.dir, 'checkout', '-q', 'main');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/remote-only');
  assert.equal(b.local_locked, false, 'nothing observed here, so nothing claimed');
  assert.equal(b.state, 'wip', 'and the refs answer is untouched');
  f.cleanup();
});

// --- held: a worktree holding an unmerged branch --------------------------
//
// `local_worktree` answers WHERE a branch is checked out here; `held` answers
// whether that checkout is EVIDENCE SOMEONE HOLDS THE BRANCH. The two differ on
// exactly one branch: a clean worktree left on a branch whose tip has merged is
// a leftover directory, not a held branch. So `held` is the AND of two facts the
// scan already has at the point it emits them — a worktree here, and a tip not
// merged — and it is what a consumer reads instead of re-deriving `!merged`
// itself. Additive, like every other local signal: false wherever this machine
// holds no worktree, which is every branch on every other machine.

test('fleet: a committed-and-clean worktree reads held', () => {
  // The case the plan is named for. A worktree holds the branch and its tip is
  // NOT on main — the work is in flight, committed but not landed. `local_dirty`
  // is false because the commit cleared it, and that is exactly the signal that
  // used to make this branch read as free. `held` sees it.
  const f = makeRepo('plot-fleet-held-clean-', ONE_WAVE('feature/in-flight'));
  f.work('feature/in-flight', 'i.txt');
  f.push('-u', 'origin', 'feature/in-flight');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/in-flight', 'inflight');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/in-flight');
  assert.equal(b.local_dirty, false, 'the commit cleared the dirty signal — this is the point');
  assert.equal(b.local_worktree, wt, 'the worktree is here');
  assert.equal(b.state, 'wip', 'and its tip has not landed');
  assert.equal(b.held, true, 'a worktree on an unmerged branch is held, committed or not');
  f.cleanup();
});

test('fleet: a dirty worktree reads held', () => {
  // The other in-flight shape: uncommitted edits on a branch whose tip has not
  // landed. `held` and `local_dirty` both fire here, but they answer different
  // questions — dirtiness says someone is editing, held says the branch is taken.
  const f = makeRepo('plot-fleet-held-dirty-', ONE_WAVE('feature/editing'));
  f.work('feature/editing', 'e.txt');
  f.push('-u', 'origin', 'feature/editing');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/editing', 'editing');
  fs.writeFileSync(path.join(wt, 'e.txt'), 'edited, not committed\n');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/editing');
  assert.equal(b.local_dirty, true, 'uncommitted edits are present');
  assert.equal(b.held, true, 'and the branch is held');
  f.cleanup();
});

test('fleet: a clean worktree on a MERGED branch is not held', () => {
  // The one branch `held` must NOT fire on, and the reason it is a derivation
  // over the state rather than a rename of `local_worktree`. The branch merged
  // (its ref still exists, so the ancestry path reads `merged`) and a clean
  // worktree was left on it — a leftover directory, not somebody holding the
  // branch. `local_worktree` still reports the path (location is a fact); `held`
  // reports false (holding is not).
  const f = makeRepo('plot-fleet-held-merged-', ONE_WAVE('feature/landed-wt'));
  f.work('feature/landed-wt', 'l.txt');
  f.push('-u', 'origin', 'feature/landed-wt');
  f.prMerge('feature/landed-wt');            // --no-ff into main, ref kept
  f.push('origin', 'main');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/landed-wt', 'landedwt');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/landed-wt');
  assert.equal(b.state, 'merged', 'the tip has landed');
  assert.equal(b.local_worktree, wt, 'the leftover directory is still located');
  assert.equal(b.held, false, 'but a merged tip is a leftover, not a held branch');
  f.cleanup();
});

test('fleet: a claim ref with no worktree still reads claimed, and not held', () => {
  // `held` is ADDITIVE and comes from the worktree list; the claim comes from
  // the refs. A dispatcher on another machine pushes a claim commit and this
  // machine has no worktree for it — so `held` is false (nothing observed here)
  // while `claimed` stands untouched. The one must not shadow the other: a claim
  // ref is still the primary, cross-machine signal.
  const f = makeRepo('plot-fleet-held-claim-', ONE_WAVE('feature/taken'));
  git(f.dir, 'checkout', '-qb', 'feature/taken');
  git(f.dir, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/taken');
  f.push('-u', 'origin', 'feature/taken');
  git(f.dir, 'checkout', '-q', 'main');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/taken');
  assert.equal(b.state, 'claimed', 'the claim ref is untouched');
  assert.equal(b.local_worktree, '', 'no worktree here');
  assert.equal(b.held, false, 'and held is false where this machine holds nothing');
  f.cleanup();
});

test('fleet: a branch with no local worktree reports held false', () => {
  // The assertion that keeps `held` additive, in the shape its neighbours have.
  // Every detached worker, every teammate's laptop, every CI run is this case.
  const f = makeRepo('plot-fleet-held-elsewhere-', ONE_WAVE('feature/far-away'));
  f.work('feature/far-away', 'a.txt');
  f.push('-u', 'origin', 'feature/far-away');
  git(f.dir, 'checkout', '-q', 'main');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/far-away');
  assert.equal(b.local_worktree, '', 'nothing here');
  assert.equal(b.held, false, 'so nothing is held');
  assert.equal(b.state, 'wip', 'and the refs answer is untouched');
  f.cleanup();
});

test('fleet: holding a branch does not change its wave eligibility', () => {
  // `held` is a REPORTED fact, never an input to the wave arithmetic. A held
  // branch in an eligible wave stays eligible; a held branch does not settle its
  // own wave or open the next. Two waves: wave One holds an unmerged, held branch
  // (open work), so wave Two must stay blocked behind it exactly as it would if
  // no worktree existed.
  const plan =
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n' +
    '### One\n- `feature/wave-a` — first\n\n' +
    '### Two\n- `feature/wave-b` — second\n';
  const f = makeRepo('plot-fleet-held-waves-', plan);
  // wave-a: unmerged work, held by a local worktree.
  f.work('feature/wave-a', 'a.txt');
  f.push('-u', 'origin', 'feature/wave-a');
  git(f.dir, 'checkout', '-q', 'main');
  addWorktree(f, 'feature/wave-a', 'wavea');

  const doc = JSON.parse(f.run(['--json']));
  const waves = doc.plans[0].waves;
  const a = waves[0].branches.find((x) => x.branch === 'feature/wave-a');
  assert.equal(a.held, true, 'wave One is held');
  assert.equal(waves[0].verdict, 'eligible', 'a held, unmerged branch keeps its wave eligible');
  assert.equal(waves[1].verdict, 'blocked',
    'and the next wave stays blocked behind it — holding settles nothing');
  f.cleanup();
});

// --- unpushed commits are not "no commits yet" -------------------------------
//
// `local_dirty` reports *someone is editing*, and committing CLEARS it — so a
// worker that finishes tidily and pauses before pushing leaves a clean worktree,
// a false flag, and a board reading "claimed, no commits yet" for a branch
// holding a complete implementation. Measured on 2026-08-16 on the very branch
// that fixed the other half: 3 commits ahead, 0 dirty files, no PR.
//
// IT IS A REF QUESTION, NOT A WORKTREE QUESTION, and that is what most of these
// tests exist to hold. Worktrees share one ref database, so the answer exists
// without a worktree — and a local branch with none still holds commits nobody
// else can see. Routing this through the worktree list "for consistency with
// local_dirty" was this plan's own first draft, and it skips exactly those.
//
// Read docs/plans/2026-08-16-fleet-sees-unpushed-commits.md before changing any
// of it.

test('fleet: unpushed commits are reported, with a CLEAN worktree', () => {
  // The exact case that produced the plan. `local_dirty` is asserted FALSE on
  // purpose: with it true the shipped signal covers for the new one and the
  // test proves nothing.
  const f = makeRepo('plot-fleet-ahead-', ONE_WAVE('feature/unpushed'));
  f.work('feature/unpushed', 'u.txt');
  f.push('-u', 'origin', 'feature/unpushed');          // an upstream exists…
  fs.writeFileSync(path.join(f.dir, 'u2.txt'), 'finished\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'finished, and not pushed');
  fs.writeFileSync(path.join(f.dir, 'u3.txt'), 'also finished\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'also finished, also not pushed');
  git(f.dir, 'checkout', '-q', 'main');                // …and a clean tree

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/unpushed');
  assert.equal(b.local_ahead, 2, 'two commits exist that the remote does not have');
  assert.equal(b.local_dirty, false,
    'and no uncommitted change is covering for them — this is the whole case');
  // The git state itself is untouched: local knowledge adds a field, it does not
  // rewrite what the refs say.
  assert.equal(b.state, 'wip');
  f.cleanup();
});

test('fleet: a local branch with NO worktree is still seen', () => {
  // The assertion that fails if someone later routes this through the worktree
  // list for consistency with `local_dirty`. Refs are shared across worktrees,
  // so the answer exists without one — and a branch checked out once and moved
  // away from, or fetched from a colleague, still holds invisible commits.
  //
  // `git worktree list` in this fixture names exactly ONE worktree (the repo
  // itself, on main), so `feature/orphan` appears in no worktree at all.
  const f = makeRepo('plot-fleet-ahead-nowt-', ONE_WAVE('feature/orphan'));
  f.work('feature/orphan', 'o.txt');
  f.push('-u', 'origin', 'feature/orphan');
  fs.writeFileSync(path.join(f.dir, 'o2.txt'), 'invisible\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'nobody else can see this');
  git(f.dir, 'checkout', '-q', 'main');

  const worktrees = git(f.dir, 'worktree', 'list', '--porcelain')
    .split('\n').filter((l) => l.startsWith('branch '));
  assert.deepEqual(worktrees, ['branch refs/heads/main'],
    'the fixture must hold no worktree for feature/orphan, or it proves nothing');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/orphan');
  assert.equal(b.local_worktree, '', 'no worktree — this is the point');
  assert.equal(b.local_ahead, 1, 'and the unpushed commit is seen anyway');
  f.cleanup();
});

test('fleet: a MISSING upstream is detected, not read as zero', () => {
  // The trap, and the same one the worktree code already handles: a missing
  // upstream exits 128 printing NOTHING, bit-identical to the deleted-worktree
  // signature. A check written as "is the output non-empty" reads `0` and is
  // right BY ACCIDENT, because empty output would then mean both "zero ahead"
  // and "I could not look".
  //
  // Asserting only the outcome would pass on the accident, so this asserts the
  // DETECTION: a git shim records argv, and the run is confirmed to have made
  // the call and had it FAIL — rc 128, empty stdout — before the 0 is accepted.
  const f = makeRepo('plot-fleet-noupstream-', ONE_WAVE('feature/never-pushed'));
  f.work('feature/never-pushed', 'n.txt');             // committed, NEVER pushed
  git(f.dir, 'checkout', '-q', 'main');

  // The signature itself, measured rather than assumed.
  const probe = execFileSync('bash', ['-c',
    'out=$(git rev-list --count "refs/remotes/origin/feature/never-pushed..refs/heads/feature/never-pushed" 2>/dev/null); '
    + 'printf "%s|%s" "$?" "$out"'],
  { encoding: 'utf8', cwd: f.dir });
  assert.equal(probe, '128|',
    'the failure must be exit 128 with EMPTY output — the whole reason to read the code');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/never-pushed');
  assert.equal(b.local_ahead, 0,
    'a failure to observe reports 0 — not evidence, and not a crash');
  // A branch with no remote ref keeps the answer it gave before this field
  // existed: absent is not false.
  assert.equal(b.state, 'open');
  f.cleanup();
});

test('fleet: a FAILED ahead query is not read as its own output', () => {
  // The assertion the test above cannot make, and the reason it needs a
  // companion. Reading the exit code and reading the emptiness produce the SAME
  // 0 whenever a failure happens to print nothing — so the natural fixture
  // passes either way, and the check that is right by accident survives.
  //
  // What separates them is a failure that prints SOMETHING. A git shim makes
  // the ahead query exit 128 while printing a number: reading the exit code
  // discards it and reports 0, reading the output believes it. There is nothing
  // subtle left to get wrong.
  //
  // Only the ahead query is intercepted — every other git call runs for real,
  // so the rest of the scan is unaffected and the branch's own state is still
  // derived normally.
  const f = makeRepo('plot-fleet-ahead-fail-', ONE_WAVE('feature/liar'));
  f.work('feature/liar', 'l.txt');
  f.push('-u', 'origin', 'feature/liar');
  git(f.dir, 'checkout', '-q', 'main');

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gitshim-ahead-'));
  const realGit = execFileSync('bash', ['-lc', 'command -v git'],
    { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(shim, 'git'), `#!/usr/bin/env bash
# The ahead query only: "<remote>..<local>" for this branch.
for a in "$@"; do
  case "$a" in
    refs/remotes/origin/feature/liar..refs/heads/feature/liar)
      echo 99          # a number, on a call that FAILS
      exit 128 ;;
  esac
done
exec ${JSON.stringify(realGit)} "$@"
`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);

  const out = execFileSync('bash', [scan, '--offline', '--json'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
  });
  const b = JSON.parse(out).plans[0].waves[0].branches
    .find((x) => x.branch === 'feature/liar');
  assert.equal(b.local_ahead, 0,
    'output from a failed call is not evidence — the exit code decides, not the emptiness');
  fs.rmSync(shim, { recursive: true, force: true });
  f.cleanup();
});

test('fleet: a branch BEHIND the remote reports zero ahead', () => {
  // `A..B` and `B..A` are easy to swap, and the swapped version reports every
  // branch somebody else has pushed to as local work — turning the whole board
  // into a wall of false "unpushed" rows. Assert zero.
  const f = makeRepo('plot-fleet-behind-', ONE_WAVE('feature/behind'));
  f.work('feature/behind', 'b1.txt');
  f.push('-u', 'origin', 'feature/behind');
  // Somebody else pushes two more commits; this machine has not fetched them
  // into its local branch, so the local ref trails the remote by two.
  fs.writeFileSync(path.join(f.dir, 'b2.txt'), 'theirs\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'their work');
  f.push('origin', 'feature/behind');
  git(f.dir, 'checkout', '-q', 'main');
  // Point the LOCAL branch back one commit: behind the remote, ahead of nothing.
  git(f.dir, 'branch', '-f', 'feature/behind', 'origin/feature/behind~1');

  const behind = git(f.dir, 'rev-list', '--count',
    'refs/heads/feature/behind..refs/remotes/origin/feature/behind').trim();
  assert.equal(behind, '1', 'the fixture must actually be behind, or it proves nothing');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/behind');
  assert.equal(b.local_ahead, 0, 'being behind is not an invisible state');
  f.cleanup();
});

test('fleet: a branch with NO local head is not asked, and answers zero', () => {
  // The population that dominates a real scan: a branch pushed from another
  // machine, so `origin/<br>` exists but this checkout has no `refs/heads/<br>`.
  // `local_ahead_of` used to spawn a `rev-list` for it that exited 128 and
  // answered 0 — one process per absent-head branch to rediscover a zero the
  // LOCAL_HEADS batch already knows. The gate skips that spawn.
  //
  // This asserts the SKIP, not merely the 0: a 0 alone would pass whether the
  // rev-list ran or not, which is the accident the companion upstream tests
  // exist to forbid in the other direction. A git-argv shim records the ahead
  // query's exact range and the assertion is that it was NEVER issued.
  const f = makeRepo('plot-fleet-nohead-', ONE_WAVE('feature/elsewhere'));
  f.work('feature/elsewhere', 'e.txt');
  f.push('-u', 'origin', 'feature/elsewhere');
  // Delete the LOCAL head, keeping origin/feature/elsewhere — the exact shape of
  // a branch that only ever lived on someone else's machine.
  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'branch', '-D', 'feature/elsewhere');

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gitshim-nohead-'));
  const seen = path.join(shim, 'ahead.calls');
  const realGit = execFileSync('bash', ['-lc', 'command -v git'],
    { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(shim, 'git'), `#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    refs/remotes/origin/feature/elsewhere..refs/heads/feature/elsewhere)
      printf '%s\\n' "$a" >> ${JSON.stringify(seen)} ;;
  esac
done
exec ${JSON.stringify(realGit)} "$@"
`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);

  const out = execFileSync('bash', [scan, '--json'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
  });
  const b = JSON.parse(out).plans[0].waves[0].branches
    .find((x) => x.branch === 'feature/elsewhere');
  assert.equal(b.local_ahead, 0,
    'a branch with no local head has no local work to hide — it answers 0');
  assert.equal(fs.existsSync(seen), false,
    'and it answers 0 WITHOUT spawning the ahead query — the skip is the point');
  fs.rmSync(shim, { recursive: true, force: true });
  f.cleanup();
});

test('fleet: unpushed commits make no host call, and are not capped', () => {
  // Two properties in one fixture, exactly as the worktree signal pins them.
  //
  // No host call: the default path is what lets the board poll every 5 s.
  // No cap: measured at 5.2 ms per call, twenty branches cost ~104 ms against a
  // scan that already runs 500-1050 ms. Asserted by COUNT — every branch is
  // probed — since a runtime assertion cannot tell a dropped result from a fast
  // one.
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  const f = makeRepo('plot-fleet-ahead-nocap-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    names.map((n) => `- \`feature/${n}\` — work\n`).join(''));
  for (const n of names) {
    f.work(`feature/${n}`, `${n}.txt`);
    f.push('-u', 'origin', `feature/${n}`);
    fs.writeFileSync(path.join(f.dir, `${n}2.txt`), 'unpushed\n');
    git(f.dir, 'add', '-A');
    git(f.dir, 'commit', '-qm', `unpushed on ${n}`);
    git(f.dir, 'checkout', '-q', 'main');
  }

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-nohost-ahead-'));
  const callLog = path.join(shim, 'host.calls');
  for (const cli of ['gh', 'bb']) {
    fs.writeFileSync(path.join(shim, cli), `#!/usr/bin/env bash
printf '%s %s\\n' ${JSON.stringify(cli)} "$*" >> ${JSON.stringify(callLog)}
exit 1
`);
    fs.chmodSync(path.join(shim, cli), 0o755);
  }

  const out = execFileSync('bash', [scan, '--offline', '--json'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
  });
  const branches = JSON.parse(out).plans[0].waves[0].branches;
  for (const n of names) {
    const b = branches.find((x) => x.branch === `feature/${n}`);
    assert.equal(b.local_ahead, 1, `feature/${n} must not be dropped by a cap`);
  }
  assert.equal(fs.existsSync(callLog), false,
    'the local signal must make no host calls');
  fs.rmSync(shim, { recursive: true, force: true });
  f.cleanup();
});

test('fleet: unpushed commits leave the human report byte-identical', () => {
  // Same regression guard the dirty signal carries: the prose report is a HUMAN
  // interface and the row it feeds lives in the board. Adding a field to the
  // machine rendering must not reshape the one people read.
  const f = makeRepo('plot-fleet-ahead-prose-', ONE_WAVE('feature/quiet-prose'));
  f.work('feature/quiet-prose', 'q.txt');
  f.push('-u', 'origin', 'feature/quiet-prose');
  git(f.dir, 'checkout', '-q', 'main');
  const before = f.run();
  git(f.dir, 'checkout', '-q', 'feature/quiet-prose');
  fs.writeFileSync(path.join(f.dir, 'q2.txt'), 'unpushed\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'unpushed');
  git(f.dir, 'checkout', '-q', 'main');
  const after = f.run();
  assert.equal(after, before,
    'unpushed commits must change the JSON, not the prose');
  f.cleanup();
});

test('fleet: the local signal leaves the human report byte-identical', () => {
  // The prose report is a HUMAN interface and the row it feeds lives in the
  // board, not here. Adding a field to the machine rendering must not reshape
  // the rendering people read — the same regression guard `--json` carries.
  const f = makeRepo('plot-fleet-prose-', ONE_WAVE('feature/prose'));
  f.work('feature/prose', 'p.txt');
  f.push('-u', 'origin', 'feature/prose');
  git(f.dir, 'checkout', '-q', 'main');
  const before = f.run();
  const wt = addWorktree(f, 'feature/prose', 'prose');
  fs.writeFileSync(path.join(wt, 'p.txt'), 'dirty now\n');
  const after = f.run();
  assert.equal(after, before,
    'a dirty worktree must change the JSON, not the prose');
  f.cleanup();
});

// --- a claim is not a worker -------------------------------------------------
//
// A claim is a push: it says a dispatcher TOOK the branch and nothing more. On
// 2026-08-17 three rows sat in WORKING with a pulsing dot while nobody was
// working on any of them — the claim was real, the worker was never started.
//
// `worker_state()` in plot-dispatch.sh has distinguished FIVE outcomes since it
// was written, and `grep -rn "plot-worker.pid" packages/board/src` returned
// NOTHING: the information was already richer than the board assumed and reached
// no screen. This does not add a liveness check; it reports the one that exists.
//
// SIX values travel, because the absence of a worktree is a THIRD kind of answer
// and not the second one — the pid lives IN the worktree, so a branch claimed on
// another machine has nowhere here to look.
//
// Read docs/plans/2026-08-17-dispatch-hands-over-work.md before changing any of
// it.

/** The worker record `plot-dispatch` writes, or the half of it that exists. */
function writeWorker(wt, pid, exitCode) {
  if (pid !== null) fs.writeFileSync(path.join(wt, '.plot-worker.pid'), `${pid}\n`);
  if (exitCode !== undefined) {
    fs.writeFileSync(path.join(wt, '.plot-worker.exit'), `${exitCode}\n`);
  }
}

/** The branch's worker triple from a --json run. */
function workerOf(f, branch) {
  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === branch);
  return { state: b.worker, pid: b.worker_pid, exit: b.worker_exit, git: b.state };
}

/** A claimed branch — the empty `plot: claim` marker a dispatcher pushes. */
function claim(f, br) {
  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'checkout', '-qb', br);
  git(f.dir, 'commit', '-q', '--allow-empty', '-m', `plot: claim ${br}`);
  f.push('-u', 'origin', br);
  git(f.dir, 'checkout', '-q', 'main');
}

test('fleet: a claim with NO worktree here says `elsewhere`, not `none`', () => {
  // The third state, and the one a two-value design gets wrong. The pid lives in
  // the worktree, so this machine has nowhere to look at all — which calls for
  // asking the machine that took the branch, not for looking again here.
  const f = makeRepo('plot-worker-elsewhere-', ONE_WAVE('feature/taken-away'));
  claim(f, 'feature/taken-away');

  const w = workerOf(f, 'feature/taken-away');
  assert.equal(w.state, 'elsewhere', 'no worktree here — the question cannot be answered');
  assert.equal(w.git, 'claimed', 'and the refs answer is untouched');
  f.cleanup();
});

test('fleet: a worktree with NO pid says `none` — unknown, never "nobody"', () => {
  // `plot-dispatch` writes the pid only where it started the worker ITSELF, so a
  // hand-started agent leaves none — and hand-starting is the normal case for as
  // long as `Worker command` is unset. Five agents were started that way in one
  // session; reading a missing pid as "nobody is working" would have reported
  // every one of them dead.
  //
  // `none` and `elsewhere` are asserted DIFFERENT here, because that is the pair
  // a lazy implementation collapses.
  const f = makeRepo('plot-worker-none-', ONE_WAVE('feature/hand-started'));
  claim(f, 'feature/hand-started');
  addWorktree(f, 'feature/hand-started', 'hand');       // a desk, and no pid file

  const w = workerOf(f, 'feature/hand-started');
  assert.equal(w.state, 'none', 'a worktree is here and no pid was recorded in it');
  assert.notEqual(w.state, 'elsewhere', 'looking and finding nothing is not having nowhere to look');
  f.cleanup();
});

test('fleet: a LIVE pid reads running, and the pid travels', () => {
  // The regression that matters most: a check that reads every claim as
  // unstarted is indistinguishable from a broken fleet.
  const f = makeRepo('plot-worker-running-', ONE_WAVE('feature/live'));
  claim(f, 'feature/live');
  const wt = addWorktree(f, 'feature/live', 'live');
  // A real process, because `kill -0` is a real syscall and a fabricated pid
  // would make this test agree with a broken implementation by luck.
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  try {
    writeWorker(wt, child.pid);
    const w = workerOf(f, 'feature/live');
    assert.equal(w.state, 'running');
    assert.equal(w.pid, String(child.pid), 'the pid travels rather than being re-derived');
  } finally {
    child.kill('SIGKILL');
  }
  f.cleanup();
});

test('fleet: a pid of 0 is NEVER running — kill -0 0 signals the whole group', () => {
  // The trap in miniature, and the reason the value must survive the trip rather
  // than being re-derived on the far side. `kill -0 0` signals the entire process
  // GROUP and succeeds, so pid 0 read naively is alive forever — and 0 is what an
  // empty or truncated pid file yields under a lazy parse.
  //
  // Asserted as `none`, not merely as "not running": rejecting it must land on
  // the honest answer (no pid was recorded), not on a fourth thing.
  const f = makeRepo('plot-worker-pid0-', ONE_WAVE('feature/pid-zero'));
  claim(f, 'feature/pid-zero');
  const wt = addWorktree(f, 'feature/pid-zero', 'pidzero');
  writeWorker(wt, 0);

  const w = workerOf(f, 'feature/pid-zero');
  assert.equal(w.state, 'none', 'pid 0 is never a real worker');
  assert.notEqual(w.state, 'running');
  f.cleanup();
});

test('fleet: a NON-NUMERIC pid is rejected the same way', () => {
  // The other shape of a corrupt record. `kill -0 ""` and `kill -0 abc` are not
  // liveness answers, and treating a parse failure as one would be the pid-0 bug
  // wearing a different value.
  const f = makeRepo('plot-worker-pidjunk-', ONE_WAVE('feature/pid-junk'));
  claim(f, 'feature/pid-junk');
  const wt = addWorktree(f, 'feature/pid-junk', 'pidjunk');
  writeWorker(wt, 'not-a-pid');

  assert.equal(workerOf(f, 'feature/pid-junk').state, 'none');
  f.cleanup();
});

test('fleet: a dead pid with exit 0 is `finished`, with a code is `failed`', () => {
  // THE distinction this change exists for. `failed` and `finished` are opposite
  // actions — restart versus review — and one label over both sends the reader to
  // a log to find out which.
  //
  // A pid that is dead for certain: a child is spawned and reaped, so the number
  // named a real process and now names none. Picking an arbitrary high integer
  // would risk collision with a live pid and make this flaky.
  const f = makeRepo('plot-worker-done-', ONE_WAVE('feature/stopped'));
  claim(f, 'feature/stopped');
  const wt = addWorktree(f, 'feature/stopped', 'stopped');
  const deadPid = execFileSync('bash', ['-c', 'sleep 0 & echo $!; wait'], { encoding: 'utf8' }).trim();

  writeWorker(wt, deadPid, 0);
  const ok = workerOf(f, 'feature/stopped');
  assert.equal(ok.state, 'finished');
  assert.equal(ok.exit, '0');

  writeWorker(wt, deadPid, 137);
  const bad = workerOf(f, 'feature/stopped');
  assert.equal(bad.state, 'failed');
  assert.equal(bad.exit, '137', 'the code travels, so the row can say HOW it died');
  assert.notEqual(bad.state, ok.state, 'restart and review must not share a label');
  f.cleanup();
});

test('fleet: a dead pid with NO exit file is `ended`, never `finished`', () => {
  // Read the exit code, not the emptiness. Guessing success from an absent record
  // is the same mistake in the other direction — and `finished` is the one answer
  // that tells a reader to stop looking.
  const f = makeRepo('plot-worker-ended-', ONE_WAVE('feature/vanished'));
  claim(f, 'feature/vanished');
  const wt = addWorktree(f, 'feature/vanished', 'vanished');
  const deadPid = execFileSync('bash', ['-c', 'sleep 0 & echo $!; wait'], { encoding: 'utf8' }).trim();
  writeWorker(wt, deadPid);                 // pid, and deliberately no exit file

  const w = workerOf(f, 'feature/vanished');
  assert.equal(w.state, 'ended', 'unknown is its own answer');
  assert.equal(w.exit, '', 'and it carries no code, because none was recorded');
  f.cleanup();
});

test('fleet: an UNREADABLE exit code is `ended`, not `failed`', () => {
  // An exit file that exists but says nothing usable. `worker_state()` answers
  // `ended (status unknown)` for the empty case, and a garbage value is the same
  // statement: the status was not recorded. Reading it as `failed` would invent a
  // crash, and as `finished` would invent a success.
  const f = makeRepo('plot-worker-badexit-', ONE_WAVE('feature/garbled'));
  claim(f, 'feature/garbled');
  const wt = addWorktree(f, 'feature/garbled', 'garbled');
  const deadPid = execFileSync('bash', ['-c', 'sleep 0 & echo $!; wait'], { encoding: 'utf8' }).trim();
  writeWorker(wt, deadPid, '');

  assert.equal(workerOf(f, 'feature/garbled').state, 'ended');
  f.cleanup();
});

test('fleet: the worker read makes no host call, and leaves the prose untouched', () => {
  // Two invariants in one fixture. The scan is git-only on its default path —
  // that is what lets the board poll it every 5 s — and the human report is a
  // human interface: the worker fact belongs to the JSON and the row it feeds.
  const f = makeRepo('plot-worker-quiet-', ONE_WAVE('feature/silent'));
  claim(f, 'feature/silent');
  const wt = addWorktree(f, 'feature/silent', 'silent');
  writeWorker(wt, 0);

  const shim = path.join(f.root, 'bin');
  fs.mkdirSync(shim, { recursive: true });
  const log = path.join(f.root, 'host-calls.log');
  for (const cli of ['gh', 'bb']) {
    fs.writeFileSync(path.join(shim, cli),
      `#!/bin/sh\necho "${cli} $*" >> ${JSON.stringify(log)}\nexit 1\n`);
    fs.chmodSync(path.join(shim, cli), 0o755);
  }

  const out = f.run([], { PATH: `${shim}:${process.env.PATH}` });
  assert.ok(!fs.existsSync(log), 'the worker read must make no host call');
  assert.match(branchLine(out, 'feature/silent'), / — claimed$/,
    'the prose report is unchanged — the worker fact travels in --json only');
  f.cleanup();
});

// --- the scan asks once, not once per branch --------------------------------
//
// Measured against bitbucket.org/quatico/ekzweb on 2026-08-18 (issue #228): 14
// branches cost 39 `bb` calls and the scan did not finish inside 110 s. And on
// THIS repo, on GitHub, the same day: 84 branches x 438 ms of `pr-state` = 34 s,
// past the board's own 30 s timeout (`fleet.ts:260`), so the board served a
// pulse 644 s old while reporting `Command failed`.
//
// The shape is the defect: `host_pr_state` resolved state PER BRANCH, so the
// cost scaled with the branch count. One `pr-list` answers all of them.
//
// These tests count invocations of a stubbed host rather than timing anything —
// a timing assertion on CI is a flake, and the count is the actual claim.

// A plan with `n` branches, all of them PUSHED and in flight.
//
// THE FIXTURE IS THE ASSERTION HERE. Two costs scale differently and only one
// of them is this defect:
//
//   * the JOIN's cost must be flat in the branch count — that is the fix;
//   * PR #216's no-ref lookup is bounded by ABSENT branches, and must survive.
//
// A fixture of never-started branches cannot tell those apart: every branch
// takes the no-ref arm, so the count rises for the legitimate reason and the
// test would demand the removal of #216. Pushing every branch holds the absent
// count at ZERO, so anything that still scales is the loop this change removes.
const N_WAVE = (n, prefix = 'feature/b') =>
  '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
  Array.from({ length: n }, (_, i) => `- \`${prefix}${i}\` — the work\n`).join('');

// Build the repo AND push every branch, so none takes the no-ref arm.
function makeInFlightRepo(prefix, n) {
  const f = makeRepo(prefix, N_WAVE(n));
  for (let i = 0; i < n; i++) {
    f.work(`feature/b${i}`, `f${i}.txt`);
    f.push('-u', 'origin', `feature/b${i}`);
  }
  git(f.dir, 'checkout', '-q', 'main');
  return f;
}

// Counts every host invocation by op, so a growth in ANY op is caught rather
// than only the one this fix happened to look at.
const COUNTING_HOST = `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state) echo '{"number":0,"state":"NONE","draft":false,"url":""}' ;;
  pr-list) : ;;
  *) echo "{}" ;;
esac
`;

function countCalls(f, host = COUNTING_HOST, args = ['p']) {
  const h = hostShim(host);
  const calls = path.join(h.dir, 'calls.txt');
  const out = execFileSync('bash', [h.scan, ...args], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PLOT_TEST_CALLS: calls },
  });
  const ops = fs.existsSync(calls)
    ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
  h.cleanup();
  return { out, ops, total: ops.length };
}

test('fleet: host calls do not grow with the branch count', () => {
  // THE MEASURED FAILURE, reproduced as a count. Against the unchanged script
  // this fails — verified by stashing the fix: 6 in-flight branches cost 6
  // `pr-state` calls and 14 cost 14, so the difference IS the branch count and
  // the assertion below reads `8 !== 0`.
  //
  // Two sizes of the SAME plan shape, every branch pushed. What is asserted is
  // not an absolute budget — that would pin an implementation detail — but that
  // the two sizes cost the SAME, which is what "constant" means and what the
  // defect broke.
  const small = makeInFlightRepo('plot-fleet-join-small-', 6);
  const large = makeInFlightRepo('plot-fleet-join-large-', 14);

  const s = countCalls(small);
  const l = countCalls(large);

  assert.equal(l.total - s.total, 0,
    `host calls must not scale with branches: 6 branches cost ${s.total} ` +
    `(${s.ops.join(',')}), 14 cost ${l.total} (${l.ops.join(',')})`);

  small.cleanup();
  large.cleanup();
});

// A plan naming `n` branches that NOBODY HAS STARTED — no ref, no PR.
//
// THE POPULATION THE JOIN CANNOT SERVE, and the one that was costing a round
// trip per branch per scan. `makeInFlightRepo` pushes every branch precisely so
// none takes the no-ref arm; this fixture is its complement, and the two
// together separate the join's flat cost from the no-ref arm's.
//
// Measured on the plot repo 2026-08-23: 28 of 29 host calls in one scan were
// for branches in exactly this state — named by an approved plan, never
// started. Each asked the host to re-learn `NONE`, on every scan, forever.
function makeUnstartedRepo(prefix, n) {
  return makeRepo(prefix, N_WAVE(n));
}

// A host whose `pr-list` ANSWERS. The stub above emits nothing for `pr-list`,
// which is the DEGRADED path — no list, so every branch must still be asked.
// Deriving absence is licensed only by a list that arrived complete, so a test
// of the derivation needs a host that supplies one.
//
// It returns one unrelated PR: enough for the list to be non-empty and well
// under any limit, so it reads as COMPLETE, while naming none of the fixture's
// branches — which is the case under test, a branch the complete list omits.
const LISTING_HOST = `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state) echo '{"number":0,"state":"NONE","draft":false,"url":""}' ;;
  pr-list) echo '{"number":1,"title":"unrelated","state":"MERGED","head":"other/branch"}' ;;
  *) echo "{}" ;;
esac
`;

test('fleet: a resurrected ref does not hide a merge', () => {
  // THE MEASURED FAILURE, reproduced. `delete_branch_on_merge` removes the ref
  // at merge; a worktree still holding the branch can push it back afterwards,
  // which a fleet does routinely. The ref exists again while the work sits on
  // main under a DIFFERENT commit, because a squash merge rewrites it.
  //
  // The local walk then sees commits main lacks — the pre-squash originals —
  // and calls finished work `wip`. Measured 2026-08-23:
  // `bug/done-holds-finished-plans-only` (PR #356, merged) read `wip` for three
  // hours and its wave never completed.
  //
  // ASSERTED AS `merged`, NOT MERELY "NOT wip". `wip` is the worst wrong
  // answer — it claims an agent is working here — but `open` and `claimed` are
  // wrong too, and a test that only forbids `wip` passes an implementation that
  // swaps one wrong verdict for another.
  const f = makeRepo('plot-fleet-resurrected-', N_WAVE(1));
  // Work on the branch, pushed — the ref exists.
  f.work('feature/b0', 'w.txt');
  f.push('-u', 'origin', 'feature/b0');
  git(f.dir, 'checkout', '-q', 'main');
  // The SQUASH: main gains equivalent content under its own commit, so the
  // branch's commits stay unreachable from main and the walk finds no evidence.
  fs.writeFileSync(path.join(f.dir, 'w.txt'), 'squashed\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'squashed work (#1)');
  git(f.dir, 'push', '-q', 'origin', 'main');

  // The host is the only witness that the PR merged.
  const MERGED_HOST = `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state) echo '{"number":1,"state":"MERGED","draft":false,"url":"x"}' ;;
  pr-list) echo '{"number":1,"title":"w","state":"MERGED","head":"feature/b0"}' ;;
  *) echo "{}" ;;
esac
`;
  const { out, ops } = countCalls(f, MERGED_HOST, ['--json', 'p']);
  assert.match(out, /"state":"merged"/,
    `a branch whose PR the list reports MERGED must read merged, not wip: ${out}`);
  // And it must stay free: the join already holds the answer.
  assert.equal(ops.filter((o) => o === 'pr-state').length, 0,
    `the has-ref arm must read the cache, not the host: ${ops.join(',')}`);

  f.cleanup();
});

test('fleet: real work in flight is still wip', () => {
  // THE OTHER DIRECTION, and the one the fix above could break. A branch with
  // an OPEN PR and commits main lacks is genuinely in flight; only `MERGED` may
  // override the local walk, and only toward `merged`.
  const f = makeRepo('plot-fleet-still-wip-', N_WAVE(1));
  f.work('feature/b0', 'w.txt');
  f.push('-u', 'origin', 'feature/b0');
  git(f.dir, 'checkout', '-q', 'main');

  const OPEN_HOST = `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state) echo '{"number":1,"state":"OPEN","draft":false,"url":"x"}' ;;
  pr-list) echo '{"number":1,"title":"w","state":"OPEN","head":"feature/b0"}' ;;
  *) echo "{}" ;;
esac
`;
  const { out } = countCalls(f, OPEN_HOST, ['--json', 'p']);
  assert.match(out, /"state":"wip"/,
    `an OPEN PR over unlanded commits is still wip: ${out}`);

  f.cleanup();
});

test('fleet: an arrived list answers for the branches it omits', () => {
  // THE DEFECT, as a count. A plan's unstarted branches have no ref and no PR,
  // so the join cannot serve them — and before this fix each one asked the host
  // to confirm it still had no PR, every scan.
  //
  // Asserted as ZERO `pr-state` calls rather than as "fewer than before": an
  // implementation that merely cached the answer WITHIN a scan would reduce the
  // count without removing the round trip, and would pass a comparative test
  // while leaving the per-pulse cost exactly where it was.
  const f = makeUnstartedRepo('plot-fleet-unstarted-', 8);
  const { ops } = countCalls(f, LISTING_HOST);
  const asked = ops.filter((o) => o === 'pr-state').length;
  const listed = ops.filter((o) => o === 'pr-list').length;

  assert.equal(asked, 0,
    `a complete list answers for every branch it omits; got ${asked} ` +
    `pr-state calls (${ops.join(',')})`);
  assert.equal(listed, 1, `exactly one pr-list per scan; got ${listed}`);

  f.cleanup();
});

test('fleet: without a list, every branch is still asked', () => {
  // THE FAILURE DIRECTION, and the half an optimisation breaks first. Absent is
  // not false: a scan whose `pr-list` returned nothing has NOT established that
  // these branches lack PRs, and reporting them as such would render a whole
  // fleet as unstarted during an outage.
  //
  // `COUNTING_HOST` emits nothing for `pr-list`, so no completeness marker is
  // written and the derivation must not fire.
  const f = makeUnstartedRepo('plot-fleet-nolist-', 8);
  const { ops } = countCalls(f);
  const asked = ops.filter((o) => o === 'pr-state').length;

  assert.ok(asked > 0,
    `an absent list must fall through to asking, not derive absence; ` +
    `got ${asked} pr-state calls (${ops.join(',')})`);

  f.cleanup();
});

test('fleet: PLOT_SCAN_ASK_ALWAYS restores the host call', () => {
  // THE WAY BACK. The switch may only ever restore asking, never suppress it,
  // so an operator watching a wave that will not complete can have the old
  // behaviour on the next scan without a rebuild.
  const f = makeUnstartedRepo('plot-fleet-askalways-', 8);
  const h = hostShim(LISTING_HOST);
  const calls = path.join(h.dir, 'calls.txt');
  execFileSync('bash', [h.scan, 'p'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PLOT_TEST_CALLS: calls, PLOT_SCAN_ASK_ALWAYS: '1' },
  });
  const ops = fs.existsSync(calls)
    ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
  h.cleanup();

  assert.ok(ops.filter((o) => o === 'pr-state').length > 0,
    `PLOT_SCAN_ASK_ALWAYS=1 must restore the per-branch call; got ${ops.join(',')}`);

  f.cleanup();
});

// Count GIT spawns, not host calls. A shim earlier on PATH than the real git
// records every invocation's subcommand and execs through, so the number is the
// process count the scan actually pays for.
function countGitSpawns(f, args = ['--json']) {
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gitshim-'));
  const log = path.join(shim, 'git.txt');
  const realGit = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(shim, 'git'),
    `#!/bin/bash\nprintf '%s\\n' "$1" >> ${JSON.stringify(log)}\nexec ${realGit} "$@"\n`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);
  try {
    execFileSync('bash', [scan, ...args], {
      encoding: 'utf8', cwd: f.dir,
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
    });
  } catch { /* a non-zero exit still leaves a count worth reading */ }
  const ops = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  fs.rmSync(shim, { recursive: true, force: true });
  return { ops, total: ops.length, count: (sub) => ops.filter((o) => o === sub).length };
}

test('fleet: the batched git reads stay constant as branches grow', () => {
  // THE MEASUREMENT THIS PINS, taken on the plot repo 2026-08-20 with exactly
  // this shim: 459 git spawns for one scan of 54 branches, at 56 ms of PROCESS
  // LAUNCH each — roughly 24 s before git did any work. Four earlier rounds of
  // optimisation had all aimed at the HOST, which by then was one `pr-list`.
  //
  // Three questions were asked once PER PLAN or PER BRANCH and each had a
  // batched form. Those three are what this test holds, and the numbers below
  // are what the same shim measured at 6 and 14 branches AFTER the change:
  //
  //   `show-ref --verify`  59 → 1   one `for-each-ref`      1 → 1
  //   plan modes           69 → 1   one `ls-tree -r`        2 → 2
  //   plan content         68 → 1   one `cat-file --batch`  1 → 1
  //
  // On the real repo that took the scan from 279 s to 43 s, because the plan
  // reads dominated: one `git show` of a plan blob cost 407-621 ms and there
  // were 68 of them, ~31 s in a single call site against a 30 s budget.
  //
  // WHAT THIS TEST DELIBERATELY DOES NOT CLAIM. A per-branch tail remains and
  // is untouched by the ref/tree/plan batching — measured at 6 vs 14 branches:
  //
  //   diff 12 → 28   rev-list 12 → 28   merge-tree 6 → 14   log 7 → 15
  //
  // `merge-base` was in this list (6 → 14) until the-scan-walks-history-in-one-call
  // removed it: `branch_state` asked `merge-base --is-ancestor` per `wip` branch
  // to re-derive a fact the `ahead` count already held — a branch `ahead > 0`
  // cannot be an ancestor of main — so the call fired once per branch and could
  // never change a verdict. It is now asserted CONSTANT below alongside the
  // batched reads, because "0 → 0" is the shape a reintroduction would break.
  //
  // Six spawns per branch remain, linear in the branch count. They are
  // individually cheap — removing 251 expensive calls bought 236 s while these
  // on the real repo cost almost seconds — so the tail is survivable, and it is
  // the NEXT ceiling rather than this one. An earlier version of this test
  // asserted "at most one new spawn per branch" and failed against its own fix,
  // because it asserted a change nobody had made. The bound below is measured.
  const small = makeInFlightRepo('plot-fleet-spawn-small-', 6);
  const large = makeInFlightRepo('plot-fleet-spawn-large-', 14);

  const s = countGitSpawns(small);
  const l = countGitSpawns(large);

  const subs = [...new Set([...s.ops, ...l.ops])].sort();
  const deltas = subs.map((x) => `${x}:${s.count(x)}→${l.count(x)}`).join(' ');

  // THE INVARIANT: these reads are asked a FIXED number of times whatever the
  // branch count. Each regressing to per-branch is the specific defect this
  // change removed, and the one a future refactor could reintroduce with every
  // verdict still correct and nothing but the clock to report it. `merge-base`
  // joins the batched reads not because it was batched but because it was
  // DELETED: it must stay constant (0 → 0) the way they stay batched, and a
  // reappearing per-`wip`-branch `merge-base` is exactly the regression the
  // removal guards against.
  for (const sub of ['for-each-ref', 'show-ref', 'ls-tree', 'show', 'cat-file',
                     'merge-base']) {
    assert.equal(l.count(sub), s.count(sub),
      `\`git ${sub}\` must cost the same at 6 and 14 branches.\n` +
      `deltas: ${deltas}`);
  }

  // AND THE TAIL STAYS A TAIL. Not zero, and not asserted as zero: the bound is
  // the seven per branch measured above, with one spare so an unrelated
  // single-call addition does not fail this. A tenth per-branch call would.
  const extra = l.total - s.total;
  assert.ok(extra <= 8 * 8,
    `the per-branch tail must not grow beyond ~8 spawns per branch: ` +
    `6 branches cost ${s.total}, 14 cost ${l.total} (+${extra})\ndeltas: ${deltas}`);

  small.cleanup();
  large.cleanup();
});

test('fleet: a failed list reads as failure, never as "no PR"', () => {
  // The 2026-08-17 trap in a new shape. `plot-host.sh` separates a lookup miss
  // (exit 0, state NONE) from a transport failure (non-zero), and the join must
  // keep that separation: a list that NEVER ARRIVED and a list with NOTHING IN
  // IT are different facts.
  //
  // The branch here was squash-merged and its ref deleted, so it takes the
  // no-ref arm. With a list that FAILED, the scan may not conclude "no PR" and
  // must fall through to `open` — the safe direction, unchanged from before the
  // join existed. Concluding `merged` or settling the wave would be the
  // fabricated verdict; concluding a confident "no PR" is the same lie quieter.
  const f = makeRepo('plot-fleet-joinfail-', ONE_WAVE('feature/squashed'));
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 42);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  // The list fails the way a 503 does: non-zero, nothing on stdout. The
  // per-branch lookup still answers MERGED, and that answer must survive — a
  // failed LIST must not suppress the no-ref lookup that #216 put there.
  const { out } = countCalls(f, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) exit 1 ;;
  pr-state) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  assert.match(branchLine(out, 'feature/squashed'), / — merged$/,
    'a failed list must not suppress the no-ref lookup that answers');
  f.cleanup();
});

test('fleet: an empty list is not a failed list', () => {
  // The other half of the same distinction. Here the list ARRIVES and is empty
  // — real evidence that the repo has no PRs — while the per-branch lookup is
  // never consulted for a branch that HAS a ref. The branch must read from its
  // local state rather than inheriting a fabricated verdict either way.
  const f = makeRepo('plot-fleet-joinempty-', ONE_WAVE('feature/inflight'));
  f.work('feature/inflight', 'a.txt');
  f.push('-u', 'origin', 'feature/inflight');
  git(f.dir, 'checkout', '-q', 'main');

  const { out, ops } = countCalls(f, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) : ;;
  pr-state) echo '{"number":0,"state":"NONE","draft":false,"url":""}' ;;
  *) echo "{}" ;;
esac
`);
  assert.match(branchLine(out, 'feature/inflight'), / — in progress$/,
    'an empty list that arrived is evidence, and the local state answers');
  assert.equal(ops.filter((o) => o === 'pr-state').length, 0,
    'a branch with a ref must not cost a per-branch lookup');
  f.cleanup();
});

test('fleet: the no-ref lookup is bounded by absent branches, not by all', () => {
  // THE OTHER SIDE OF THE SAME COIN, and the reason the test above pushes every
  // branch. PR #216's per-branch lookup must SURVIVE this change: it asks about
  // a branch with no ref, which a repo-wide list may legitimately not contain
  // because its PR was never opened. Deleting it to make a call-count go down
  // would trade this defect for that one.
  //
  // So the cost is bounded by ABSENT branches. Here 2 of 8 are absent, and the
  // count must follow the 2 rather than the 8.
  const f = makeRepo('plot-fleet-joinbound-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    Array.from({ length: 8 }, (_, i) => `- \`feature/b${i}\` — the work\n`).join(''));
  for (let i = 0; i < 6; i++) {
    f.work(`feature/b${i}`, `f${i}.txt`);
    f.push('-u', 'origin', `feature/b${i}`);
  }
  git(f.dir, 'checkout', '-q', 'main');

  const { ops } = countCalls(f);
  const asked = ops.filter((o) => o === 'pr-state').length;
  assert.equal(asked, 2,
    `only the 2 branches with no ref may be asked about individually, saw ${asked}`);
  assert.equal(ops.filter((o) => o === 'pr-list').length, 1,
    'the other 6 are answered by exactly one list');
  f.cleanup();
});

test('fleet: a merged-and-deleted branch the list names costs no lookup', () => {
  // THE THIRD SIDE OF THE COIN, and the one the other two leave unpinned.
  //
  // Both tests above stub `pr-list` to emit NOTHING, so they establish what a
  // no-ref branch costs when the join cannot answer for it. Neither establishes
  // what it costs when the join CAN — and that is the case the fleet actually
  // spends its life in: a repo merging with `--delete-branch` turns every
  // finished branch into a no-ref branch, and `pr list --state all` keeps
  // returning its PR long after the ref is gone.
  //
  // Verified against this repo on 2026-08-20: PRs #252, #253 and #254 all
  // appear in the list as MERGED while `git ls-remote --heads` returns 0 refs
  // for each, and a counting wrapper around `gh` recorded ZERO `pr view` calls
  // for all three.
  //
  // THE ORDERING IS LOAD-BEARING AND OTHERWISE UNDOCUMENTED, which is the whole
  // reason this test exists when nothing else changes. `merged_by_host` passes
  // `--ask` unconditionally, so this costs nothing only because
  // `host_pr_state` consults the per-branch cache BEFORE it reaches the `--ask`
  // arm. Nothing states that dependency; the two blocks are simply adjacent.
  //
  // WHAT A REORDERING COSTS. Read the cache only on the no-ask path — or hoist
  // the ask above it — and every terminal branch pays one host call per branch
  // PER PULSE again. Measured on this repo 2026-08-20: 15 such calls, and the
  // board pulses every 5 s.
  //
  //   GitHub     461 ms x 15  =  6.9 s per pulse
  //   Bitbucket  ~10 s  x 15  =  ~150 s per pulse — five times the 30 s budget
  //
  // AND EVERY ANSWER STAYS CORRECT. The verdicts do not change, so no other
  // test fails, no rendered line differs, and nothing but the clock reports it.
  //
  // The reordering is also a PLAUSIBLE REFACTOR rather than a contrived break:
  // "only consult the cache when we are not asking" reads like a tidy-up to
  // anyone who has not measured it. A regression that looks like an improvement
  // in review is exactly the kind a counted assertion has to catch.
  //
  // Counted rather than timed, for the reason the block above says: a timing
  // assertion on CI is a flake and the count is the actual claim.
  const f = makeRepo('plot-fleet-joincarries-', ONE_WAVE('feature/squashed'));
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 42);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  // The list ARRIVES and NAMES the branch — the difference from every other
  // count test here. `pr-state` still answers MERGED, so the rendered verdict
  // cannot distinguish a cache hit from a round trip; only the count can.
  const { out, ops } = countCalls(f, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) echo '{"number":42,"title":"the work","state":"MERGED","head":"feature/squashed"}' ;;
  pr-state) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  assert.equal(ops.filter((o) => o === 'pr-state').length, 0,
    'a no-ref branch the list already names must not be asked about again');
  assert.equal(ops.filter((o) => o === 'pr-list').length, 1,
    'one list answers it');
  // The saving must not have cost the answer. A count that fell to zero because
  // the branch stopped reading `merged` would settle nothing and block its
  // successor wave forever — the defect the no-ref arm exists to fix.
  assert.match(branchLine(out, 'feature/squashed'), / — merged$/,
    'answered from the join, and answered correctly');
  assert.match(waveLine(out, 'One'), / — complete$/,
    'the wave completes on the joined answer, as it does on a fetched one');
  f.cleanup();
});

test('fleet: a failed list does not answer for branches the join never covered', () => {
  // THE 2026-08-17 TRAP, IN THE SHAPE THE JOIN GIVES IT. The scan must keep
  // `plot-host.sh`'s distinction between a lookup MISS (exit 0, state NONE) and
  // a TRANSPORT FAILURE (non-zero). A join makes that distinction easy to lose,
  // because both arrive as "this branch is not in my table".
  //
  // Here the list FAILS and the branch has a ref, so nothing may be concluded
  // about its PR at all. `worker_of` asks `reached_review`, whose contract is
  // that an unanswerable host falls through to the LOCAL signals rather than
  // manufacturing the state that tells a reader to stop looking.
  //
  // The assertion is on the call count rather than on a rendered word: with the
  // list failed there is no cached answer, and the branch must NOT be rescued
  // by a per-branch lookup — that would silently restore the N-call loop on
  // exactly the day the host is unwell and can least afford it.
  const f = makeRepo('plot-fleet-joinfail2-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    Array.from({ length: 8 }, (_, i) => `- \`feature/b${i}\` — the work\n`).join(''));
  for (let i = 0; i < 8; i++) {
    f.work(`feature/b${i}`, `f${i}.txt`);
    f.push('-u', 'origin', `feature/b${i}`);
  }
  git(f.dir, 'checkout', '-q', 'main');

  const { ops } = countCalls(f, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) exit 1 ;;
  pr-state) echo '{"number":0,"state":"NONE","draft":false,"url":""}' ;;
  *) echo "{}" ;;
esac
`);
  assert.equal(ops.filter((o) => o === 'pr-state').length, 0,
    'a failed list must not fall back to one lookup per branch');
  assert.equal(ops.filter((o) => o === 'pr-list').length, 1,
    'the list is attempted exactly once, even when it fails');
  f.cleanup();
});

// --- changed_ago_seconds: when did this branch last CHANGE? ------------------
//
// `local_ahead` and `local_dirty` are STATE, not CHANGE. Measured 2026-08-18
// across four concurrent workers: the branch that had just opened the session's
// hardest PR read `ahead=0 dirty=False`, bit-identical to a branch claimed a
// minute earlier and abandoned. Runtime could not separate them either — the
// LONGEST-RUNNING worker was the most productive, so an operator watching the
// clock would have restarted exactly the wrong one.
//
// These tests hold four properties, and the last two are the ones a plausible
// regression breaks quietly:
//
//   1. a worktree touched now reports ~0, and one untouched for an hour that hour
//   2. a branch with NO worktree reports null — never a fabricated 0
//   3. an editor leftover (`.tmp1`) does NOT reset the clock
//   4. branches with no worktree cost nothing extra (no fork at all)
//
// It is a MEASUREMENT AND NOT A VERDICT: no threshold lives here, and none may
// be added. A worker inside a serial test suite writes nothing for minutes
// while its child processes work, so "quiet" rendered as "stuck" restarts a
// healthy worker mid-suite. Read
// docs/plans/2026-08-18-the-pulse-measures-progress-not-elapsed-time.md before
// changing any of it.

/** The branch's row from a --json run. */
function branchRow(f, branch) {
  const doc = JSON.parse(f.run(['--json']));
  return doc.plans[0].waves[0].branches.find((x) => x.branch === branch);
}

test('changed_ago: a worktree touched a second ago reports near zero', () => {
  const f = makeRepo('plot-fleet-chg-now-', ONE_WAVE('feature/fresh'));
  f.work('feature/fresh', 'w.txt');
  f.push('-u', 'origin', 'feature/fresh');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/fresh', 'fresh');

  // THE COMMIT IS BACKDATED so the edit is the ONLY thing that can answer
  // "now". Measured by mutation while writing this: with a fresh commit the
  // test passed even when the dirty-file mtimes were ignored entirely — the
  // commit source alone carried it. Three sources feeding one maximum means a
  // test that does not isolate its source can pass on another source's
  // strength, and then hold nothing.
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  execFileSync('git', ['commit', '-q', '--amend', '--no-edit'], {
    cwd: wt,
    env: { ...process.env,
      GIT_COMMITTER_DATE: hourAgo.toISOString(),
      GIT_AUTHOR_DATE: hourAgo.toISOString() },
  });
  fs.writeFileSync(path.join(wt, 'w.txt'), 'edited just now\n');

  const b = branchRow(f, 'feature/fresh');
  assert.equal(typeof b.changed_ago_seconds, 'number',
    'a worktree this machine can see must yield a number');
  assert.ok(b.changed_ago_seconds >= 0 && b.changed_ago_seconds < 120,
    `a file written seconds ago must read as recent, got ${b.changed_ago_seconds}`);
  f.cleanup();
});

test('changed_ago: a worktree untouched for an hour reports that hour', () => {
  // The other end of the range, and the one that matters: a number that only
  // ever reads "just now" would pass the test above and carry no signal at all.
  // Both the commit and the dirty file are backdated, since the answer is the
  // MAXIMUM over every source — leaving either at "now" would mask the other.
  const f = makeRepo('plot-fleet-chg-old-', ONE_WAVE('feature/quiet'));
  f.work('feature/quiet', 'q.txt');
  f.push('-u', 'origin', 'feature/quiet');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/quiet', 'quiet');

  const hourAgo = new Date(Date.now() - 3600 * 1000);
  // A dirty file, backdated. `utimes` moves mtime without touching content, so
  // git still reports the file as modified.
  fs.writeFileSync(path.join(wt, 'q.txt'), 'edited an hour ago\n');
  fs.utimesSync(path.join(wt, 'q.txt'), hourAgo, hourAgo);
  // And the commit, so `git log -1 --format=%ct` cannot answer "now" instead.
  // `GIT_COMMITTER_DATE` is the one that matters — the field reads `%ct`, since
  // a rebase or amend rewrites the committer date and leaves the author date at
  // the original writing, and it is the rewrite that is the evidence of work.
  execFileSync('git', ['commit', '-q', '--amend', '--no-edit'], {
    cwd: wt,
    env: { ...process.env,
      GIT_COMMITTER_DATE: hourAgo.toISOString(),
      GIT_AUTHOR_DATE: hourAgo.toISOString() },
  });
  // Amending re-checks out the file, which freshens its mtime. Backdate again.
  fs.writeFileSync(path.join(wt, 'q.txt'), 'edited an hour ago\n');
  fs.utimesSync(path.join(wt, 'q.txt'), hourAgo, hourAgo);

  const b = branchRow(f, 'feature/quiet');
  assert.ok(b.changed_ago_seconds > 3000,
    `an hour of silence must read as roughly an hour, got ${b.changed_ago_seconds}`);
  assert.ok(b.changed_ago_seconds < 7200,
    `and must not run away from it, got ${b.changed_ago_seconds}`);
  f.cleanup();
});

test('changed_ago: a branch with no worktree reports absent, NEVER zero', () => {
  // The fabrication this field must not make. Every other local signal has an
  // absent value that is also a real value — `false` and `0` are what an
  // unobserved branch honestly reports. Seconds have no such value: 0 means
  // "changed this instant", the most reassuring answer available, and handing
  // it to every branch on somebody else's machine would point the wrong way.
  const f = makeRepo('plot-fleet-chg-abs-', ONE_WAVE('feature/elsewhere'));
  f.work('feature/elsewhere', 'e.txt');
  f.push('-u', 'origin', 'feature/elsewhere');
  git(f.dir, 'checkout', '-q', 'main');

  const b = branchRow(f, 'feature/elsewhere');
  assert.equal(b.changed_ago_seconds, null,
    'absent is absent — null, never a fabricated 0');
  assert.notEqual(b.changed_ago_seconds, 0,
    'a 0 here would read as "changed just now" for a branch nobody can see');
  // And the change stays ADDITIVE: the refs answer is untouched.
  assert.equal(b.state, 'wip');
  assert.equal(b.local_worktree, '');
  f.cleanup();
});

test('changed_ago: a .tmp1 written now does NOT reset the clock', () => {
  // Measured 2026-08-18: an orphaned `plot-dispatch.sh.tmp1` — belonging to no
  // commit and no task — read as uncommitted work and got a healthy branch
  // restarted. It must not read as evidence of work here either, and the
  // exclusion is SHARED with `plot_worker_dirty` rather than copied: one file
  // answering two questions two ways is the defect this scan keeps removing.
  const f = makeRepo('plot-fleet-chg-tmp-', ONE_WAVE('feature/leftover'));
  f.work('feature/leftover', 'l.txt');
  f.push('-u', 'origin', 'feature/leftover');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/leftover', 'leftover');

  // Everything real is old: the commit is backdated and the tree is otherwise
  // clean, so the ONLY fresh thing in the worktree is the leftover.
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  execFileSync('git', ['commit', '-q', '--amend', '--no-edit'], {
    cwd: wt,
    env: { ...process.env,
      GIT_COMMITTER_DATE: hourAgo.toISOString(),
      GIT_AUTHOR_DATE: hourAgo.toISOString() },
  });
  for (const leftover of ['scratch.tmp1', 'x.swp', 'y.orig', 'z.rej', 'w.bak']) {
    fs.writeFileSync(path.join(wt, leftover), 'editor droppings\n');
  }

  const b = branchRow(f, 'feature/leftover');
  assert.ok(b.changed_ago_seconds > 3000,
    `editor leftovers are not work — the clock must still read ~an hour, got ${b.changed_ago_seconds}`);
  f.cleanup();
});

test('changed_ago: a REAL untracked file DOES reset the clock', () => {
  // The other side of the exclusion, and the reason it must stay narrow. A
  // rule broad enough to drop `.tmp1` and also drop `new-module.ts` would
  // delete the signal to remove the noise — and it would pass the test above.
  const f = makeRepo('plot-fleet-chg-real-', ONE_WAVE('feature/realwork'));
  f.work('feature/realwork', 'r.txt');
  f.push('-u', 'origin', 'feature/realwork');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/realwork', 'realwork');

  const hourAgo = new Date(Date.now() - 3600 * 1000);
  execFileSync('git', ['commit', '-q', '--amend', '--no-edit'], {
    cwd: wt,
    env: { ...process.env,
      GIT_COMMITTER_DATE: hourAgo.toISOString(),
      GIT_AUTHOR_DATE: hourAgo.toISOString() },
  });
  fs.writeFileSync(path.join(wt, 'new-module.ts'), 'export const x = 1;\n');

  const b = branchRow(f, 'feature/realwork');
  assert.ok(b.changed_ago_seconds < 120,
    `an untracked source file IS work and must reset the clock, got ${b.changed_ago_seconds}`);
  f.cleanup();
});

test('changed_ago: the worker log counts as evidence of work', () => {
  // The one source that moves while a build runs. A worker deep in a serial
  // test suite writes no tracked file for minutes while its child processes
  // work — the log is the only thing still speaking, and without it this field
  // would report a busy worker as maximally quiet.
  //
  // Note the deliberate asymmetry with `plot_worker_dirty`, which EXCLUDES
  // `.plot-worker.*`: that function asks what work is on the FLOOR, and Plot's
  // own records are not work. This asks when anything last MOVED. Two
  // questions, two right answers about one file.
  const f = makeRepo('plot-fleet-chg-log-', ONE_WAVE('feature/logged'));
  f.work('feature/logged', 'g.txt');
  f.push('-u', 'origin', 'feature/logged');
  git(f.dir, 'checkout', '-q', 'main');
  const wt = addWorktree(f, 'feature/logged', 'logged');

  const hourAgo = new Date(Date.now() - 3600 * 1000);
  execFileSync('git', ['commit', '-q', '--amend', '--no-edit'], {
    cwd: wt,
    env: { ...process.env,
      GIT_COMMITTER_DATE: hourAgo.toISOString(),
      GIT_AUTHOR_DATE: hourAgo.toISOString() },
  });
  // A clean tree with an old commit — every source silent but the log.
  fs.writeFileSync(path.join(wt, '.plot-worker.log'), 'running tests...\n');

  const b = branchRow(f, 'feature/logged');
  assert.ok(b.changed_ago_seconds !== null && b.changed_ago_seconds < 120,
    `a live worker log is evidence of work, got ${b.changed_ago_seconds}`);
  f.cleanup();
});

test('changed_ago: branches with no local worktree cost nothing extra', () => {
  // The plan's cost argument depends on this, so it is asserted by COUNT rather
  // than by timing — a call that is merely cheap today would pass a stopwatch.
  // A `git log` spent to learn "elsewhere" would be paid on every branch on
  // every teammate's machine, on every 5 s poll.
  //
  // This is also where the DEFERRED open point is pinned down. `git log -1
  // origin/<branch>` would catch a worker on another machine moving a ref, and
  // it is declined because the cost lands exactly on the population that must
  // stay free: a branch with no local worktree is the one whose remote ref
  // would be its ONLY source. If that is ever wanted, it belongs in a separate
  // field with its own absent value — not as a second meaning here. This test
  // fails if someone adds it silently.
  const f = makeRepo('plot-fleet-chg-cost-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    ['a', 'b', 'c'].map((n) => `- \`feature/${n}\` — work\n`).join(''));
  for (const n of ['a', 'b', 'c']) {
    f.work(`feature/${n}`, `${n}.txt`);
    f.push('-u', 'origin', `feature/${n}`);
  }
  git(f.dir, 'checkout', '-q', 'main');
  // No worktree for any of them: every branch is "elsewhere".

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gitshim-chg-'));
  const argvLog = path.join(shim, 'git.argv');
  const realGit = execFileSync('bash', ['-lc', 'command -v git'],
    { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(shim, 'git'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}
exec ${JSON.stringify(realGit)} "$@"
`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);

  execFileSync('bash', [scan, '--offline', '--json'], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
  });
  const calls = fs.readFileSync(argvLog, 'utf8').split('\n');
  // The timestamp read this field introduces, for a branch it must skip.
  const ctCalls = calls.filter((l) => l.includes('--format=%ct'));
  assert.equal(ctCalls.length, 0,
    `no worktree means no timestamp read; saw ${ctCalls.length}: ${ctCalls.join(' | ')}`);
  // And the deferred open point, asserted rather than merely written down.
  //
  // Scoped to `origin/<branch>`, NOT to any `origin/`: the scan already makes
  // ONE bundled `git log origin/<main> --merges` per run for the merge walk,
  // and a filter broad enough to catch that would fail on work this change
  // never touched. What must stay absent is a per-branch read of a REMOTE ref —
  // `git log -1 origin/feature/a` — which is the shape the open point proposes.
  const remoteLogs = calls.filter((l) =>
    /(^|\s)log\b/.test(l) && /origin\/feature\//.test(l));
  assert.equal(remoteLogs.length, 0,
    `the pushed branch is deliberately NOT covered — see the plan's open point; saw: ${remoteLogs.join(' | ')}`);

  fs.rmSync(shim, { recursive: true, force: true });
  f.cleanup();
});

test('changed_ago: the answer is a MEASUREMENT, never a verdict', () => {
  // The guard on the design decision itself. `plot-worker-state.sh` owns worker
  // verdicts and gained `waiting`/`stalled` in PR #219; this branch adds a
  // number and no opinion. "Stuck" depends on what the branch is DOING —
  // fifteen minutes of silence is alarming during an edit and unremarkable
  // during `test:board`, which takes about that long by itself.
  //
  // So the row may carry no threshold-shaped sibling. This fails the moment
  // someone adds `changed_stale: true` or similar next to the number.
  const f = makeRepo('plot-fleet-chg-nov-', ONE_WAVE('feature/measured'));
  f.work('feature/measured', 'm.txt');
  f.push('-u', 'origin', 'feature/measured');
  git(f.dir, 'checkout', '-q', 'main');
  addWorktree(f, 'feature/measured', 'measured');

  const b = branchRow(f, 'feature/measured');
  // `changed_at` joins the allowlist because it is the SAME KIND of thing the
  // rule protects: an epoch second, with no opinion in it. It exists because the
  // AGE cannot be watched for change — it is recomputed against `now` every
  // scan, so a detector watching it fires on every pulse forever (measured
  // 2026-08-24: 71805 → 71824 across 12 quiet seconds). Two measurements, one
  // walk; still no verdict.
  //
  // The rule itself is unchanged and still fails on `changed_stale: true` or any
  // other threshold-shaped sibling — which is the thing this guard is for.
  const verdictish = Object.keys(b).filter((k) =>
    /^changed_/.test(k) && k !== 'changed_ago_seconds' && k !== 'changed_at'
    && k !== 'changed_paths');
  assert.deepEqual(verdictish, [],
    `the scan reports the number and draws no conclusion, found: ${verdictish.join(', ')}`);
  f.cleanup();
});

// --- a terminal branch is asked once ----------------------------------------
//
// THE MEASUREMENT THAT FORCED THIS, taken on this repo 2026-08-19 after the
// join (#232) landed. 26 of 54 branches are terminal — merged or deferred — and
// a terminal fact cannot change: a merged branch stays merged. The scan
// re-derived them at full price on every 5 s pulse, forever.
//
// WHAT THE JOIN LEFT BEHIND, measured in a sandbox before writing any of this:
//
//   merged, ref KEPT      3 branches -> 1 pr-list      9 -> 1 pr-list
//   squash-merged, DELETED 3 branches -> 3 pr-state    9 -> 9 pr-state
//
// So after #232 the ONLY per-branch host cost left is the no-ref `--ask` arm
// (PR #216), and that arm is exactly the terminal population: a branch whose
// ref is gone and whose merge already landed. The cache lands there and
// NOWHERE ELSE, which is why a live branch cannot be cached even by accident —
// a live branch has a ref and never reaches the call.
//
// THE CACHE IS A DERIVATION, NOT A RECORD, and that distinction is the whole
// design. Git is consulted on EVERY pass; only the host call is skipped. The
// entry carries the evidence that made the branch terminal, and git is asked
// whether that evidence still holds:
//
//   * the ref reappeared          -> the branch has work again, re-ask
//   * the plan was edited         -> its branches' answers are invalidated
//   * main moved                  -> the merge evidence is re-derived
//
// It never touches disk and never outlives the process. The scan receives it in
// the ENVIRONMENT and reports what it learned on STDERR, so the board — which
// is the only long-lived process in the system — can hold the map across
// pulses. A file would be a second source of truth about a repo whose only
// source of truth is git (Manifesto Principle 1).

/**
 * Run the scan with a terminal cache in the environment, returning what it
 * learned alongside the calls it made.
 *
 * The cache crosses the process boundary the way the board passes it: an
 * environment variable in, a stderr note out. Nothing is written to disk here,
 * because nothing may be — a test that used a temp file would pass while
 * testing the shape the plan forbids.
 */
const MERGED_HOST = `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-state) echo '{"number":9,"state":"MERGED","draft":false,"url":"u"}' ;;
  pr-list) : ;;
  *) echo "{}" ;;
esac
`;

function scanWithCache(f, cache, host = MERGED_HOST) {
  const h = hostShim(host);
  const calls = path.join(h.dir, 'calls.txt');
  const res = spawnSync('bash', [h.scan], {
    encoding: 'utf8', cwd: f.dir,
    env: { ...process.env, PLOT_TEST_CALLS: calls, PLOT_TERMINAL_CACHE: cache ?? '' },
  });
  const ops = fs.existsSync(calls)
    ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
  // The learned entries ride stderr, one `terminal:` note per branch, so stdout
  // stays byte-identical to a run without the cache.
  const learned = (res.stderr || '').split('\n')
    .filter((l) => l.startsWith('terminal:'))
    .map((l) => l.slice('terminal:'.length).trim());
  h.cleanup();
  return { out: res.stdout, ops, learned, asked: ops.filter((o) => o === 'pr-state').length };
}

/** A repo whose `n` branches were all squash-merged and their refs deleted. */
function makeTerminalRepo(prefix, n) {
  const f = makeRepo(prefix,
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    Array.from({ length: n }, (_, i) => `- \`feature/b${i}\` — the work\n`).join(''));
  for (let i = 0; i < n; i++) {
    f.work(`feature/b${i}`, `f${i}.txt`);
    f.push('-u', 'origin', `feature/b${i}`);
    squashMerge(f, `feature/b${i}`, 100 + i);
    f.push('origin', 'main');
    f.push('origin', '--delete', `feature/b${i}`);
  }
  git(f.dir, 'fetch', '-q', '--prune', 'origin');
  return f;
}

test('terminal: a merged branch costs one host call across many pulses', () => {
  // THE CLAIM, as a count rather than a timing — a timing assertion on CI is a
  // flake, and the count is what the plan actually promises.
  //
  // Three pulses over the same terminal branches. The first pays; the second
  // and third must pay NOTHING, because nothing about a merged branch can have
  // changed. Against a scan with no cache all three cost the same, which is the
  // defect.
  const f = makeTerminalRepo('plot-fleet-term-once-', 4);

  const cold = scanWithCache(f, null);
  assert.equal(cold.asked, 4, `a cold scan asks about each terminal branch, saw ${cold.asked}`);
  assert.equal(cold.learned.length, 4,
    `a cold scan must report what it learned, saw ${cold.learned.length}`);

  // Pulses two and three, each handed what the one before it learned.
  const warm = scanWithCache(f, cold.learned.join('\n'));
  assert.equal(warm.asked, 0,
    `a warm pulse must ask nothing, saw ${warm.asked}: ${warm.ops.join(',')}`);
  const warm2 = scanWithCache(f, warm.learned.join('\n'));
  assert.equal(warm2.asked, 0, `the cache must survive a pulse that used it, saw ${warm2.asked}`);

  f.cleanup();
});

test('terminal: a warm scan returns byte-identical output to a cold one', () => {
  // THE PROPERTY THAT MAKES THE CACHE INVISIBLE, and the one a plausible
  // regression breaks quietly. A cache that changes what the board renders is
  // not an optimisation, it is a second answer — and the operator has no way to
  // tell which of the two they are looking at.
  const f = makeTerminalRepo('plot-fleet-term-ident-', 3);
  const cold = scanWithCache(f, null);
  const warm = scanWithCache(f, cold.learned.join('\n'));
  assert.equal(warm.out, cold.out,
    'a warm scan must render exactly what a cold one does');
  f.cleanup();
});

test('terminal: a merged branch whose ref reappears is re-asked on the next pulse', () => {
  // THE INVALIDATION THAT KEEPS IT A DERIVATION. A branch name is reusable:
  // merge `bug/flaky`, delete it, then push it again for a second attempt. The
  // cached answer describes the FIRST attempt, and serving it for the second
  // reports unlanded work as merged — which settles a wave and opens the next
  // one on work that has not landed.
  //
  // Git alone catches this, which is why git is consulted every pass: the
  // branch has a ref again, and the evidence the entry was built on said it had
  // none.
  const f = makeTerminalRepo('plot-fleet-term-reappear-', 1);
  const cold = scanWithCache(f, null);
  assert.equal(cold.asked, 1, 'the cold scan asks once');

  // The branch comes back with NEW work that has not landed. The LOCAL ref
  // survived the remote delete, so the second attempt reuses it rather than
  // branching a name that already exists.
  git(f.dir, 'branch', '-q', '-D', 'feature/b0');
  f.work('feature/b0', 'second-attempt.txt');
  f.push('-u', 'origin', 'feature/b0');
  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'fetch', '-q', 'origin');

  const again = scanWithCache(f, cold.learned.join('\n'));
  assert.match(branchLine(again.out, 'feature/b0'), / — in progress$/,
    'a reappeared ref carries unlanded work and must not read as merged');

  f.cleanup();
});

test('terminal: an edited plan invalidates its branches cached answers', () => {
  // A PLAN IS AN INPUT TO THE DERIVATION, not just a list of names. `deferred:`
  // annotations, wave membership and the plan's own phase all decide what a
  // branch's answer means, so an answer derived under one revision of the plan
  // is not evidence about the next.
  //
  // The edit here changes nothing about the BRANCH — only the plan file — and
  // the cached answer must still be discarded. Anything less makes the cache a
  // record of a plan that no longer exists.
  const f = makeTerminalRepo('plot-fleet-term-planedit-', 2);
  const cold = scanWithCache(f, null);
  assert.equal(cold.asked, 2, 'the cold scan asks about both');

  const plan = path.join(f.dir, 'plans', '2026-01-01-p.md');
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8') + '\n## Notes\n\nA later thought.\n');
  git(f.dir, 'add', '-A');
  git(f.dir, 'commit', '-qm', 'plan: a later thought');
  f.push('origin', 'main');

  const after = scanWithCache(f, cold.learned.join('\n'));
  assert.equal(after.asked, 2,
    `an edited plan must invalidate its branches, saw ${after.asked} of 2 re-asked`);

  f.cleanup();
});

test('terminal: a live branch is never cached', () => {
  // ASSERTED RATHER THAN ASSUMED, as the plan requires. A live branch's state
  // is the thing the board exists to watch change, and a cached `open` is a
  // board that stops reporting the only rows anybody is looking at.
  //
  // Two live shapes that both have a ref: one in flight, one claimed. Neither
  // may appear in what the scan reports as learned.
  const f = makeRepo('plot-fleet-term-live-',
    '# P\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n' +
    '- `feature/live` — the work\n- `feature/landed` — the work\n');
  f.work('feature/live', 'live.txt');
  f.push('-u', 'origin', 'feature/live');
  f.work('feature/landed', 'landed.txt');
  f.push('-u', 'origin', 'feature/landed');
  squashMerge(f, 'feature/landed', 55);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/landed');
  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'fetch', '-q', '--prune', 'origin');

  const cold = scanWithCache(f, null);
  assert.ok(cold.learned.some((l) => l.includes('feature/landed')),
    'the terminal branch is what the cache is for');
  assert.ok(!cold.learned.some((l) => l.includes('feature/live')),
    `a live branch must never be cached, saw: ${cold.learned.join(' | ')}`);

  f.cleanup();
});

test('terminal: an unanswerable host is not a terminal answer', () => {
  // THE 2026-08-17 TRAP, IN THE SHAPE A CACHE GIVES IT. `-` means the question
  // could not be answered, and caching it would freeze one bad afternoon into
  // every later pulse — an outage multiplied by the life of the board rather
  // than by the branch count.
  //
  // Only a decided answer is terminal. An unreachable host must leave the
  // branch exactly as unasked as it was.
  const f = makeTerminalRepo('plot-fleet-term-down-', 2);
  const down = scanWithCache(f, null, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) exit 1 ;;
  pr-state) exit 1 ;;
  *) echo "{}" ;;
esac
`);
  assert.equal(down.learned.length, 0,
    `an unreachable host teaches the cache nothing, saw: ${down.learned.join(' | ')}`);
  f.cleanup();
});

// --- --loose checks the rollup: only green opens the next wave -------------
//
// The plan promises "--loose means the prior wave's PRs are green and ready".
// An earlier implementation accepted ANY non-draft PR, regardless of its build
// status — so red CI opened the next wave. These tests pin the fixed behavior.

test('fleet: --loose rejects a failing PR and blocks the successor wave', () => {
  // THE DEFECT THIS FIX ADDRESSES. An OPEN, non-draft PR with failing checks
  // must NOT open the next wave — it is not "ready" in the documented sense.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loose-fail-'));
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
    '# LP\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n- `feature/first` — failing build\n\n### Two\n- `feature/second` — waits on wave one\n');
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

  // Stub: pr-list --rich returns a failing build
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-hostshim-'));
  const realScripts = path.dirname(scan);
  fs.mkdirSync(path.join(shim, 'scripts'));
  for (const f of fs.readdirSync(realScripts)) {
    if (f.endsWith('.sh')) fs.copyFileSync(path.join(realScripts, f), path.join(shim, 'scripts', f));
  }
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'), `#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list)
    echo '{"number":1,"title":"t","state":"OPEN","head":"feature/first","draft":false,"checks":"failing","mergeable":"mergeable","review":"","url":"x","failing_checks":["test"]}' ;;
  pr-state) echo '{"number":1,"state":"OPEN","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);

  const shimScan = path.join(shim, 'scripts', 'plot-fleet-scan.sh');
  const loose = execFileSync('bash', [shimScan, '--loose', 'lp'], { encoding: 'utf8', cwd: r });
  assert.match(loose, /Two — blocked/,
    'a failing-checks PR must NOT satisfy loose eligibility');
  assert.match(loose, /loose eligibility/, 'the banner must say loose is active');

  fs.rmSync(shim, { recursive: true, force: true });
  fs.rmSync(t, { recursive: true, force: true });
});

test('fleet: --loose rejects a pending PR and blocks the successor wave', () => {
  // PENDING means CI is still running — the seam is unproven.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loose-pend-'));
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
    '# LP\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n- `feature/first` — pending build\n\n### Two\n- `feature/second` — waits on wave one\n');
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

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-hostshim-'));
  const realScripts = path.dirname(scan);
  fs.mkdirSync(path.join(shim, 'scripts'));
  for (const f of fs.readdirSync(realScripts)) {
    if (f.endsWith('.sh')) fs.copyFileSync(path.join(realScripts, f), path.join(shim, 'scripts', f));
  }
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'), `#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list)
    echo '{"number":1,"title":"t","state":"OPEN","head":"feature/first","draft":false,"checks":"pending","mergeable":"mergeable","review":"","url":"x","failing_checks":[]}' ;;
  pr-state) echo '{"number":1,"state":"OPEN","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);

  const shimScan = path.join(shim, 'scripts', 'plot-fleet-scan.sh');
  const loose = execFileSync('bash', [shimScan, '--loose', 'lp'], { encoding: 'utf8', cwd: r });
  assert.match(loose, /Two — blocked/,
    'a pending-checks PR must NOT satisfy loose eligibility');

  fs.rmSync(shim, { recursive: true, force: true });
  fs.rmSync(t, { recursive: true, force: true });
});

test('fleet: --loose rejects an unknown-rollup PR and announces the degradation', () => {
  // UNKNOWN means the host could not produce a rollup — Bitbucket with no CI.
  // The degradation must be ANNOUNCED rather than silent.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loose-unk-'));
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
    '# LP\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n- `feature/first` — unknown rollup\n\n### Two\n- `feature/second` — waits on wave one\n');
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

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-hostshim-'));
  const realScripts = path.dirname(scan);
  fs.mkdirSync(path.join(shim, 'scripts'));
  for (const f of fs.readdirSync(realScripts)) {
    if (f.endsWith('.sh')) fs.copyFileSync(path.join(realScripts, f), path.join(shim, 'scripts', f));
  }
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'), `#!/usr/bin/env bash
case "$1" in
  backend) echo bitbucket ;;
  default-branch) echo main ;;
  pr-list)
    echo '{"number":1,"title":"t","state":"OPEN","head":"feature/first","draft":false,"checks":"unknown","mergeable":"unknown","review":"","url":"x","failing_checks":[]}' ;;
  pr-state) echo '{"number":1,"state":"OPEN","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);

  const shimScan = path.join(shim, 'scripts', 'plot-fleet-scan.sh');
  const loose = execFileSync('bash', [shimScan, '--loose', 'lp'], { encoding: 'utf8', cwd: r });
  assert.match(loose, /Two — blocked/,
    'an unknown-checks PR must NOT satisfy loose eligibility');
  assert.match(loose, /degraded.*strict|unavailable/i,
    'the degradation must be announced, not silent');

  fs.rmSync(shim, { recursive: true, force: true });
  fs.rmSync(t, { recursive: true, force: true });
});

test('fleet: --loose rejects a none-rollup PR (no checks ran)', () => {
  // NONE means no checks ran — nothing was verified.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loose-none-'));
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
    '# LP\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n- `feature/first` — no checks ran\n\n### Two\n- `feature/second` — waits on wave one\n');
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

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-hostshim-'));
  const realScripts = path.dirname(scan);
  fs.mkdirSync(path.join(shim, 'scripts'));
  for (const f of fs.readdirSync(realScripts)) {
    if (f.endsWith('.sh')) fs.copyFileSync(path.join(realScripts, f), path.join(shim, 'scripts', f));
  }
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'), `#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list)
    echo '{"number":1,"title":"t","state":"OPEN","head":"feature/first","draft":false,"checks":"none","mergeable":"mergeable","review":"","url":"x","failing_checks":[]}' ;;
  pr-state) echo '{"number":1,"state":"OPEN","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);

  const shimScan = path.join(shim, 'scripts', 'plot-fleet-scan.sh');
  const loose = execFileSync('bash', [shimScan, '--loose', 'lp'], { encoding: 'utf8', cwd: r });
  assert.match(loose, /Two — blocked/,
    'a none-checks PR must NOT satisfy loose eligibility');

  fs.rmSync(shim, { recursive: true, force: true });
  fs.rmSync(t, { recursive: true, force: true });
});

test('fleet: --loose accepts a green PR and opens the successor wave', () => {
  // The positive case: a green, non-draft PR DOES satisfy loose eligibility.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loose-green-'));
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
    '# LP\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n- `feature/first` — green build\n\n### Two\n- `feature/second` — waits on wave one\n');
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

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-hostshim-'));
  const realScripts = path.dirname(scan);
  fs.mkdirSync(path.join(shim, 'scripts'));
  for (const f of fs.readdirSync(realScripts)) {
    if (f.endsWith('.sh')) fs.copyFileSync(path.join(realScripts, f), path.join(shim, 'scripts', f));
  }
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'), `#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list)
    echo '{"number":1,"title":"t","state":"OPEN","head":"feature/first","draft":false,"checks":"green","mergeable":"mergeable","review":"","url":"x","failing_checks":[]}' ;;
  pr-state) echo '{"number":1,"state":"OPEN","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);

  const shimScan = path.join(shim, 'scripts', 'plot-fleet-scan.sh');
  const loose = execFileSync('bash', [shimScan, '--loose', 'lp'], { encoding: 'utf8', cwd: r });
  assert.match(loose, /Two — eligible/,
    'a green, non-draft PR must satisfy loose eligibility');
  assert.match(loose, /loose eligibility/, 'the banner must say loose is active');

  fs.rmSync(shim, { recursive: true, force: true });
  fs.rmSync(t, { recursive: true, force: true });
});

test('fleet: --loose makes no per-branch host call with --rich cache', () => {
  // COST ASSERTION: the rollup comes from pr-list --rich, never from per-branch
  // pr-state calls. This is the N+1 fix.
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loose-cost-'));
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
    '# LP\n\n## Status\n\n- **Phase:** Approved\n\n## Branches\n\n### One\n- `feature/first` — one\n- `feature/second` — two\n- `feature/third` — three\n\n### Two\n- `feature/fourth` — waits on wave one\n');
  fs.symlinkSync('../2026-01-01-lp.md', path.join(r, 'plans', 'active', 'lp.md'));
  git(r, 'add', '-A');
  git(r, 'commit', '-qm', 'plan');
  git(r, 'push', '-q', 'origin', 'main');
  // Create three branches in wave one
  for (const br of ['feature/first', 'feature/second', 'feature/third']) {
    git(r, 'checkout', '-q', '-b', br);
    fs.writeFileSync(path.join(r, `${br.replace(/\//g, '-')}.txt`), 'done\n');
    git(r, 'add', '-A');
    git(r, 'commit', '-qm', 'work');
    git(r, 'push', '-q', '-u', 'origin', br);
    git(r, 'checkout', '-q', 'main');
  }

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-hostshim-'));
  const realScripts = path.dirname(scan);
  fs.mkdirSync(path.join(shim, 'scripts'));
  for (const f of fs.readdirSync(realScripts)) {
    if (f.endsWith('.sh')) fs.copyFileSync(path.join(realScripts, f), path.join(shim, 'scripts', f));
  }
  const calls = path.join(shim, 'calls.txt');
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list)
    echo '{"number":1,"title":"t","state":"OPEN","head":"feature/first","draft":false,"checks":"green","mergeable":"mergeable","review":"","url":"x","failing_checks":[]}'
    echo '{"number":2,"title":"t","state":"OPEN","head":"feature/second","draft":false,"checks":"green","mergeable":"mergeable","review":"","url":"x","failing_checks":[]}'
    echo '{"number":3,"title":"t","state":"OPEN","head":"feature/third","draft":false,"checks":"green","mergeable":"mergeable","review":"","url":"x","failing_checks":[]}' ;;
  pr-state) echo '{"number":1,"state":"OPEN","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);

  const shimScan = path.join(shim, 'scripts', 'plot-fleet-scan.sh');
  execFileSync('bash', [shimScan, '--loose', 'lp'], {
    encoding: 'utf8', cwd: r,
    env: { ...process.env, PLOT_TEST_CALLS: calls },
  });

  const callLog = fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean);
  const prStateCalls = callLog.filter((l) => l.includes('pr-state'));
  assert.equal(prStateCalls.length, 0,
    `--loose must not call pr-state per branch, saw: ${prStateCalls.join(' | ')}`);

  fs.rmSync(shim, { recursive: true, force: true });
  fs.rmSync(t, { recursive: true, force: true });
});

// --- ref_held: whether a ref on the remote holds the branch ----------------
//
// The git fact `plot-dispatch.sh` tests when it claims: a push of an empty
// commit that a non-fast-forward refuses, so a branch whose ref already exists
// is one no dispatch can take. The scan reads the refs to derive `merged` and
// `wip` already, so this costs no git spawn and no host call.
//
// It is the THIRD claim-shaped field and a rename of neither. `claimed` is the
// PLAN FILE's annotation — a reflection of a claim, and git wins where they
// disagree. `held` is about a WORKTREE on the scanning machine. This is about a
// REF, so it is the only one of the three that reads the same from every
// machine, which is exactly the population — a branch claimed by a detached
// worker on another host — the measured misread came from.
//
// These tests assert the fact across EVERY state rather than only the claimed
// one, because the consumer's whole reason for reading it is that no single
// state implies it: `wip` implies a ref but can be overridden to `merged` while
// the ref survives, and `claimed` is a ref that no `wip` test sees.

test('fleet: a claim ref with no worktree reports ref_held', () => {
  // The population the plan is named for, and the one `held` cannot answer: a
  // dispatcher on another machine pushed the claim, so nothing is observable
  // here. `held` is false, and a consumer reading it alone would call this
  // branch free and spend budget on a dispatch the ref refuses.
  const f = makeRepo('plot-fleet-refheld-claim-', ONE_WAVE('feature/claim-only'));
  git(f.dir, 'checkout', '-qb', 'feature/claim-only');
  git(f.dir, 'commit', '-q', '--allow-empty', '-m', 'plot: claim feature/claim-only');
  f.push('-u', 'origin', 'feature/claim-only');
  git(f.dir, 'checkout', '-q', 'main');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/claim-only');
  assert.equal(b.state, 'claimed', 'only claim commits beyond main');
  assert.equal(b.held, false, 'nothing is observable on this machine');
  assert.equal(b.ref_held, true, 'but a ref holds it, and that is cross-machine');
  f.cleanup();
});

test('fleet: a branch with NO ref reports ref_held false', () => {
  // `Done when` item 2, from this wave's side. The ordinary case must not
  // regress: a fix that reported every branch as held would stop the fleet
  // entirely, and it is the only failure mode of this field that is worse than
  // the defect. A branch named by a plan and never pushed has no ref at all.
  const f = makeRepo('plot-fleet-refheld-none-', ONE_WAVE('feature/never-started'));

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/never-started');
  assert.equal(b.state, 'open', 'no ref and no merge evidence');
  assert.equal(b.ref_held, false, 'nothing holds it — this is the startable case');
  f.cleanup();
});

test('fleet: real work in flight reports ref_held', () => {
  // `wip` — the state a consumer can almost infer the ref from, asserted so the
  // two cannot drift apart. The inference is what auto-dispatch does today; the
  // field is what makes it a reading rather than a deduction.
  const f = makeRepo('plot-fleet-refheld-wip-', ONE_WAVE('feature/in-progress'));
  f.work('feature/in-progress', 'w.txt');
  f.push('-u', 'origin', 'feature/in-progress');
  git(f.dir, 'checkout', '-q', 'main');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/in-progress');
  assert.equal(b.state, 'wip', 'real commits beyond main');
  assert.equal(b.ref_held, true, 'and a ref carries them');
  f.cleanup();
});

test('fleet: a merged branch whose ref survives still reports ref_held', () => {
  // THE CASE THAT MAKES THIS A FIELD RATHER THAN AN INFERENCE. The work landed
  // and the ref was kept, so a dispatch would still be refused — while the
  // state says `merged`, which no ref-inference over `wip` can see. The field
  // reports the REF and draws no conclusion from it: whether a merged branch
  // matters is the consumer's judgement, and `merged` already answers
  // startability on its own.
  const f = makeRepo('plot-fleet-refheld-merged-', ONE_WAVE('feature/landed-ref'));
  f.work('feature/landed-ref', 'l.txt');
  f.push('-u', 'origin', 'feature/landed-ref');
  f.prMerge('feature/landed-ref');            // --no-ff into main, ref kept
  f.push('origin', 'main');
  git(f.dir, 'checkout', '-q', 'main');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/landed-ref');
  assert.equal(b.state, 'merged', 'the work landed');
  assert.equal(b.ref_held, true, 'and the ref outlived the merge, so it still holds the name');
  f.cleanup();
});

test('fleet: a merged-and-DELETED branch reports ref_held false', () => {
  // The other half of the merged case, and the one that keeps the field honest:
  // where the host deleted the ref at merge, nothing holds the name and a
  // dispatch of it would succeed. Two branches reading `merged` disagree on
  // this field, which is the proof it is measuring the ref and not the state.
  const f = makeRepo('plot-fleet-refheld-gone-', ONE_WAVE('feature/landed-gone'));
  f.work('feature/landed-gone', 'g.txt');
  f.push('-u', 'origin', 'feature/landed-gone');
  f.prMerge('feature/landed-gone');
  f.push('origin', 'main');
  git(f.dir, 'checkout', '-q', 'main');
  git(f.dir, 'push', '-q', 'origin', '--delete', 'feature/landed-gone');

  const doc = JSON.parse(f.run(['--json']));
  const b = doc.plans[0].waves[0].branches.find((x) => x.branch === 'feature/landed-gone');
  assert.equal(b.state, 'merged', 'the merge subject still names it');
  assert.equal(b.ref_held, false, 'but no ref holds the name any more');
  f.cleanup();
});

// --- a scan that could not ask says so -------------------------------------
//
// THE MEASURED FAILURE, 2026-08-30. `#513` was merged. Minutes later the scan
// reported its branch `open`, counted it among the unfinished, and put
// `merge_detect=pr-merge` in the summary — which reads as *the host was asked
// and answered*. What had happened was
// `GraphQL: API rate limit already exceeded for user ID 870334`.
//
// Nothing in that output was a warning, and that is what makes it expensive:
// `pr-list` is ONE GraphQL call in place of ~186 REST calls, so throttling
// takes out EVERY PR answer at once. The whole fleet reads unmerged, every
// wave stays blocked, and the board shows a busy estate with nothing eligible
// — indistinguishable from work genuinely in flight.
//
// THE DEGRADATION DIRECTION DOES NOT CHANGE, and the tests above pin it: an
// unreachable host still answers *not merged*, because silence is never
// permission. What is added is the REPORT.

test('fleet: a throttled host is named in the summary', () => {
  const f = makeRepo('plot-fleet-throttled-', ONE_WAVE('feature/squashed'));
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 513);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  // Exit 5 is `plot-host.sh`'s word for a rate limit. `pr-state` fails the same
  // way — a spent bucket does not refill between two calls a millisecond apart,
  // and a stub where the list is throttled but the per-branch lookup answers
  // would test a state that cannot occur.
  const { out } = countCalls(f, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) echo 'plot-host: pr-list: host throttled — API rate limit exceeded' >&2; exit 5 ;;
  pr-state) echo 'plot-host: host throttled' >&2; exit 5 ;;
  *) echo "{}" ;;
esac
`);
  assert.match(footerOf(out), /\bhost=throttled\b/,
    'a reader who sees host=throttled knows the merge answers are unreliable ' +
    'without reading further — which is the whole point of it being in the footer');
});

// DONE-WHEN 2, AND THE ROW IS WHERE IT BITES. `open` is a claim about a PR:
// that one was looked for and none was found. When the host could not be
// asked, no such claim was earned, and the honest word is a different one.
test('fleet: no row reads `open` when its PR could not be read', () => {
  const f = makeRepo('plot-fleet-throttledrow-', ONE_WAVE('feature/squashed'));
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 513);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  const { out } = countCalls(f, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) exit 5 ;;
  pr-state) exit 5 ;;
  *) echo "{}" ;;
esac
`);
  const line = branchLine(out, 'feature/squashed');
  assert.doesNotMatch(line, / — open$/,
    'this branch WAS merged; reporting `open` states a fact the scan does not have');
  assert.match(line, /unknown/,
    'and the word says which of the two it is — asked and answered, or never asked');
});

// AND IT MUST NOT MANUFACTURE THE OPPOSITE. The direction is the whole safety
// property: an unreachable host may not produce `merged`, because `merged`
// settles a wave and opens the next one on work that may never have landed.
// A test that only forbids `open` passes an implementation that swapped one
// fabricated verdict for a worse one.
test('fleet: a throttled host still never manufactures `merged`', () => {
  const f = makeRepo('plot-fleet-throttlednomerge-', ONE_WAVE('feature/squashed'));
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 513);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  const { out } = countCalls(f, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) exit 5 ;;
  pr-state) exit 5 ;;
  *) echo "{}" ;;
esac
`);
  assert.doesNotMatch(branchLine(out, 'feature/squashed'), / — merged$/,
    'silence is never permission');
  assert.doesNotMatch(waveLine(out, 'One'), / — complete$/,
    'and a wave may not settle on an answer nobody received');
});

// AN UNREADABLE PR IS NOT A BRANCH TO HAND OUT. This is the measured failure
// stated as a consequence rather than as a word: #513 was merged, read
// `eligible`, and `--next` would have handed a finished branch to a worker.
// A branch whose PR could not be read may not be claimed, because "nobody has
// started this" is precisely the claim that went unverified.
test('fleet: --next offers no branch whose PR could not be read', () => {
  const f = makeRepo('plot-fleet-throttlednext-', ONE_WAVE('feature/squashed'));
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 513);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) exit 5 ;;
  pr-state) exit 5 ;;
  *) echo "{}" ;;
esac
`);
  // NO `--offline`: that flag promises no network, so the host is never asked
  // and the verdict is `unasked` rather than `throttled` — a question not put
  // is not a question that went unanswered. The case under test needs the scan
  // to actually try.
  const res = spawnSync('bash', [h.scan, '--next'], {
    encoding: 'utf8', cwd: f.dir, env: { ...process.env },
  });
  assert.equal(res.stdout.trim(), '',
    'handing out a branch whose PR is unknown is how a merged branch got re-dispatched');
  assert.notEqual(res.status, 0, 'and nothing to start exits 1');
  h.cleanup();
  f.cleanup();
});

// A HEALTHY SCAN IS UNCHANGED — Done-when 3, and it is the constraint the rest
// of this slice has to fit inside. `--next` picks branches to claim from this
// output, so any moved verdict is a regression rather than a cosmetic
// difference.
test('fleet: a healthy host reads host=ok and moves no verdict', () => {
  const f = makeRepo('plot-fleet-hostok-', ONE_WAVE('feature/squashed'));
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 42);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  const { out } = countCalls(f, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) echo '{"number":42,"title":"the work","state":"MERGED","head":"feature/squashed"}' ;;
  pr-state) echo '{"number":42,"state":"MERGED","draft":false,"url":"x"}' ;;
  *) echo "{}" ;;
esac
`);
  assert.match(footerOf(out), /\bhost=ok\b/, 'the host answered');
  assert.match(branchLine(out, 'feature/squashed'), / — merged$/,
    'and the verdict is exactly what it was before this field existed');
  assert.match(waveLine(out, 'One'), / — complete$/, 'as is the wave');
});

// THE ASSERTION THAT CARRIES THE SLICE. Without it the fix could be "treat an
// empty list as throttled", which trades a silent wrong answer for a noisy one
// and breaks every repo that genuinely has no open PRs. An empty list that
// ARRIVED is evidence; the absence of a list is not.
test('fleet: an EMPTY list still reads host=ok, with zero PRs', () => {
  const f = makeRepo('plot-fleet-hostokempty-', ONE_WAVE('feature/inflight'));
  f.work('feature/inflight', 'a.txt');
  f.push('-u', 'origin', 'feature/inflight');
  git(f.dir, 'checkout', '-q', 'main');

  const { out } = countCalls(f, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) : ;;
  pr-state) echo '{"number":0,"state":"NONE","draft":false,"url":""}' ;;
  *) echo "{}" ;;
esac
`);
  assert.match(footerOf(out), /\bhost=ok\b/,
    'a repo with no PRs is not a broken host, and must not be reported as one');
  assert.match(branchLine(out, 'feature/inflight'), / — in progress$/,
    'the local state answers, exactly as it did before');
});

// THROTTLED AND FAILED ARE DIFFERENT WORDS BECAUSE THEY ASK FOR DIFFERENT
// THINGS. `throttled` says wait — the budget refills on a clock. `failed` says
// look — something is broken and waiting will not fix it. A summary that
// collapsed them would counsel one when it meant the other.
test('fleet: a broken host reads host=failed, not host=throttled', () => {
  const f = makeRepo('plot-fleet-hostfailed-', ONE_WAVE('feature/squashed'));
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 513);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  // Exit 3 is `plot-host.sh`'s word for any failure it could not classify.
  const { out } = countCalls(f, `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$PLOT_TEST_CALLS"
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) echo 'plot-host: pr-list: 503 Service Unavailable' >&2; exit 3 ;;
  pr-state) exit 3 ;;
  *) echo "{}" ;;
esac
`);
  assert.match(footerOf(out), /\bhost=failed\b/, 'a 503 is not a rate limit');
  assert.doesNotMatch(footerOf(out), /\bhost=throttled\b/,
    'telling an operator to wait out an outage wastes the time waiting was meant to save');
});

// THE JSON CARRIES IT TOO, because the board is the consumer that renders it
// and must not parse the prose footer. The same rule every other field here
// follows: the machine reads the field, the human reads the line.
test('fleet: the JSON pulse carries the host verdict', () => {
  const f = makeRepo('plot-fleet-hostjson-', ONE_WAVE('feature/squashed'));
  f.work('feature/squashed', 's.txt');
  f.push('-u', 'origin', 'feature/squashed');
  squashMerge(f, 'feature/squashed', 513);
  f.push('origin', 'main');
  f.push('origin', '--delete', 'feature/squashed');

  const h = hostShim(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list) exit 5 ;;
  pr-state) exit 5 ;;
  *) echo "{}" ;;
esac
`);
  // No `--offline`, for the reason the --next test above states.
  const out = execFileSync('bash', [h.scan, '--json'],
    { encoding: 'utf8', cwd: f.dir });
  const pulse = JSON.parse(out);
  assert.equal(pulse.summary.host, 'throttled',
    'the board renders this beside prError — the same shape, one level up');
  h.cleanup();
  f.cleanup();
});
