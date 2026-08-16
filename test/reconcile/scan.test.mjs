// End-to-end contract test for skills/plot/scripts/plot-reconcile-scan.sh.
// Builds a throwaway git repo (with a local bare "origin") containing one
// known finding per report section, runs the scan, and asserts each section
// reports exactly its planted finding. The repo uses a NON-default plan
// directory (plans/ at the repo root) so the Plot Config path is exercised,
// not just the defaults. The origin remote is a local path (no git host), so
// the PR-state banner must be DEGRADED — deterministic in CI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-'));
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

  // Section 1: phase Delivered but symlink still in active/ (half-delivery).
  write('plans/2026-01-01-alpha.md', `# Alpha

## Status

- **Phase:** Delivered
- **Type:** feature
`);
  // Section 2: front-matter Approved plan whose impl branch gets merged below.
  write('plans/2026-01-02-beta.md', `---
status: Approved
type: feature
---

# Beta

## Branches

- \`feature/beta\` — impl → #1
`);
  // Sections 3+4: Approved plan whose branch is ahead of main (orphan, no PR).
  write('plans/2026-01-03-gamma.md', `# Gamma

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

- \`bug/gamma\` — impl
`);
  // Section 5a: legacy plan without any phase field.
  write('plans/2026-01-04-legacy.md', `# Legacy pre-plot notes\n`);
  // Section 5b: plot-managed plan with no symlink in either index.
  write('plans/2026-01-05-omega.md', `# Omega

## Status

- **Phase:** Approved
- **Type:** docs
`);
  // Section 1 (terminal-state coverage): a Superseded plan whose symlink is
  // still in active/ — must be flagged as drift, fix routing to delivered/.
  write('plans/2026-01-06-sigma.md', `# Sigma

## Status

- **Phase:** Superseded
- **Type:** feature
`);
  // Section 5 (terminal orphan routing): a Superseded plan with NO symlink —
  // its suggested fix must target delivered/ (the terminal index), not active/.
  write('plans/2026-01-07-tau.md', `# Tau

## Status

- **Phase:** Superseded
- **Type:** feature
`);

  fs.mkdirSync(path.join(repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'plans', 'delivered'), { recursive: true });
  fs.symlinkSync('../2026-01-01-alpha.md', path.join(repo, 'plans', 'active', 'alpha.md'));
  fs.symlinkSync('../2026-01-02-beta.md', path.join(repo, 'plans', 'active', 'beta.md'));
  fs.symlinkSync('../2026-01-03-gamma.md', path.join(repo, 'plans', 'active', 'gamma.md'));
  fs.symlinkSync('../2026-01-06-sigma.md', path.join(repo, 'plans', 'active', 'sigma.md'));

  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');

  // feature/beta: branched, one commit, merged back to main (branch kept on
  // origin → section 2 merged-but-not-delivered + section 3 deletion candidate).
  git(repo, 'checkout', '-q', '-b', 'feature/beta');
  write('beta-impl.txt', 'done\n');
  git(repo, 'add', 'beta-impl.txt');
  git(repo, 'commit', '-q', '-m', 'beta impl');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'merge', '-q', '--no-ff', '--no-edit', 'feature/beta');

  // bug/gamma: branched with one unmerged commit → section 3 orphan +
  // section 4 "1 ahead / 0 behind".
  git(repo, 'checkout', '-q', '-b', 'bug/gamma');
  write('gamma-wip.txt', 'wip\n');
  git(repo, 'add', 'gamma-wip.txt');
  git(repo, 'commit', '-q', '-m', 'gamma wip');
  git(repo, 'checkout', '-q', 'main');

  git(repo, 'push', '-q', 'origin', 'main', 'feature/beta', 'bug/gamma');

  report = execFileSync('bash', [scan, '--no-fetch'], { encoding: 'utf8', cwd: repo });
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('scan: degraded banner without a git-host CLI for the origin host', () => {
  assert.match(report, /PR state: DEGRADED/);
});

