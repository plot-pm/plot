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
import { execFileSync, spawn } from 'node:child_process';
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
