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
// Split the report by its `== N. … ==` headings → { '1': body, '2': body, … }.
// Section-scoped assertions are what make the severity split testable: "omega
// appears in the report" was true before and after this change; "omega appears
// in 7 and NOT in 5" is the actual contract.
function splitSections(text) {
  const out = {};
  let cur = null;
  for (const line of text.split('\n')) {
    const m = /^== (\d+)\. /.exec(line);
    if (m) { cur = m[1]; out[cur] = ''; continue; }
    if (cur) out[cur] += line + '\n';
  }
  return out;
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
  // Section 7a: a file with no phase field — not a plan (#254's rule), so it
  // is a convenience-level note, NOT an attention finding.
  write('plans/2026-01-04-legacy.md', `# Legacy pre-plot notes\n`);
  // Section 7b: plot-managed plan with no symlink in either index. Visible to
  // the derived phase grouping since #254 — a browsing gap, not an orphan.
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
  // Section 7 (terminal routing): a Superseded plan with NO symlink — its
  // suggested link must target delivered/ (the terminal index), not active/.
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
  // Section 5: a link whose target does not exist. THE CONTRAST the advisory
  // demotion has to preserve — a missing link is a browsing gap (section 7),
  // a link pointing at nothing is a broken pointer and still needs attention.
  fs.symlinkSync('../2026-01-99-vanished.md', path.join(repo, 'plans', 'active', 'vanished.md'));

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

test('scan: section 7 reports an unlinked plan at convenience level, not as attention', () => {
  // Since #254 the phase grouping is derived from plan content, so an unlinked
  // plan is fully visible and the old "(orphaned)" verdict expired. It stays
  // listed — the symlink is still a browsing convenience — but as `optional:`
  // in section 7, and it must not appear in section 5.
  const sections = splitSections(report);
  assert.match(sections['7'], /2026-01-05-omega\.md — phase 'Approved', no symlink in plans\/active\/ or plans\/delivered\/ \(browsing only\)/);
  assert.match(sections['7'], /optional: ln -s \.\.\/2026-01-05-omega\.md plans\/active\/omega\.md/);
  assert.doesNotMatch(sections['5'], /2026-01-05-omega\.md/);
  // The word that expired must be gone from the whole report for this plan.
  assert.doesNotMatch(report, /2026-01-05-omega\.md[^\n]*orphaned/);
});

test('scan: section 7 calls a phase-less file a non-plan, agreeing with plot-fleet-scan.sh', () => {
  // #254 decided a file whose phase parses as NONE is not a plan. This script
  // used to call the same file a plan needing attention; that split is closed
  // in #254's direction, and the file stays visible at convenience level.
  const sections = splitSections(report);
  assert.match(sections['7'], /2026-01-04-legacy\.md — no phase field → not a plan/);
  assert.doesNotMatch(sections['5'], /2026-01-04-legacy\.md/);
});

test('scan: section 5 still flags a DANGLING index symlink as attention', () => {
  // The contrast the demotion must preserve: no link is cosmetic, a link
  // pointing at nothing is a broken pointer. No fix command is offered —
  // repoint or remove is a judgment the script cannot make.
  const sections = splitSections(report);
  assert.match(sections['5'], /plans\/active\/vanished\.md — symlink target missing: \.\.\/2026-01-99-vanished\.md \(dangling index link\)/);
  assert.doesNotMatch(sections['7'], /vanished\.md/);
});

test('scan: section 1 flags a Superseded plan still symlinked in active/ (terminal drift)', () => {
  assert.match(report, /2026-01-06-sigma\.md — phase 'Superseded' \(terminal\) but symlink still in plans\/active\//);
  assert.match(report, /fix: git rm plans\/active\/sigma\.md && ln -s \.\.\/2026-01-06-sigma\.md plans\/delivered\/sigma\.md && git add -A/);
});

test('scan: section 7 routes an unlinked Superseded plan to delivered/, not active/', () => {
  const sections = splitSections(report);
  assert.match(sections['7'], /2026-01-07-tau\.md — phase 'Superseded', no symlink/);
  assert.match(sections['7'], /optional: ln -s \.\.\/2026-01-07-tau\.md plans\/delivered\/tau\.md/);
  // Guard against regression to the old wrong default (active/) — issue #33.
  assert.doesNotMatch(report, /ln -s \.\.\/2026-01-07-tau\.md plans\/active\/tau\.md/);
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
  // reaper's empty-claim classification finds nothing. attention: the DANGLING
  // active/vanished.md link ALONE — legacy, omega and tau moved to index_drift
  // when the derived phase grouping (#254) made an unlinked plan visible, and
  // asserting the NUMBER is what proves the demotion rather than a reworded
  // line. concurrent: beta + gamma branches of active plans (sigma has none).
  const last = report.trim().split('\n').at(-1);
  assert.equal(last,
    'summary: drift=2 merged_not_delivered=1 stale=2 claims=0 attention=1 concurrent=2 unreleased_delivered=1 index_drift=3 pr_source=degraded main=main');
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
// Both list calls answer in "<number> <head>" lines — the shape the scan's
// --jq produces for `--json number,headRefName`.
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

// --- Section 6: delivered plans already inside a release tag ---------------
//
// The fourth phase went unreached for sixteen releases because nothing
// compared two facts: a version shipped, and the plans describing it stayed at
// Delivered. Neither side was wrong alone, so neither complained.

test('scan: the US separator never leaks into a report line', () => {
  // Adding `type` as an eighth field broke section 2 until every read loop
  // named it: an unread trailing field lands in the last one READ, separator
  // and all, printing "(PRs: 1\x1Ffeature)". Same class as the tab-collapse
  // bugs this suite has caught twice — pinned so a ninth field cannot repeat it.
  const report = execFileSync('bash', [scan, '--no-pr'], { encoding: 'utf8', cwd: repo });
  assert.ok(!report.includes('\x1f'),
    'no report line may contain the field separator');
});

test('scan: section 6 exists and the footer counts it', () => {
  const report = execFileSync('bash', [scan, '--no-pr'], { encoding: 'utf8', cwd: repo });
  assert.match(report, /^== 6\. Delivered but already released/m);
  const footer = report.trim().split('\n').at(-1);
  assert.match(footer, /unreleased_delivered=\d+/,
    'the sweep stays machine-countable — every section contributes a counter');
});

test('scan: a delivered plan with no PR annotation is unresolvable, not silent', () => {
  // "Cannot tell" and "nothing wrong" must not look the same — that
  // indistinguishability is the whole reason this section exists.
  const report = execFileSync('bash', [scan, '--no-pr'], { encoding: 'utf8', cwd: repo });
  const line = report.split('\n').find((l) => l.includes('alpha.md') && l.includes('cannot resolve'));
  assert.ok(line, 'a delivered plan without a PR reference must be reported, not skipped');
  assert.match(line, /no PR annotation/);
});

// ---------------------------------------------------------------------------
// Contained in an open PR versus orphaned (section 3).
//
// A THIRD fixture: like the single-PR one it needs a github.com origin and a
// gh on PATH, but it needs OPEN PRs rather than merged ones, and a branch
// stack. The shape reproduced here is the one that made seven of eight `stale=`
// entries false on this repo — branches sitting below the head of one open PR.
// The scan asked only "is this branch the PR's head"; being contained in one
// was invisible, so ordinary stacked work read as abandoned.
// ---------------------------------------------------------------------------

let cipTmp, cipRepo, cipBin;

function runContainedScan(openLines, extraArgs = []) {
  cipBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-cip-'));
  makeGhStub(cipBin, '', { openLines });
  return execFileSync('bash', [scan, '--no-fetch', ...extraArgs], {
    encoding: 'utf8',
    cwd: cipRepo,
    env: { ...process.env, PATH: `${cipBin}:${process.env.PATH}` },
  });
}

// The section-3 body only — every assertion below is about branch classifica-
// tion, and the summary footer repeats the words "stale" and "claims". Slicing
// first is what keeps a footer match from passing for a report line.
function section3(out) {
  const lines = out.split('\n');
  const start = lines.findIndex((l) => /^== 3\. Stale branches/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^== 4\./.test(l));
  assert.ok(start >= 0 && end > start, 'section 3 must be present');
  return lines.slice(start + 1, end);
}

before(() => {
  cipTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-cip-repo-'));
  const origin = path.join(cipTmp, 'origin.git');
  cipRepo = path.join(cipTmp, 'repo');
  git(cipTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(cipTmp, 'clone', '-q', origin, cipRepo);
  git(cipRepo, 'config', 'user.email', 'test@example.invalid');
  git(cipRepo, 'config', 'user.name', 'Plot Test');
  git(cipRepo, 'config', 'commit.gpgsign', 'false');
  git(cipRepo, 'remote', 'set-url', 'origin', 'https://github.com/plot-pm/fixture.git');
  git(cipRepo, 'remote', 'add', 'store', origin);

  const w = (rel, content) => {
    const p = path.join(cipRepo, rel);
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
  w('plans/2026-01-20-stack.md', `# Stack

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

- \`feature/stack-base\` — lower slice, ancestor of the PR head
- \`feature/stack-top\` — upper slice, the PR head
- \`bug/empty-claim\` — claimed, no work yet
- \`bug/worked-claim\` — the same claim with work on it
- \`bug/really-orphan\` — nobody's
`);
  fs.mkdirSync(path.join(cipRepo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(cipRepo, 'plans', 'delivered'), { recursive: true });
  fs.symlinkSync('../2026-01-20-stack.md', path.join(cipRepo, 'plans', 'active', 'stack.md'));
  git(cipRepo, 'add', '-A');
  git(cipRepo, 'commit', '-q', '-m', 'plans');

  // feature/stack-base: real work, unmerged, head of NO PR.
  git(cipRepo, 'checkout', '-q', '-b', 'feature/stack-base');
  w('base.txt', 'base\n');
  git(cipRepo, 'add', 'base.txt');
  git(cipRepo, 'commit', '-q', '-m', 'base slice');
  // feature/stack-top: builds on it and IS the head of open PR #200, so base
  // is contained in that PR.
  git(cipRepo, 'checkout', '-q', '-b', 'feature/stack-top');
  w('top.txt', 'top\n');
  git(cipRepo, 'add', 'top.txt');
  git(cipRepo, 'commit', '-q', '-m', 'top slice');

  // bug/empty-claim: a bare claim commit. bug/worked-claim carries that same
  // commit plus real work and is the head of open PR #201 — so the empty claim
  // IS an ancestor of an open PR head. This is the ordering case: claim first.
  git(cipRepo, 'checkout', '-q', 'main');
  git(cipRepo, 'checkout', '-q', '-b', 'bug/empty-claim');
  git(cipRepo, 'commit', '-q', '--allow-empty', '-m', 'plot: claim bug/empty-claim');
  git(cipRepo, 'checkout', '-q', '-b', 'bug/worked-claim');
  w('work.txt', 'work\n');
  git(cipRepo, 'add', 'work.txt');
  git(cipRepo, 'commit', '-q', '-m', 'worker output');

  // bug/really-orphan: real work, unmerged, ancestor of nothing.
  git(cipRepo, 'checkout', '-q', 'main');
  git(cipRepo, 'checkout', '-q', '-b', 'bug/really-orphan');
  w('orphan.txt', 'wip\n');
  git(cipRepo, 'add', 'orphan.txt');
  git(cipRepo, 'commit', '-q', '-m', 'orphan wip');

  const branches = ['feature/stack-base', 'feature/stack-top', 'bug/empty-claim',
                    'bug/worked-claim', 'bug/really-orphan'];
  git(cipRepo, 'checkout', '-q', 'main');
  git(cipRepo, 'push', '-q', 'store', 'main', ...branches);
  git(cipRepo, 'fetch', '-q', 'store');
  for (const b of ['main', ...branches]) {
    git(cipRepo, 'update-ref', `refs/remotes/origin/${b}`, `refs/remotes/store/${b}`);
  }
  git(cipRepo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
});
after(() => {
  fs.rmSync(cipTmp, { recursive: true, force: true });
  if (cipBin) fs.rmSync(cipBin, { recursive: true, force: true });
});

const OPEN_PRS = '200 feature/stack-top\n201 bug/worked-claim';

test('scan: the fixture really is a stack — the premise, not the fixture, is pinned', () => {
  // If stack-base ever stopped being an ancestor of the PR head, the tests
  // below would pass for the wrong reason.
  git(cipRepo, 'merge-base', '--is-ancestor',
      'origin/feature/stack-base', 'origin/feature/stack-top');
  git(cipRepo, 'merge-base', '--is-ancestor',
      'origin/bug/empty-claim', 'origin/bug/worked-claim');
});

test('scan: a branch contained in an open PR is reported as contained, not orphaned', () => {
  const body = section3(runContainedScan(OPEN_PRS));
  const hits = body.filter((l) => l.includes('feature/stack-base'));
  assert.equal(hits.length, 1, `expected one stack-base line, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /contained in open PR #200 → not orphaned$/);
  assert.doesNotMatch(hits[0], /orphan \(needs judgment\)/);
});

test('scan: a contained branch does not count toward stale=', () => {
  const out = runContainedScan(OPEN_PRS);
  const footer = out.trim().split('\n').at(-1);
  // bug/really-orphan alone. Before the fix feature/stack-base counted too.
  assert.match(footer, /\bstale=1\b/);
  assert.match(footer, /\bclaims=1\b/);
});

test('scan: a genuine orphan is still called an orphan', () => {
  // The fix must not turn the section off: a branch that is an ancestor of no
  // open PR head keeps its verdict.
  const body = section3(runContainedScan(OPEN_PRS));
  const hits = body.filter((l) => l.includes('bug/really-orphan') && !l.includes('inspect:'));
  assert.equal(hits.length, 1, `expected one really-orphan line, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /ahead of main, no open PR → orphan \(needs judgment\)$/);
});

test('scan: the claim check wins over containment for a claim with work on it', () => {
  // THE ORDERING. bug/empty-claim is an ancestor of bug/worked-claim, the head
  // of open PR #201 — so containment WOULD fire on it. It must still report as
  // a claim, the more specific fact. Running the containment test first makes
  // this line read "contained in open PR #201" and drops claims= to 0, silently.
  const body = section3(runContainedScan(OPEN_PRS));
  const hits = body.filter((l) => l.includes('bug/empty-claim') && !l.includes('inspect:'));
  assert.equal(hits.length, 1, `expected one empty-claim line, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /still claimed, no commits/);
  assert.doesNotMatch(hits[0], /contained in open PR/);
});

test('scan: the head of an open PR is not listed at all — neither stale nor contained', () => {
  // feature/stack-top and bug/worked-claim are PR heads: live work, skipped
  // before either verdict. Containment must not resurrect them as findings.
  const body = section3(runContainedScan(OPEN_PRS));
  assert.equal(body.filter((l) => l.includes('feature/stack-top')).length, 0);
  assert.equal(body.filter((l) => l.includes('bug/worked-claim')).length, 0);
});

test('scan: with no open PRs, containment invents nothing and the stack is orphaned', () => {
  // Guards the other direction: the containment branch must depend on the open
  // PR list, not on branch shape. With an empty list every unmerged branch is
  // an orphan again — the pre-fix answer, now only for the pre-fix input.
  const out = runContainedScan('');
  const body = section3(out);
  assert.equal(body.filter((l) => l.includes('contained in open PR')).length, 0);
  const base = body.filter((l) => l.includes('feature/stack-base') && !l.includes('inspect:'));
  assert.equal(base.length, 1);
  assert.match(base[0], /→ orphan \(needs judgment\)$/);
});

test('scan: open-PR heads are fetched with their numbers, in one bundled call', () => {
  // The number is what lets section 3 name the PR. Fetching it must not cost a
  // second host call — the field rides along on the call already being made.
  cipBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-cip-'));
  const argvLog = makeGhStub(cipBin, '', { openLines: OPEN_PRS });
  execFileSync('bash', [scan, '--no-fetch'], {
    encoding: 'utf8', cwd: cipRepo,
    env: { ...process.env, PATH: `${cipBin}:${process.env.PATH}` },
  });
  const openCalls = fs.readFileSync(argvLog, 'utf8').split('\n')
    .filter((l) => l.includes('--state open'));
  assert.equal(openCalls.length, 1, `expected 1 open-PR call, got ${openCalls.length}`);
  assert.match(openCalls[0], /--json number,headRefName/);
  assert.match(openCalls[0], /-R plot-pm\/fixture/);
});

test('scan: containment is skipped, not guessed, when PR state is unavailable', () => {
  // --offline makes no host call, so there is no open-PR list to test against.
  // The scan must fall back to the old verdict rather than assert containment
  // it did not check.
  const out = runContainedScan(OPEN_PRS, ['--offline']);
  const body = section3(out);
  assert.equal(body.filter((l) => l.includes('contained in open PR')).length, 0);
  assert.match(out, /PR state: skipped \(--no-pr\)/);
});