test('scan: section 1 flags the half-delivered plan with its fix command', () => {
  assert.match(report, /2026-01-01-alpha\.md — phase 'Delivered' but symlink still in plans\/active\//);
  assert.match(report, /fix: git rm plans\/active\/alpha\.md && ln -s \.\.\/2026-01-01-alpha\.md plans\/delivered\/alpha\.md && git add -A/);
});

test('scan: section 2 flags the merged-but-not-delivered front-matter plan', () => {
  assert.match(report, /2026-01-02-beta\.md — impl branch merged to main, plan still Approved \(PRs: 1\)/);
  assert.match(report, /consider: \/plot-deliver beta/);
});

test('scan: section 3 lists merged branch as deletion candidate, unmerged as orphan', () => {
  assert.match(report, /origin\/feature\/beta — merged into main, no open PR → deletion candidate/);
  assert.match(report, /origin\/bug\/gamma — ahead of main, no open PR → orphan/);
});

test('scan: section 4 shows divergence for the active plan branch', () => {
  assert.match(report, /bug\/gamma — 1 ahead \/ 0 behind origin\/main/);
});

test('scan: section 5 reports legacy and orphaned plans, with symlink fix', () => {
  assert.match(report, /2026-01-04-legacy\.md — no phase field \(pre-plot \/ legacy plan\)/);
  assert.match(report, /2026-01-05-omega\.md — phase 'Approved' but NO symlink/);
  assert.match(report, /fix: ln -s \.\.\/2026-01-05-omega\.md plans\/active\/omega\.md/);
});

test('scan: section 1 flags a Superseded plan still symlinked in active/ (terminal drift)', () => {
  assert.match(report, /2026-01-06-sigma\.md — phase 'Superseded' \(terminal\) but symlink still in plans\/active\//);
  assert.match(report, /fix: git rm plans\/active\/sigma\.md && ln -s \.\.\/2026-01-06-sigma\.md plans\/delivered\/sigma\.md && git add -A/);
});

test('scan: section 5 routes a Superseded orphan fix to delivered/, not active/', () => {
  assert.match(report, /2026-01-07-tau\.md — phase 'Superseded' but NO symlink/);
  assert.match(report, /fix: ln -s \.\.\/2026-01-07-tau\.md plans\/delivered\/tau\.md/);
  // Guard against regression to the old wrong default (active/).
  assert.doesNotMatch(report, /fix: ln -s \.\.\/2026-01-07-tau\.md plans\/active\/tau\.md/);
});

test('scan: healthy plans produce no false findings', () => {
  // gamma is Approved with an unmerged branch and a correct symlink — it must
  // not appear in sections 1, 2, or 5.
  assert.doesNotMatch(report, /2026-01-03-gamma\.md/);
});

test('scan: read-only — the sweep leaves the repo untouched', () => {
  assert.equal(git(repo, 'status', '--porcelain'), '');
});

test('scan: summary footer carries machine-countable finding counts', () => {
  // The one line consumers (the /plot hygiene hook, Automation Output) parse.
  // drift: alpha (delivered-in-active) + sigma (superseded-in-active).
  // merged_not_delivered: beta. stale: feature/beta (merged) + bug/gamma
  // (orphan). claims: none — every branch here carries real commits, so the
  // reaper's empty-claim classification finds nothing. attention: legacy +
  // omega + tau (superseded orphan). concurrent: beta + gamma branches of
  // active plans (sigma has no branch).
  const last = report.trim().split('\n').at(-1);
  assert.equal(last,
    'summary: drift=2 merged_not_delivered=1 stale=2 claims=0 attention=3 concurrent=2 pr_source=degraded main=main');
});

test('scan: --offline skips git-host PR enumeration and reports pr_source=off', () => {
  // A separate run with --offline. The fixture origin is a local path (no
  // git host), so a plain run is already `degraded`; --offline must instead
  // report the deliberate-skip state `off` and the "skipped (--no-pr)" banner.
  const offline = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: repo });
  assert.match(offline, /PR state: skipped \(--no-pr\)/);
  const last = offline.trim().split('\n').at(-1);
  assert.match(last, /\bpr_source=off\b/);
});

test('scan: refuses to run (exit 1) when jq is missing — never a silent false-clean', () => {
  // Build a PATH that resolves every tool the scan needs EXCEPT jq, so
  // `command -v jq` fails. A missing jq must abort loudly, not report drift=0.
  const cleanBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-nojq-'));
  try {
    for (const tool of ['git', 'dirname', 'basename', 'sed', 'grep', 'awk',
                        'readlink', 'cat', 'env', 'tr', 'bash']) {
      let resolved;
      try {
        resolved = execFileSync('/usr/bin/env', ['which', tool], { encoding: 'utf8' }).trim();
      } catch { continue; }
      if (resolved) fs.symlinkSync(resolved, path.join(cleanBin, tool));
    }
    let err;
    try {
      execFileSync('bash', [scan, '--no-fetch'],
        { encoding: 'utf8', cwd: repo, stdio: 'pipe', env: { ...process.env, PATH: cleanBin } });
    } catch (e) { err = e; }
    assert.ok(err, 'scan should exit non-zero when jq is absent');
    assert.match(String(err.stderr), /jq is required/);
  } finally {
    fs.rmSync(cleanBin, { recursive: true, force: true });
  }
});

test('scan: refuses to run outside a git repository', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-nogit-'));
  try {
    assert.throws(() => execFileSync('bash', [scan, '--no-fetch'],
      { encoding: 'utf8', cwd: bare, stdio: 'pipe' }));
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Single-PR plans (section 2, second signal).
//
// A SEPARATE fixture, because this one needs what the fixture above
// deliberately lacks: a github.com origin URL and a gh on PATH, so the scan
// takes its gh branch instead of reporting DEGRADED. The shape reproduced here
// is the one that hung undetected for five weeks — plan and implementation on
// ONE idea branch, its PR merged, the branch DELETED at merge, and the plan
// recording no PR number at all. The old check iterated `git branch -r
// --merged` looking for a ref that no longer exists, so it could never hit.
// ---------------------------------------------------------------------------

let sprTmp, sprRepo, sprBin;

// Stub gh: answers the two bundled list calls the scan makes and records each
// invocation's argv so the limit and repo pin can be asserted, not assumed.
function makeGhStub(dir, mergedLines, { openLines = '' } = {}) {
  const argvLog = path.join(dir, 'gh.argv');
  const emit = (lines) =>
    lines.split('\n').filter(Boolean).map((l) => `printf '%s\\n' ${JSON.stringify(l)}`).join('\n');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}
case "$*" in
  *"--state merged"*) ${emit(mergedLines) || 'true'} ;;
  *"--state open"*)   ${emit(openLines) || 'true'} ;;
esac
exit 0
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return argvLog;
}

function runSinglePrScan(mergedLines, extraArgs = []) {
  sprBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-gh-'));
  const argvLog = makeGhStub(sprBin, mergedLines);
  const out = execFileSync('bash', [scan, '--no-fetch', ...extraArgs], {
    encoding: 'utf8',
    cwd: sprRepo,
    env: { ...process.env, PATH: `${sprBin}:${process.env.PATH}` },
  });
  return { out, argv: fs.existsSync(argvLog) ? fs.readFileSync(argvLog, 'utf8') : '' };
}

// One report line at a time. Whole-output regexes have fooled this suite three
// times by matching across separate findings or into the summary footer.
const lineMatching = (out, re) => out.split('\n').filter((l) => re.test(l));

before(() => {
  sprTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-spr-'));
  const origin = path.join(sprTmp, 'origin.git');
  sprRepo = path.join(sprTmp, 'repo');
  git(sprTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(sprTmp, 'clone', '-q', origin, sprRepo);
  git(sprRepo, 'config', 'user.email', 'test@example.invalid');
  git(sprRepo, 'config', 'user.name', 'Plot Test');
  git(sprRepo, 'config', 'commit.gpgsign', 'false');
  // The scan reads origin's URL to pick its host adapter; point it at
  // github.com while keeping the real local path as a second remote to push to.
  git(sprRepo, 'remote', 'set-url', 'origin', 'https://github.com/plot-pm/fixture.git');
  git(sprRepo, 'remote', 'add', 'store', origin);

  const w = (rel, content) => {
    const p = path.join(sprRepo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };

  w('CLAUDE.md', `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`);

  // The single-PR plan: its branch is NEVER pushed (deleted at merge), and it
  // records no PR number — the two facts that together defeated the old check.
  w('plans/2026-01-10-solo.md', `# Solo

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`idea/solo\` — plan + impl, one PR
`);
  // A fan-out plan whose branch still exists and is merged — the pre-existing
  // signal. It must keep being found by the branch check alone.
  w('plans/2026-01-11-fanout.md', `# Fanout

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/fanout\` — impl → #7
`);
  // An Approved plan whose branch is neither merged nor a merged-PR head.
  // Guards against the new signal manufacturing findings.
  w('plans/2026-01-12-live.md', `# Live

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

- \`bug/live\` — in flight
`);

  fs.mkdirSync(path.join(sprRepo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(sprRepo, 'plans', 'delivered'), { recursive: true });
  for (const [link, target] of [['solo.md', '../2026-01-10-solo.md'],
                                ['fanout.md', '../2026-01-11-fanout.md'],
                                ['live.md', '../2026-01-12-live.md']]) {
    fs.symlinkSync(target, path.join(sprRepo, 'plans', 'active', link));
  }

  git(sprRepo, 'add', '-A');
  git(sprRepo, 'commit', '-q', '-m', 'plans');

  // feature/fanout: merged AND still on origin (existing signal intact).
  git(sprRepo, 'checkout', '-q', '-b', 'feature/fanout');
  w('fanout.txt', 'done\n');
  git(sprRepo, 'add', 'fanout.txt');
  git(sprRepo, 'commit', '-q', '-m', 'fanout impl');
  git(sprRepo, 'checkout', '-q', 'main');
  git(sprRepo, 'merge', '-q', '--no-ff', '--no-edit', 'feature/fanout');

  // bug/live: unmerged work, still on origin.
  git(sprRepo, 'checkout', '-q', '-b', 'bug/live');
  w('live.txt', 'wip\n');
  git(sprRepo, 'add', 'live.txt');
  git(sprRepo, 'commit', '-q', '-m', 'live wip');
  git(sprRepo, 'checkout', '-q', 'main');

  // idea/solo is deliberately never pushed — the ref is gone, as after a
  // merge-and-delete. Only the merged PR list can testify that it landed.
  git(sprRepo, 'push', '-q', 'store', 'main', 'feature/fanout', 'bug/live');
  git(sprRepo, 'fetch', '-q', 'store');
  // Re-point the remote-tracking refs the scan reads (origin/*) at what we
  // pushed, since origin's URL is now a github.com placeholder.
  for (const b of ['main', 'feature/fanout', 'bug/live']) {
    git(sprRepo, 'update-ref', `refs/remotes/origin/${b}`, `refs/remotes/store/${b}`);
  }
  git(sprRepo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
});
after(() => {
  fs.rmSync(sprTmp, { recursive: true, force: true });
  if (sprBin) fs.rmSync(sprBin, { recursive: true, force: true });
});

test('scan: section 2 finds a single-PR plan whose branch was deleted at merge', () => {
  const { out } = runSinglePrScan('40 idea/solo');
  const hits = lineMatching(out, /2026-01-10-solo\.md/);
  assert.equal(hits.length, 1, `expected exactly one solo finding, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /impl branch merged to main, plan still Approved/);
  // The plan records no PR number — the finding must not depend on one.
  assert.match(hits[0], /\(PRs: none-linked\)/);
  const head = lineMatching(out, /merged PR head:/);
  assert.equal(head.length, 1);
  assert.match(head[0], /#40 \(idea\/solo\)/);
  assert.equal(lineMatching(out, /consider: \/plot-deliver solo$/).length, 1);
});

test('scan: the deleted branch is genuinely absent — the old check could not match it', () => {
  // Pins the premise of the fix rather than trusting the fixture: if idea/solo
  // ever gained a ref, this test would pass for the wrong reason.
  assert.throws(() => git(sprRepo, 'rev-parse', '--verify', 'refs/remotes/origin/idea/solo'));
  const merged = git(sprRepo, 'branch', '-r', '--merged', 'origin/main');
  assert.doesNotMatch(merged, /idea\/solo/);
});

test('scan: fan-out plans keep being found by the branch signal alone', () => {
  // Merged-PR list omits feature/fanout entirely — the existing merged-branch
  // check must still report it, proving the two signals are OR-ed, not swapped.
  const { out } = runSinglePrScan('40 idea/solo');
  const hits = lineMatching(out, /2026-01-11-fanout\.md/);
  assert.equal(hits.length, 1, `expected exactly one fanout finding, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /impl branch merged to main, plan still Approved \(PRs: 7\)/);
});

test('scan: an unmerged plan branch produces no section-2 finding', () => {
  const { out } = runSinglePrScan('40 idea/solo');
  assert.equal(lineMatching(out, /2026-01-12-live\.md/).length, 0);
});

test('scan: a merged PR head that no plan names invents nothing', () => {
  // An unrelated merged PR must not create a finding, nor attach itself to one.
  const { out } = runSinglePrScan('40 idea/solo\n41 feature/unrelated');
  assert.equal(lineMatching(out, /feature\/unrelated/).length, 0);
  assert.equal(lineMatching(out, /merged PR head:/).length, 1);
});

test('scan: merged-PR fetch is one bundled call, repo-pinned, with a raised limit', () => {
  // Per-plan pr-state calls would cost 0.61 s each; this must stay constant in
  // plan count. The limit must exceed gh's default page of 30, or old plans —
  // this check's own failure mode — go silently unseen.
  const { argv } = runSinglePrScan('40 idea/solo');
  const mergedCalls = argv.split('\n').filter((l) => l.includes('--state merged'));
  assert.equal(mergedCalls.length, 1, `expected 1 merged-PR call, got ${mergedCalls.length}`);
  assert.match(mergedCalls[0], /-R plot-pm\/fixture/);
  const limit = Number(mergedCalls[0].match(/--limit (\d+)/)?.[1]);
  assert.ok(limit > 30, `limit ${limit} must exceed gh's default page size of 30`);
});

test('scan: --offline makes no host call and says the check was skipped', () => {
  const { out, argv } = runSinglePrScan('40 idea/solo', ['--offline']);
  assert.equal(argv, '', 'no gh call may happen under --offline');
  // Absent-because-skipped must be stated, not silent: a quiet "(none)" here is
  // exactly the "silence reads as health" defect this section was fixed for.
  assert.equal(lineMatching(out, /2026-01-10-solo\.md/).length, 0);
  const note = lineMatching(out, /merged-PR heads not consulted/);
  assert.equal(note.length, 1);
  assert.match(note[0], /pr_source=off/);
});

test('scan: section-2 counts in the summary footer stay exact', () => {
  const { out } = runSinglePrScan('40 idea/solo');
  const last = out.trim().split('\n').at(-1);
  // solo (merged-PR head) + fanout (merged branch) = 2; live is in flight.
  assert.match(last, /\bmerged_not_delivered=2\b/);
});
