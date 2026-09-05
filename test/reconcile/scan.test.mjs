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
  // Section 8a: a file with no phase field — not a plan (#254's rule), so it
  // is a convenience-level note, NOT an attention finding.
  write('plans/2026-01-04-legacy.md', `# Legacy pre-plot notes\n`);
  // Section 8b: plot-managed plan with no symlink in either index. Visible to
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
  // Section 8 (terminal routing): a Superseded plan with NO symlink — its
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
  // demotion has to preserve — a missing link is a browsing gap (section 9),
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

test('scan: section 10 reports an unlinked plan at convenience level, not as attention', () => {
  // Since #254 the phase grouping is derived from plan content, so an unlinked
  // plan is fully visible and the old "(orphaned)" verdict expired. It stays
  // listed — the symlink is still a browsing convenience — but as `optional:`
  // in index drift (section 10 since the unsliced-wave, prose-name, and sprint-drift
  // sections took 7, 8 and 9), and it must not appear in section 5.
  const sections = splitSections(report);
  assert.match(sections['10'], /2026-01-05-omega\.md — phase 'Approved', no symlink in plans\/active\/ or plans\/delivered\/ \(browsing only\)/);
  assert.match(sections['10'], /optional: ln -s \.\.\/2026-01-05-omega\.md plans\/active\/omega\.md/);
  assert.doesNotMatch(sections['5'], /2026-01-05-omega\.md/);
  // The word that expired must be gone from the whole report for this plan.
  assert.doesNotMatch(report, /2026-01-05-omega\.md[^\n]*orphaned/);
});

test('scan: section 10 calls a phase-less file a non-plan, agreeing with plot-fleet-scan.sh', () => {
  // #254 decided a file whose phase parses as NONE is not a plan. This script
  // used to call the same file a plan needing attention; that split is closed
  // in #254's direction, and the file stays visible at convenience level
  // (index drift, section 10 since the unsliced-wave, prose-name, and sprint-drift
  // sections took 7, 8 and 9).
  const sections = splitSections(report);
  assert.match(sections['10'], /2026-01-04-legacy\.md — no phase field → not a plan/);
  assert.doesNotMatch(sections['5'], /2026-01-04-legacy\.md/);
});

test('scan: section 5 still flags a DANGLING index symlink as attention', () => {
  // The contrast the demotion must preserve: no link is cosmetic, a link
  // pointing at nothing is a broken pointer. No fix command is offered —
  // repoint or remove is a judgment the script cannot make.
  const sections = splitSections(report);
  assert.match(sections['5'], /plans\/active\/vanished\.md — symlink target missing: \.\.\/2026-01-99-vanished\.md \(dangling index link\)/);
  assert.doesNotMatch(sections['10'], /vanished\.md/);
});

test('scan: section 1 flags a Superseded plan still symlinked in active/ (terminal drift)', () => {
  assert.match(report, /2026-01-06-sigma\.md — phase 'Superseded' \(terminal\) but symlink still in plans\/active\//);
  assert.match(report, /fix: git rm plans\/active\/sigma\.md && ln -s \.\.\/2026-01-06-sigma\.md plans\/delivered\/sigma\.md && git add -A/);
});

test('scan: section 10 routes an unlinked Superseded plan to delivered/, not active/', () => {
  const sections = splitSections(report);
  assert.match(sections['10'], /2026-01-07-tau\.md — phase 'Superseded', no symlink/);
  assert.match(sections['10'], /optional: ln -s \.\.\/2026-01-07-tau\.md plans\/delivered\/tau\.md/);
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
  // uncut_slices: 0 — every plan in this fixture carries at most one branch
  // per wave, so that section is silent and contributes a zero counter.
  // prose_slice_names: 0 — every slice name in this fixture is a label, so the
  // prose-name section is silent too and contributes its own zero counter.
  // sprint_drift: 0 — the fixture has no sprint files, so the section is silent.
  // stale_tally: 0 — no sprint files, so section 11 is also silent.
  // double_claims: 0 — every branch in this fixture is named by exactly one
  // plan, so section 12 is silent; its collision case has its own fixture.
  // rounds_drift: 0 — no plan here is Draft and none records a Rounds: value,
  // so section 13 is silent; its stale-round case has its own fixture.
  const last = report.trim().split('\n').at(-1);
  assert.equal(last,
    'summary: drift=2 merged_not_delivered=1 stale=2 claims=0 attention=1 concurrent=2 unreleased_delivered=1 uncut_slices=0 prose_slice_names=0 sprint_drift=0 stale_tally=0 index_drift=3 double_claims=0 rounds_drift=0 pr_source=degraded main=main');
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
// THE STUB EMITS WHAT `gh --json` EMITS: a JSON array of PR objects.
//
// It printed `"<number> <head>"` text lines until 2026-09-05, because the scan
// passed `--jq` and read the already-flattened result. The scan now asks
// through `plot-host.sh`, which requests raw `--json` and flattens with its own
// `jq` — so a stub printing flattened text would be reproducing a call shape no
// caller makes any more, and would pass while the real CLI's output failed.
//
// The `"<number> <head>"` NOTATION IS KEPT at every call site: it is what the
// tests are about, and rendering it as the host's wire shape belongs in one
// place rather than seven. `title` and `state` ride along because the adapter
// requests them in the same call; the scan reads neither.
function makeGhStub(dir, mergedLines, { openLines = '' } = {}) {
  const argvLog = path.join(dir, 'gh.argv');
  const asJson = (lines, state) => JSON.stringify(
    lines.split('\n').filter(Boolean).map((l) => {
      const [number, ...head] = l.split(' ');
      return { number: Number(number), title: head.join(' '), state, headRefName: head.join(' ') };
    }));
  const emit = (lines, state) => `printf '%s' ${JSON.stringify(asJson(lines, state))}`;
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}
case "$*" in
  *"--state merged"*) ${emit(mergedLines, 'MERGED')} ;;
  *"--state open"*)   ${emit(openLines, 'OPEN')} ;;
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
  // BOTH FIELDS ON THE ONE CALL — the property, not the field string. The
  // assertion named `--json number,headRefName` exactly until 2026-09-05, which
  // pinned the scan's private query rather than what it needs: `plot-host.sh`
  // asks for `number,title,state,headRefName` in the same single call, and the
  // old regex failed on a routing change that cost no extra round trip.
  assert.match(openCalls[0], /--json [^ ]*\bnumber\b/);
  assert.match(openCalls[0], /--json [^ ]*\bheadRefName\b/);
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

// ---------------------------------------------------------------------------
// Section 7: unsliced waves (a `### ` heading carrying more than one branch).
//
// A FOURTH fixture. This section is pure plan parsing — it reads the parser's
// waves[] and needs no git host — so the repo is minimal, like the first
// fixture, and runs --offline. The properties under test are the ones the plan
// line names: a multi-branch wave is reported ONCE with its file/heading/count;
// single-branch-only plans are silent; a phase-less file is skipped; the footer
// counter matches the number of findings; and — the property a naive
// implementation breaks — `attention=` is unchanged by an unsliced wave.
// ---------------------------------------------------------------------------

let uwTmp, uwRepo, uwReport, uwSections;

before(() => {
  uwTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-uw-'));
  const origin = path.join(uwTmp, 'origin.git');
  uwRepo = path.join(uwTmp, 'repo');
  git(uwTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(uwTmp, 'clone', '-q', origin, uwRepo);
  git(uwRepo, 'config', 'user.email', 'test@example.invalid');
  git(uwRepo, 'config', 'user.name', 'Plot Test');
  git(uwRepo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(uwRepo, rel);
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

  // A plan with a FIVE-branch wave — the shape /plot-reslice repairs. It must be
  // reported ONCE, with its file, its heading, and count 5, never five times.
  // The plan also carries a second, one-branch wave that must NOT be reported —
  // proving the count is per-heading, not per-plan.
  w('plans/2026-02-01-tangled.md', `# Tangled

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Tracer
- \`feature/tangled-spike\` — the tracer, one branch, must stay silent

### Implementation
- \`feature/tangled-one\` — first
- \`feature/tangled-two\` — second
- \`feature/tangled-three\` — third
- \`feature/tangled-four\` — fourth
- \`feature/tangled-five\` — fifth
`);

  // A plan whose waves each hold exactly one branch — must be entirely silent.
  w('plans/2026-02-02-tidy.md', `# Tidy

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### First
- \`feature/tidy-a\` — alone

### Second
- \`feature/tidy-b\` — alone
`);

  // A plan in the NEW ## Waves spelling whose one wave carries a single branch
  // (in the heading) and whose prose description names two more branches in
  // backticks. This is where the branch-LINES-not-backticked-names distinction
  // is structurally guaranteed: in ## Waves the branch comes from the heading,
  // so the description's backticked names contribute nothing
  // (a-plan-branch-can-be-a-parser-artifact). The parser reads 1 branch, so the
  // section is silent — a hand-rolled backtick count would wrongly read 3.
  w('plans/2026-02-03-prose.md', `# Prose

## Status

- **Phase:** Approved
- **Type:** docs

## Waves

### Only (Branch: docs/prose-real)
- supersedes \`docs/prose-old\` and \`docs/prose-older\`
`);

  // A phase-less file — a decision log, not a plan. It carries a multi-branch
  // "wave" in a ## Branches section, but with no Phase: it is skipped, the same
  // rule the rest of the scan applies. Catches a second parser that would treat
  // every .md in plans/ as a plan.
  w('plans/2026-02-04-notes.md', `# Worker report, not a plan

## Branches

### Implementation
- \`feature/notes-x\` — one
- \`feature/notes-y\` — two
- \`feature/notes-z\` — three
`);

  // A COMPLETE (delivered) plan with a multi-branch wave. It is history, but the
  // report still counts it — hiding it would lie about the estate; /plot-reslice
  // declines it, which is a constraint on the repair, not on the report.
  w('plans/2026-02-05-shipped.md', `# Shipped

## Status

- **Phase:** Delivered
- **Type:** feature

## Branches

### Landed
- \`feature/shipped-one\` — merged → #10
- \`feature/shipped-two\` — merged → #11
`);

  fs.mkdirSync(path.join(uwRepo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(uwRepo, 'plans', 'delivered'), { recursive: true });
  // Link every plan so index drift (section 9) stays silent — keeps this
  // fixture's footer focused on uncut_slices without unrelated noise.
  fs.symlinkSync('../2026-02-01-tangled.md', path.join(uwRepo, 'plans', 'active', 'tangled.md'));
  fs.symlinkSync('../2026-02-02-tidy.md', path.join(uwRepo, 'plans', 'active', 'tidy.md'));
  fs.symlinkSync('../2026-02-03-prose.md', path.join(uwRepo, 'plans', 'active', 'prose.md'));
  fs.symlinkSync('../2026-02-05-shipped.md', path.join(uwRepo, 'plans', 'delivered', 'shipped.md'));

  git(uwRepo, 'add', '-A');
  git(uwRepo, 'commit', '-q', '-m', 'plans');
  git(uwRepo, 'push', '-q', 'origin', 'main');

  uwReport = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: uwRepo });
  uwSections = splitSections(uwReport);
});
after(() => fs.rmSync(uwTmp, { recursive: true, force: true }));

test('scan: section 7 reports a 5-branch wave once, with its file, heading and count', () => {
  const hits = uwSections['7'].split('\n')
    .filter((l) => l.includes('2026-02-01-tangled.md') && l.includes('carries'));
  assert.equal(hits.length, 1, `expected exactly one tangled finding, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /wave 'Implementation' carries 5 branch lines \(a wave holds one\)/);
  // The one-branch Tracer wave in the same plan must not appear.
  assert.doesNotMatch(uwSections['7'], /wave 'Tracer'/);
  // And the actionable command a person runs — reslice:, not fix:.
  assert.match(uwSections['7'], /reslice: \/plot-reslice tangled/);
});

test('scan: section 7 is silent for a plan whose waves each hold one branch', () => {
  assert.doesNotMatch(uwSections['7'], /2026-02-02-tidy\.md/);
});

test('scan: section 7 counts branch LINES, not backticked names in prose', () => {
  // prose.md has one branch line whose description names two more branches in
  // backticks. Counting names would read it as 3; the parser reads 1, so silent.
  assert.doesNotMatch(uwSections['7'], /2026-02-03-prose\.md/);
});

test('scan: section 7 skips a phase-less file — a decision log is not a plan', () => {
  // notes.md carries a 3-branch wave but no Phase:, so it is not a plan and the
  // section must not report it. Catches a second parser that treats every .md
  // in plans/ as a plan.
  assert.doesNotMatch(uwSections['7'], /2026-02-04-notes\.md/);
});

test('scan: section 7 still counts a complete (delivered) multi-branch wave', () => {
  // A complete wave is history and still counts here — hiding it would lie about
  // the estate. /plot-reslice declines it; that is on the repair, not the report.
  const hits = uwSections['7'].split('\n')
    .filter((l) => l.includes('2026-02-05-shipped.md') && l.includes('carries'));
  assert.equal(hits.length, 1, `expected one shipped finding, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /wave 'Landed' carries 2 branch lines/);
});

test('scan: section 7 footer counter matches the number of findings', () => {
  // tangled (Implementation, 5) + shipped (Landed, 2) = 2 findings. The counter
  // is wired to the same variable the body increments — a footer wired to a
  // different variable is a bug no single-finding assertion above can see.
  const bodyFindings = uwSections['7'].split('\n').filter((l) => l.includes('carries')).length;
  assert.equal(bodyFindings, 2, `expected 2 body findings, got ${bodyFindings}`);
  const footer = uwReport.trim().split('\n').at(-1);
  assert.match(footer, /\buncut_slices=2\b/);
});

test('scan: an unsliced wave leaves attention= unchanged — the section does NOT gate', () => {
  // THE property a naive implementation breaks, and the one every other test
  // above passes without. An unsliced wave is a shape to fix, not a branch that
  // cannot move — /plot-deliver's gate and the /plot hygiene line read
  // attention= from this footer, and a cosmetic finding must not inflate it.
  const footer = uwReport.trim().split('\n').at(-1);
  assert.match(footer, /\battention=0\b/);
});

// ---------------------------------------------------------------------------
// Section 8: prose wave names (a `### ` heading written as a sentence, not a
// label). A FIFTH fixture, minimal like the unsliced one: pure plan parsing
// (reads the parser's long_wave_names), no git host, run --offline. The
// properties under test are the ones the plan line names: a name past the
// threshold is reported ONCE with its file and the name; short-name plans are
// silent; a phase-less file is skipped; the footer counter matches; and — the
// property a naive implementation breaks — `attention=` is unchanged. This
// REPORTS, never refuses: the plan carrying the prose name still parses and its
// branches still count in every other section.
// ---------------------------------------------------------------------------

let pwTmp, pwRepo, pwReport, pwSections;

before(() => {
  pwTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-pw-'));
  const origin = path.join(pwTmp, 'origin.git');
  pwRepo = path.join(pwTmp, 'repo');
  git(pwTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(pwTmp, 'clone', '-q', origin, pwRepo);
  git(pwRepo, 'config', 'user.email', 'test@example.invalid');
  git(pwRepo, 'config', 'user.name', 'Plot Test');
  git(pwRepo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(pwRepo, rel);
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

  // A plan whose second wave is named with a 53-character sentence — the exact
  // shape from the estate. It must be reported ONCE, with its file and the full
  // name. The plan also carries two label-named waves (Shaped, Offered first)
  // that must stay silent — proving the report is per-name, not per-plan.
  w('plans/2026-03-01-prose.md', `# Prose-named plan

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

### Shaped
- \`bug/prose-a\` — a label, stays silent

### Moved — recorded here so the plan states what it started
- \`bug/prose-b\` — the wave name is a sentence

### Offered first
- \`bug/prose-c\` — the longest legitimate name, 13 chars, silent
`);

  // A plan whose wave names are all labels — must be entirely silent.
  w('plans/2026-03-02-labels.md', `# All labels

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Parsed
- \`feature/labels-a\` — alone

### Written
- \`feature/labels-b\` — alone
`);

  // A phase-less file — a decision log, not a plan. It carries a long-named
  // "wave" but with no Phase: it is skipped, the same rule the rest of the scan
  // applies. Catches a second answer to "is this a plan".
  w('plans/2026-03-03-notes.md', `# Worker report, not a plan

## Branches

### A heading long enough to read as prose rather than a wave label
- \`feature/notes-x\` — one
`);

  fs.mkdirSync(path.join(pwRepo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(pwRepo, 'plans', 'delivered'), { recursive: true });
  // Link the two real plans so index drift stays silent — keeps this fixture's
  // footer focused on prose_slice_names without unrelated noise.
  fs.symlinkSync('../2026-03-01-prose.md', path.join(pwRepo, 'plans', 'active', 'prose.md'));
  fs.symlinkSync('../2026-03-02-labels.md', path.join(pwRepo, 'plans', 'active', 'labels.md'));

  git(pwRepo, 'add', '-A');
  git(pwRepo, 'commit', '-q', '-m', 'plans');
  git(pwRepo, 'push', '-q', 'origin', 'main');

  pwReport = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: pwRepo });
  pwSections = splitSections(pwReport);
});
after(() => fs.rmSync(pwTmp, { recursive: true, force: true }));

test('scan: section 8 reports a prose wave name once, with its file and the name', () => {
  const hits = pwSections['8'].split('\n')
    .filter((l) => l.includes('2026-03-01-prose.md') && l.includes('wave name'));
  assert.equal(hits.length, 1, `expected exactly one prose finding, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /wave name 'Moved — recorded here so the plan states what it started' reads as prose/);
  // The label-named waves in the same plan must not appear.
  assert.doesNotMatch(pwSections['8'], /wave name 'Shaped'/);
  assert.doesNotMatch(pwSections['8'], /wave name 'Offered first'/);
  // And the actionable verb a person acts on — fix the plan, not the board.
  assert.match(pwSections['8'], /rename: shorten the wave heading in prose/);
});

test('scan: section 8 is silent for a plan whose wave names are all labels', () => {
  assert.doesNotMatch(pwSections['8'], /2026-03-02-labels\.md/);
});

test('scan: section 8 skips a phase-less file — a decision log is not a plan', () => {
  // notes.md carries a long-named wave but no Phase:, so it is not a plan and
  // the section must not report it.
  assert.doesNotMatch(pwSections['8'], /2026-03-03-notes\.md/);
});

test('scan: section 8 footer counter matches the number of findings', () => {
  // prose.md has exactly one over-long wave name. The counter is wired to the
  // same variable the body increments — a footer wired to a different variable
  // is a bug no single-finding assertion above can see.
  const bodyFindings = pwSections['8'].split('\n').filter((l) => l.includes('reads as prose')).length;
  assert.equal(bodyFindings, 1, `expected 1 body finding, got ${bodyFindings}`);
  const footer = pwReport.trim().split('\n').at(-1);
  assert.match(footer, /\bprose_slice_names=1\b/);
});

test('scan: a prose wave name leaves attention= unchanged — the section does NOT gate', () => {
  // THE property a naive implementation breaks. A prose name is a shape to fix,
  // not a branch that cannot move — /plot-deliver's gate and the /plot hygiene
  // line read attention= from this footer, and a cosmetic finding must not
  // inflate it. This is the whole reason it is a section of its own, past the
  // gate marker, with its own counter.
  const footer = pwReport.trim().split('\n').at(-1);
  assert.match(footer, /\battention=0\b/);
});

test('scan: a prose wave name does NOT fail the parse — the plan is not malformed', () => {
  // The report is not a refusal: prose.md still parses. The proof is a double
  // negative that a rejected parse would flip — the plan is NOT in section 5
  // (needs attention / malformed), yet section 8 DID report its wave name. A
  // parser that choked on the prose name would either drop the plan entirely
  // (no section-8 finding) or surface it as malformed in section 5; neither
  // happens.
  assert.doesNotMatch(pwSections['5'], /2026-03-01-prose\.md/);
  assert.match(pwSections['8'], /2026-03-01-prose\.md/);
});

// ---------------------------------------------------------------------------
// PR state handling: absent, failed, and zero-open-PR cases.
//
// A SIXTH fixture covering the three failures that the old code collapsed into
// one word ("degraded"): CLI absent, CLI failed (429/401/network), and CLI
// succeeded with zero open PRs. The measured bug was that all three produced
// the same signal, so a rate-limited API read as "no CLI installed" and section
// 3 listed every branch as stale.
//
// These tests cover:
// 1. A rate-limited call reports pr_source=failed, not degraded, with the error
// 2. An absent CLI reports pr_source=absent
// 3. A successful call returning zero open PRs reports gh/bb, never degraded
// 4. Section 3 is suppressed (no rows) when pr_source is failed/absent
// 5. stale= reports 0 when section 3 was not evaluated
// 6. Both arms (gh and bb) are tested — the measured bug was in bb, but gh had
//    the same latent defect
// ---------------------------------------------------------------------------

let psTmp, psRepo, psBin;

// Stub that simulates a failing CLI call — exits non-zero with an error message.
function makeFailingGhStub(dir, errorMsg, exitCode = 1) {
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
echo "${errorMsg}" >&2
exit ${exitCode}
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
}

// Stub that simulates a failing bb call — exits non-zero with an error message.
function makeFailingBbStub(dir, errorMsg, exitCode = 1) {
  fs.writeFileSync(path.join(dir, 'bb'), `#!/usr/bin/env bash
echo "${errorMsg}" >&2
exit ${exitCode}
`);
  fs.chmodSync(path.join(dir, 'bb'), 0o755);
}

// Stub that simulates a successful gh call with zero open PRs.
function makeEmptyGhStub(dir) {
  const argvLog = path.join(dir, 'gh.argv');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}
# Return empty output — zero open PRs, but exit 0 (success).
exit 0
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return argvLog;
}

// Stub that simulates a successful bb call with zero open PRs.
function makeEmptyBbStub(dir) {
  const argvLog = path.join(dir, 'bb.argv');
  fs.writeFileSync(path.join(dir, 'bb'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}
# Return empty JSON array — zero open PRs, exit 0.
echo '[]'
exit 0
`);
  fs.chmodSync(path.join(dir, 'bb'), 0o755);
  return argvLog;
}

function createPrStateFixture(originUrl) {
  psTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-ps-'));
  const origin = path.join(psTmp, 'origin.git');
  psRepo = path.join(psTmp, 'repo');
  git(psTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(psTmp, 'clone', '-q', origin, psRepo);
  git(psRepo, 'config', 'user.email', 'test@example.invalid');
  git(psRepo, 'config', 'user.name', 'Plot Test');
  git(psRepo, 'config', 'commit.gpgsign', 'false');
  git(psRepo, 'remote', 'set-url', 'origin', originUrl);
  git(psRepo, 'remote', 'add', 'store', origin);

  const w = (rel, content) => {
    const p = path.join(psRepo, rel);
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

  // A plan with an unmerged branch — would be reported as orphan if section 3 ran.
  w('plans/2026-04-01-test.md', `# Test

## Status

- **Phase:** Approved
- **Type:** bug

## Branches

- \`bug/test-branch\` — work in progress
`);

  fs.mkdirSync(path.join(psRepo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(psRepo, 'plans', 'delivered'), { recursive: true });
  fs.symlinkSync('../2026-04-01-test.md', path.join(psRepo, 'plans', 'active', 'test.md'));

  git(psRepo, 'add', '-A');
  git(psRepo, 'commit', '-q', '-m', 'plans');

  // bug/test-branch: unmerged work.
  git(psRepo, 'checkout', '-q', '-b', 'bug/test-branch');
  w('test.txt', 'wip\n');
  git(psRepo, 'add', 'test.txt');
  git(psRepo, 'commit', '-q', '-m', 'test wip');
  git(psRepo, 'checkout', '-q', 'main');

  git(psRepo, 'push', '-q', 'store', 'main', 'bug/test-branch');
  git(psRepo, 'fetch', '-q', 'store');
  for (const b of ['main', 'bug/test-branch']) {
    git(psRepo, 'update-ref', `refs/remotes/origin/${b}`, `refs/remotes/store/${b}`);
  }
  git(psRepo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
}

function cleanupPrStateFixture() {
  if (psTmp) fs.rmSync(psTmp, { recursive: true, force: true });
  if (psBin) fs.rmSync(psBin, { recursive: true, force: true });
  psTmp = psRepo = psBin = null;
}

// --- GitHub tests ---

test('scan: a rate-limited gh call reports pr_source=failed with the error', () => {
  createPrStateFixture('https://github.com/plot-pm/fixture.git');
  try {
    psBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-ps-bin-'));
    makeFailingGhStub(psBin, 'HTTP 429: rate limit exceeded', 1);
    const out = execFileSync('bash', [scan, '--no-fetch'], {
      encoding: 'utf8', cwd: psRepo,
      env: { ...process.env, PATH: `${psBin}:${process.env.PATH}` },
    });
    assert.match(out, /PR state: FAILED/);
    assert.match(out, /HTTP 429/);
    const footer = out.trim().split('\n').at(-1);
    assert.match(footer, /\bpr_source=failed\b/);
  } finally {
    cleanupPrStateFixture();
  }
});

test('scan: an absent gh reports pr_source=absent', () => {
  createPrStateFixture('https://github.com/plot-pm/fixture.git');
  try {
    // Create a PATH with NO gh command.
    psBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-ps-bin-'));
    // Stub for all commands EXCEPT gh.
    for (const tool of ['git', 'dirname', 'basename', 'sed', 'grep', 'awk',
                        'readlink', 'cat', 'env', 'tr', 'bash', 'jq', 'head', 'mktemp', 'date']) {
      let resolved;
      try {
        resolved = execFileSync('/usr/bin/env', ['which', tool], { encoding: 'utf8' }).trim();
      } catch { continue; }
      if (resolved) fs.symlinkSync(resolved, path.join(psBin, tool));
    }
    const out = execFileSync('bash', [scan, '--no-fetch'], {
      encoding: 'utf8', cwd: psRepo,
      env: { ...process.env, PATH: psBin },
    });
    assert.match(out, /PR state: ABSENT/);
    assert.match(out, /gh not found on PATH/);
    const footer = out.trim().split('\n').at(-1);
    assert.match(footer, /\bpr_source=absent\b/);
  } finally {
    cleanupPrStateFixture();
  }
});

test('scan: gh returning zero open PRs reports pr_source=gh, not degraded', () => {
  createPrStateFixture('https://github.com/plot-pm/fixture.git');
  try {
    psBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-ps-bin-'));
    makeEmptyGhStub(psBin);
    const out = execFileSync('bash', [scan, '--no-fetch'], {
      encoding: 'utf8', cwd: psRepo,
      env: { ...process.env, PATH: `${psBin}:${process.env.PATH}` },
    });
    assert.match(out, /PR state: gh pr list/);
    const footer = out.trim().split('\n').at(-1);
    assert.match(footer, /\bpr_source=gh\b/);
    // Must NOT report degraded.
    assert.doesNotMatch(out, /PR state: DEGRADED/);
  } finally {
    cleanupPrStateFixture();
  }
});

test('scan: section 3 suppressed when gh fails — no rows, stale=0', () => {
  createPrStateFixture('https://github.com/plot-pm/fixture.git');
  try {
    psBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-ps-bin-'));
    makeFailingGhStub(psBin, 'HTTP 429: rate limit exceeded', 1);
    const out = execFileSync('bash', [scan, '--no-fetch'], {
      encoding: 'utf8', cwd: psRepo,
      env: { ...process.env, PATH: `${psBin}:${process.env.PATH}` },
    });
    const sections = splitSections(out);
    // Section 3 should say it was not evaluated.
    assert.match(sections['3'], /not evaluated.*PR state unknown/);
    // The branch should NOT appear — no rows when suppressed.
    assert.doesNotMatch(sections['3'], /bug\/test-branch.*orphan/);
    // stale= should be 0.
    const footer = out.trim().split('\n').at(-1);
    assert.match(footer, /\bstale=0\b/);
  } finally {
    cleanupPrStateFixture();
  }
});

// --- Bitbucket tests ---

test('scan: a rate-limited bb call reports pr_source=failed with the error', () => {
  createPrStateFixture('https://bitbucket.org/plot-pm/fixture.git');
  try {
    psBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-ps-bin-'));
    makeFailingBbStub(psBin, 'error: HTTP 429 — Rate limit for this resource has been exceeded', 1);
    const out = execFileSync('bash', [scan, '--no-fetch'], {
      encoding: 'utf8', cwd: psRepo,
      env: { ...process.env, PATH: `${psBin}:${process.env.PATH}` },
    });
    assert.match(out, /PR state: FAILED/);
    assert.match(out, /HTTP 429/);
    const footer = out.trim().split('\n').at(-1);
    assert.match(footer, /\bpr_source=failed\b/);
  } finally {
    cleanupPrStateFixture();
  }
});

test('scan: an absent bb reports pr_source=absent', () => {
  createPrStateFixture('https://bitbucket.org/plot-pm/fixture.git');
  try {
    // Create a PATH with NO bb command.
    psBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-ps-bin-'));
    for (const tool of ['git', 'dirname', 'basename', 'sed', 'grep', 'awk',
                        'readlink', 'cat', 'env', 'tr', 'bash', 'jq', 'head', 'mktemp', 'date']) {
      let resolved;
      try {
        resolved = execFileSync('/usr/bin/env', ['which', tool], { encoding: 'utf8' }).trim();
      } catch { continue; }
      if (resolved) fs.symlinkSync(resolved, path.join(psBin, tool));
    }
    const out = execFileSync('bash', [scan, '--no-fetch'], {
      encoding: 'utf8', cwd: psRepo,
      env: { ...process.env, PATH: psBin },
    });
    assert.match(out, /PR state: ABSENT/);
    assert.match(out, /bb not found on PATH/);
    const footer = out.trim().split('\n').at(-1);
    assert.match(footer, /\bpr_source=absent\b/);
  } finally {
    cleanupPrStateFixture();
  }
});

test('scan: bb returning zero open PRs reports pr_source=bb, not degraded', () => {
  createPrStateFixture('https://bitbucket.org/plot-pm/fixture.git');
  try {
    psBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-ps-bin-'));
    makeEmptyBbStub(psBin);
    const out = execFileSync('bash', [scan, '--no-fetch'], {
      encoding: 'utf8', cwd: psRepo,
      env: { ...process.env, PATH: `${psBin}:${process.env.PATH}` },
    });
    assert.match(out, /PR state: bb pr list/);
    const footer = out.trim().split('\n').at(-1);
    assert.match(footer, /\bpr_source=bb\b/);
    // Must NOT report degraded.
    assert.doesNotMatch(out, /PR state: DEGRADED/);
  } finally {
    cleanupPrStateFixture();
  }
});

test('scan: section 3 suppressed when bb fails — no rows, stale=0', () => {
  createPrStateFixture('https://bitbucket.org/plot-pm/fixture.git');
  try {
    psBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-ps-bin-'));
    makeFailingBbStub(psBin, 'error: HTTP 429 — Rate limit for this resource has been exceeded', 1);
    const out = execFileSync('bash', [scan, '--no-fetch'], {
      encoding: 'utf8', cwd: psRepo,
      env: { ...process.env, PATH: `${psBin}:${process.env.PATH}` },
    });
    const sections = splitSections(out);
    // Section 3 should say it was not evaluated.
    assert.match(sections['3'], /not evaluated.*PR state unknown/);
    // The branch should NOT appear — no rows when suppressed.
    assert.doesNotMatch(sections['3'], /bug\/test-branch.*orphan/);
    // stale= should be 0.
    const footer = out.trim().split('\n').at(-1);
    assert.match(footer, /\bstale=0\b/);
  } finally {
    cleanupPrStateFixture();
  }
});

test('scan: the error text reaches the reader — the CLI\'s own words', () => {
  // Done-when 5: the CLI's own error text reaches the reader, beside the state.
  createPrStateFixture('https://github.com/plot-pm/fixture.git');
  try {
    psBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-ps-bin-'));
    makeFailingGhStub(psBin, 'gh: API rate limit exceeded for user ID 12345', 1);
    const out = execFileSync('bash', [scan, '--no-fetch'], {
      encoding: 'utf8', cwd: psRepo,
      env: { ...process.env, PATH: `${psBin}:${process.env.PATH}` },
    });
    // The error text should appear in the header.
    assert.match(out, /API rate limit exceeded for user ID 12345/);
    // And also in section 3's suppression message.
    const sections = splitSections(out);
    assert.match(sections['3'], /API rate limit exceeded/);
  } finally {
    cleanupPrStateFixture();
  }
});

test('scan: --no-pr still prints rows (today\'s behaviour preserved)', () => {
  // Done-when 8: --no-pr keeps today's behaviour — rows are printed.
  createPrStateFixture('https://github.com/plot-pm/fixture.git');
  try {
    psBin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-ps-bin-'));
    // No gh stub needed — --no-pr skips the call entirely.
    const out = execFileSync('bash', [scan, '--no-fetch', '--no-pr'], {
      encoding: 'utf8', cwd: psRepo,
      env: { ...process.env, PATH: `${psBin}:${process.env.PATH}` },
    });
    const sections = splitSections(out);
    // Section 3 should print the branch — not suppressed.
    assert.match(sections['3'], /bug\/test-branch.*orphan/);
    // pr_source should be off, not failed/absent.
    const footer = out.trim().split('\n').at(-1);
    assert.match(footer, /\bpr_source=off\b/);
    // stale= should be 1, not 0 — the section was evaluated.
    assert.match(footer, /\bstale=1\b/);
  } finally {
    cleanupPrStateFixture();
  }
});

// ---------------------------------------------------------------------------
// Section 11: stale sprint tally (unchecked items whose plan is delivered or
// released). A SEVENTH fixture. This section walks sprint files, matches items
// against plan phases, and reports unchecked items over delivered/released
// plans. It covers CLOSED sprints — those are the population whose tally
// nothing else will ever recompute.
//
// Properties under test:
// 1. A closed sprint with an unchecked item whose plan is delivered is reported
// 2. Same for released — both terminal phases count
// 3. An unchecked item whose plan is NOT delivered/released is silent
// 4. An unresolvable slug (no plan file) is skipped, not reported as stale
// 5. A CHECKED item (even over a delivered plan) is not reported
// 6. The footer counter stale_tally= matches the findings
// 7. attention= is unchanged — this section does NOT gate
// ---------------------------------------------------------------------------

let stTmp, stRepo, stReport, stSections;

before(() => {
  stTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-st-'));
  const origin = path.join(stTmp, 'origin.git');
  stRepo = path.join(stTmp, 'repo');
  git(stTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(stTmp, 'clone', '-q', origin, stRepo);
  git(stRepo, 'config', 'user.email', 'test@example.invalid');
  git(stRepo, 'config', 'user.name', 'Plot Test');
  git(stRepo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(stRepo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };

  w('CLAUDE.md', `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
- **Sprint directory:** sprints/
`);

  // A delivered plan — unchecked items over this are stale.
  w('plans/2026-05-01-delivered-plan.md', `# Delivered Plan

## Status

- **Phase:** Delivered
- **Type:** feature
`);

  // A released plan — also counts as stale when unchecked.
  w('plans/2026-05-02-released-plan.md', `# Released Plan

## Status

- **Phase:** Released
- **Type:** feature
`);

  // An approved (not delivered) plan — unchecked over this is NOT stale.
  w('plans/2026-05-03-approved-plan.md', `# Approved Plan

## Status

- **Phase:** Approved
- **Type:** bug
`);

  // Symlinks so we avoid index-drift noise.
  fs.mkdirSync(path.join(stRepo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(stRepo, 'plans', 'delivered'), { recursive: true });
  fs.symlinkSync('../2026-05-01-delivered-plan.md', path.join(stRepo, 'plans', 'delivered', 'delivered-plan.md'));
  fs.symlinkSync('../2026-05-02-released-plan.md', path.join(stRepo, 'plans', 'delivered', 'released-plan.md'));
  fs.symlinkSync('../2026-05-03-approved-plan.md', path.join(stRepo, 'plans', 'active', 'approved-plan.md'));

  // A CLOSED sprint with items in various states.
  w('sprints/2026-W20-test-sprint.md', `# Sprint: Test Sprint

## Status

- **Phase:** Closed

### Must Have

- [ ] [delivered-plan] Unchecked, plan is delivered — STALE
- [ ] [released-plan] Unchecked, plan is released — STALE
- [ ] [approved-plan] Unchecked, plan is NOT delivered — silent
- [x] [delivered-plan] Checked, plan is delivered — silent (already ticked)
- [ ] [no-such-plan] Unchecked, slug names no plan — silent (section 9's finding)
- [ ] A bare prose line with no slug — silent (no plan to check)
`);

  git(stRepo, 'add', '-A');
  git(stRepo, 'commit', '-q', '-m', 'fixture');
  git(stRepo, 'push', '-q', 'origin', 'main');

  stReport = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: stRepo });
  stSections = splitSections(stReport);
});
after(() => fs.rmSync(stTmp, { recursive: true, force: true }));

test('scan: section 11 reports an unchecked item whose plan is delivered', () => {
  const hits = stSections['11'].split('\n')
    .filter((l) => l.includes('delivered-plan') && l.includes('unchecked'));
  assert.equal(hits.length, 1, `expected exactly one delivered-plan stale finding, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /unchecked but plan is delivered/);
});

test('scan: section 11 reports an unchecked item whose plan is released', () => {
  const hits = stSections['11'].split('\n')
    .filter((l) => l.includes('released-plan') && l.includes('unchecked'));
  assert.equal(hits.length, 1, `expected exactly one released-plan stale finding, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /unchecked but plan is released/);
});

test('scan: section 11 is silent for an unchecked item whose plan is NOT delivered', () => {
  assert.doesNotMatch(stSections['11'], /approved-plan/);
});

test('scan: section 11 is silent for a checked item (even if plan is delivered)', () => {
  // The delivered-plan appears once (unchecked) but not twice (the checked line).
  const hits = stSections['11'].split('\n')
    .filter((l) => l.includes('delivered-plan') && l.includes('unchecked'));
  assert.equal(hits.length, 1, 'only the unchecked mention should appear');
});

test('scan: section 11 skips an unresolvable slug silently', () => {
  // [no-such-plan] names no plan file. This is NOT a section 11 finding — it is
  // section 9's finding (sprint member names no plan). Section 11 must NOT
  // report it as stale.
  assert.doesNotMatch(stSections['11'], /no-such-plan/);
  // But section 9 should catch it.
  assert.match(stSections['9'], /no-such-plan/);
});

test('scan: section 11 skips a bare prose line silently', () => {
  // "A bare prose line with no slug" has no `[slug]` — the regex never matches.
  assert.doesNotMatch(stSections['11'], /bare prose/);
});

test('scan: section 11 footer counter matches the number of findings', () => {
  // delivered-plan (delivered) + released-plan (released) = 2 findings.
  const bodyFindings = stSections['11'].split('\n').filter((l) => l.includes('unchecked but plan is')).length;
  assert.equal(bodyFindings, 2, `expected 2 body findings, got ${bodyFindings}`);
  const footer = stReport.trim().split('\n').at(-1);
  assert.match(footer, /\bstale_tally=2\b/);
});

test('scan: a stale tally leaves attention= unchanged — the section does NOT gate', () => {
  // THE property a naive implementation breaks. A stale tally is wrong, not
  // broken — rewriting history automatically is worse than reporting it.
  // /plot-deliver's gate and the /plot hygiene line read attention= from the
  // footer, and an advisory finding must not inflate it.
  const footer = stReport.trim().split('\n').at(-1);
  assert.match(footer, /\battention=0\b/);
});

test('scan: section 11 covers CLOSED sprints, not just active ones', () => {
  // The fixture sprint is Phase: Closed. The fact that findings appear at all
  // proves closed sprints are walked. This test pins the premise: if the sprint
  // were somehow active-only, stale_tally=0 would be the silent failure.
  const footer = stReport.trim().split('\n').at(-1);
  assert.match(footer, /\bstale_tally=2\b/, 'closed sprint must produce findings');
});

// ---------------------------------------------------------------------------
// Section 12: double-claimed branches (one branch listed by more than one plan).
//
// A SEVENTH fixture, minimal like the unsliced and prose ones: pure plan
// parsing (reads the parser's waves[]), no git host, run --offline. This
// section is the FIRST that reasons ACROSS plans rather than within one, which
// is why it gets its own fixture rather than an assertion on the main one — the
// live estate is expected to be nearly clean, and a section whose only evidence
// is a clean estate is untested.
//
// The properties under test are the ones the plan's `## Done when` names: a
// branch listed by two plans is reported ONCE naming both plans and their
// waves, with a footer count; a singly-claimed branch is silent; a CITATION is
// not a claim (the defect wave 1 removed, asserted from this side); a
// phase-less file is not a claimant; a plan listing one branch twice is one
// claimant, not a collision with itself; and — the property a naive
// implementation breaks — `attention=` is unchanged by a double claim.
// ---------------------------------------------------------------------------

let dcTmp, dcRepo, dcReport, dcSections;

before(() => {
  dcTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-dc-'));
  const origin = path.join(dcTmp, 'origin.git');
  dcRepo = path.join(dcTmp, 'repo');
  git(dcTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(dcTmp, 'clone', '-q', origin, dcRepo);
  git(dcRepo, 'config', 'user.email', 'test@example.invalid');
  git(dcRepo, 'config', 'user.name', 'Plot Test');
  git(dcRepo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(dcRepo, rel);
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

  // THE COLLISION. Two plans that each LIST `feature/contested` in a wave of
  // their own — the real conflict this section exists to surface. Each also
  // owns a branch nobody else claims, which must stay silent: the finding is
  // per-branch, not per-plan.
  w('plans/2026-03-01-first-claimant.md', `# First claimant

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Alpha
- \`feature/first-only\` — claimed once, must stay silent

### Shared
- \`feature/contested\` — this plan lists it
`);

  w('plans/2026-03-02-second-claimant.md', `# Second claimant

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Beta
- \`feature/second-only\` — claimed once, must stay silent

### Disputed
- \`feature/contested\` — this plan lists it too
`);

  // A CITATION, not a claim — the defect wave 1 (#490) removed, asserted from
  // this section's side. This plan mentions `feature/contested` in a
  // blockquote and inside its own branch line's description, exactly the two
  // shapes the parser used to read as claims. If the anchor ever regresses,
  // this plan joins the collision and the claimant count rises to 3.
  w('plans/2026-03-03-citing.md', `# Citing

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

> Depends on first-claimant's \`feature/contested\` landing first, and the
> dependency is not tidiness.

### Gamma
- \`feature/citing-own\` — waits on \`feature/contested\` before it can start
`);

  // A phase-less file — a decision log, not a plan. It LISTS `feature/contested`
  // in claim shape, but with no Phase: it is not a claimant, the same rule
  // sections 1, 7 and 8 apply. Without the phase filter the count would be 3.
  w('plans/2026-03-04-notes.md', `# Worker report, not a plan

## Branches

### Recorded
- \`feature/contested\` — a log naming the branch is not a plan claiming it
`);

  // ONE plan listing ONE branch in TWO waves. This is a different fault with a
  // different repair (it is section 7/reslice territory, not ownership), and it
  // must NOT read as a collision between a plan and itself.
  w('plans/2026-03-05-self-repeat.md', `# Self repeat

## Status

- **Phase:** Approved
- **Type:** feature

## Branches

### Early
- \`feature/repeated\` — listed here

### Late
- \`feature/repeated\` — and again here, by the same plan
`);

  fs.mkdirSync(path.join(dcRepo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(dcRepo, 'plans', 'delivered'), { recursive: true });
  // Link every plan so index drift stays silent — keeps this fixture's footer
  // focused on double_claims without unrelated noise.
  for (const [link, target] of [
    ['first-claimant.md', '../2026-03-01-first-claimant.md'],
    ['second-claimant.md', '../2026-03-02-second-claimant.md'],
    ['citing.md', '../2026-03-03-citing.md'],
    ['self-repeat.md', '../2026-03-05-self-repeat.md'],
  ]) fs.symlinkSync(target, path.join(dcRepo, 'plans', 'active', link));

  git(dcRepo, 'add', '-A');
  git(dcRepo, 'commit', '-q', '-m', 'plans');
  git(dcRepo, 'push', '-q', 'origin', 'main');

  dcReport = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: dcRepo });
  dcSections = splitSections(dcReport);
});
after(() => fs.rmSync(dcTmp, { recursive: true, force: true }));

test('scan: section 12 reports a doubly-claimed branch once, naming both plans and their waves', () => {
  const hits = dcSections['12'].split('\n').filter((l) => l.includes('feature/contested') && l.includes('claimed by'));
  assert.equal(hits.length, 1, `expected exactly one collision finding, got:\n${hits.join('\n')}`);
  // Both plans AND the wave each lists it under — the plan line asks for both.
  assert.match(hits[0], /first-claimant \(Shared\)/);
  assert.match(hits[0], /second-claimant \(Disputed\)/);
  assert.match(hits[0], /claimed by 2 plans/);
  // And the actionable line a person runs — resolve:, not fix:.
  assert.match(dcSections['12'], /resolve: decide which plan owns `feature\/contested`/);
});

test('scan: section 12 is silent for a branch claimed by exactly one plan', () => {
  assert.doesNotMatch(dcSections['12'], /feature\/first-only/);
  assert.doesNotMatch(dcSections['12'], /feature\/second-only/);
  assert.doesNotMatch(dcSections['12'], /feature\/citing-own/);
});

test('scan: section 12 does not read a CITATION as a second claim', () => {
  // citing.md names `feature/contested` in a blockquote AND inside its own
  // branch line's description — the two shapes the pre-#490 matcher read as
  // claims. It must not appear as a claimant, and the count must stay 2.
  assert.doesNotMatch(dcSections['12'], /citing \(/);
  const hits = dcSections['12'].split('\n').filter((l) => l.includes('claimed by'));
  assert.match(hits[0], /claimed by 2 plans/, 'a citation must not raise the claimant count');
});

test('scan: section 12 does not treat a phase-less file as a claimant', () => {
  // notes.md lists `feature/contested` in claim shape but has no Phase:, so it
  // is not a plan. Catches a second parser that treats every .md as a plan.
  assert.doesNotMatch(dcSections['12'], /notes \(/);
});

test('scan: section 12 does not report a plan colliding with itself', () => {
  // self-repeat.md lists `feature/repeated` in two of its own waves. That is one
  // claimant, not a conflict — a different fault with a different repair.
  assert.doesNotMatch(dcSections['12'], /feature\/repeated/);
});

test('scan: section 12 footer counter matches the number of findings', () => {
  // One collision (feature/contested). The counter must be wired to the same
  // variable the body increments — a footer wired to a different variable is a
  // bug no single-finding assertion above can see.
  const bodyFindings = dcSections['12'].split('\n').filter((l) => l.includes('claimed by')).length;
  assert.equal(bodyFindings, 1, `expected 1 body finding, got ${bodyFindings}`);
  const footer = dcReport.trim().split('\n').at(-1);
  assert.match(footer, /\bdouble_claims=1\b/);
});

test('scan: a double claim leaves attention= unchanged — the section does NOT gate', () => {
  // THE property a naive implementation breaks, and the one every other test
  // above passes without: adding a finding to attention= looks like diligence
  // and turns a report into a gate. /plot-deliver's delivery-landed gate and
  // the /plot hygiene line read attention= from this footer, and a double claim
  // is a shape for a person to resolve, not a branch that cannot move.
  const footer = dcReport.trim().split('\n').at(-1);
  assert.match(footer, /\battention=0\b/);
});

test('scan: section 12 stays below the blocking set, leaving /plot-deliver\'s `== 7.` gate marker intact', () => {
  // The gate marker is `sed -n '/^== 7./q;p'` — a hardcoded number meaning "the
  // first non-blocking section". Inserting a section below 7 would silently
  // shrink the delivery gate, so every new one goes after the last. This pins
  // that placement; section 13 (stale rounds) now sits after it.
  assert.match(dcReport, /^== 12\. Double-claimed branches/m);
  assert.match(dcReport, /^== 7\. Uncut slices/m, 'section 7 must still be uncut slices');
});

// ---------------------------------------------------------------------------
// Stale interrogation rounds (section 13).
//
// A SEPARATE fixture, because this section's subject is a plan's COMMIT
// HISTORY rather than its text: the finding needs one commit that writes a
// `Rounds:` value and a later commit that amends the plan, and neither the
// main fixture nor the double-claim one commits a plan twice. Same minimal
// shape as those two — one plan directory, no branches, no git host, run
// --offline.
//
// The properties under test are the ones the plan's `## Done when` names: a
// Draft plan amended after its recorded round is reported, naming the round
// and the commits compared; a plan with NO `Rounds:` field is silent (the half
// a careless implementation gets wrong, because an unquestioned plan is
// honestly unquestioned); `Rounds: 0` is a RECORDED value and reports like any
// other, asserted separately because a truthiness test silences exactly it; an
// Approved plan is out of scope; a plan not touched since its round is silent;
// and — the property the naive implementation breaks — `attention=` is
// unchanged by a stale round.
// ---------------------------------------------------------------------------

let srTmp, srRepo, srReport, srSections;

before(() => {
  srTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-sr-'));
  const origin = path.join(srTmp, 'origin.git');
  srRepo = path.join(srTmp, 'repo');
  git(srTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(srTmp, 'clone', '-q', origin, srRepo);
  git(srRepo, 'config', 'user.email', 'test@example.invalid');
  git(srRepo, 'config', 'user.name', 'Plot Test');
  git(srRepo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(srRepo, rel);
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

  const plan = (title, phase, roundsLine, body = '') =>
    `# ${title}\n\n## Status\n\n- **Phase:** ${phase}\n- **Type:** feature\n${roundsLine}${body}`;

  // THE FINDING. Draft, records round 2, and gets amended in a LATER commit.
  w('plans/2026-04-01-stale-round.md', plan('Stale round', 'Draft', '- **Rounds:** 2\n'));
  // `Rounds: 0` — a recorded value, not an absence. The parser emits
  // `"rounds":0`, and reading the KEY'S PRESENCE rather than its truthiness is
  // what keeps this plan visible. Amended later, exactly like the one above.
  w('plans/2026-04-02-zero-round.md', plan('Zero round', 'Draft', '- **Rounds:** 0\n'));
  // NO `Rounds:` field. Amended later too — so the only thing keeping it out of
  // the report is the missing round, which is the point.
  w('plans/2026-04-03-never-questioned.md', plan('Never questioned', 'Draft', ''));
  // APPROVED, records a round, amended later. Out of scope: the questioning
  // feeds the review, and this plan has passed it.
  w('plans/2026-04-04-approved.md', plan('Approved plan', 'Approved', '- **Rounds:** 3\n'));
  // Draft with a round and NEVER amended after it — the healthy case.
  w('plans/2026-04-05-current.md', plan('Current', 'Draft', '- **Rounds:** 1\n'));

  fs.mkdirSync(path.join(srRepo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(srRepo, 'plans', 'delivered'), { recursive: true });
  for (const [link, target] of [
    ['stale-round.md', '../2026-04-01-stale-round.md'],
    ['zero-round.md', '../2026-04-02-zero-round.md'],
    ['never-questioned.md', '../2026-04-03-never-questioned.md'],
    ['approved.md', '../2026-04-04-approved.md'],
    ['current.md', '../2026-04-05-current.md'],
  ]) fs.symlinkSync(target, path.join(srRepo, 'plans', 'active', link));

  git(srRepo, 'add', '-A');
  git(srRepo, 'commit', '-q', '-m', 'plans, each recording its round');

  // THE AMENDMENT — a SECOND commit, dated explicitly rather than taken from
  // the clock. git records commit time in whole SECONDS, so two commits made in
  // the same second compare equal, the `>` test is silent, and the fixture
  // tests nothing while passing. A pinned date orders them strictly without a
  // sleep. Every plan here is touched EXCEPT
  // 2026-04-05-current.md, so the difference between the reported and the
  // silent plans is the round, never the edit.
  const bump = (rel) => {
    const p = path.join(srRepo, rel);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + '\nAmended after the round.\n');
  };
  bump('plans/2026-04-01-stale-round.md');
  bump('plans/2026-04-02-zero-round.md');
  bump('plans/2026-04-03-never-questioned.md');
  bump('plans/2026-04-04-approved.md');
  execFileSync('git', ['commit', '-qam', 'amend the plans'], {
    cwd: srRepo,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '@2000000000 +0000',
      GIT_COMMITTER_DATE: '@2000000000 +0000',
    },
  });

  git(srRepo, 'push', '-q', 'origin', 'main');

  srReport = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: srRepo });
  srSections = splitSections(srReport);
});
after(() => fs.rmSync(srTmp, { recursive: true, force: true }));

test('scan: section 13 reports a Draft plan amended since its recorded round, naming both commits', () => {
  assert.match(srSections['13'], /2026-04-01-stale-round\.md — records round 2 \(last written in [0-9a-f]+\), amended since in [0-9a-f]+/);
  // The finding names its inputs, so a reader can judge it — and the two
  // commits must DIFFER, or the comparison reported nothing.
  const m = /records round 2 \(last written in ([0-9a-f]+)\), amended since in ([0-9a-f]+)/.exec(srSections['13']);
  assert.ok(m, 'the finding must name both commits');
  assert.notEqual(m[1], m[2], 'the round commit and the amendment must be different commits');
  // A hint, not an order: the verb is `consider:`, not `fix:`.
  assert.match(srSections['13'], /consider: re-question the plan/);
});

test('scan: section 13 treats `Rounds: 0` as a recorded value, not as absence', () => {
  // The parser emits `"rounds":0` for this plan and NO `rounds` key for one
  // with no field. A shell test on truthiness would silence exactly this plan —
  // the one that explicitly said it was never questioned.
  assert.match(srSections['13'], /2026-04-02-zero-round\.md — records round 0 \(last written in [0-9a-f]+\)/);
});

test('scan: section 13 is silent for a plan with no Rounds: field', () => {
  // THE HALF A CARELESS IMPLEMENTATION GETS WRONG. This plan was amended in the
  // same commit as the two reported above, so only the missing round separates
  // it from them: a plan nobody has questioned is honestly unquestioned.
  assert.doesNotMatch(srSections['13'], /never-questioned/);
});

test('scan: section 13 is silent for an Approved plan', () => {
  // Records round 3, amended after it — and out of scope. An Approved plan has
  // passed the review the questioning feeds; the badge a reader judges belongs
  // to a Draft plan's card.
  assert.doesNotMatch(srSections['13'], /2026-04-04-approved\.md/);
});

test('scan: section 13 is silent for a Draft plan untouched since its round', () => {
  assert.doesNotMatch(srSections['13'], /2026-04-05-current\.md/);
});

test('scan: section 13 footer counter matches the number of findings', () => {
  // Two findings: the round-2 plan and the round-0 plan. The counter must be
  // wired to the same variable the body increments — a footer wired to a
  // different variable is a bug no single-finding assertion above can see.
  const bodyFindings = srSections['13'].split('\n').filter((l) => l.includes('records round ')).length;
  assert.equal(bodyFindings, 2, `expected 2 body findings, got ${bodyFindings}`);
  const footer = srReport.trim().split('\n').at(-1);
  assert.match(footer, /\brounds_drift=2\b/);
});

test('scan: a stale round leaves attention= unchanged — the section does NOT gate', () => {
  // THE property a naive implementation breaks: adding a finding to attention=
  // looks like diligence and turns a report into a gate. /plot-deliver's
  // delivery-landed gate and the /plot hygiene line read attention= from this
  // footer, and a stale round is a hint about a badge, not a delivery that
  // cannot land.
  const footer = srReport.trim().split('\n').at(-1);
  assert.match(footer, /\battention=0\b/);
  // And it appears in 13, not in 5 — the section-scoped contrast, not a
  // report-wide substring match.
  assert.doesNotMatch(srSections['5'], /stale-round/);
});

test('scan: section 13 sits last, leaving /plot-deliver\'s `== 7.` gate marker intact', () => {
  // The gate marker is `sed -n '/^== 7./q;p'` — a hardcoded number meaning "the
  // first non-blocking section". Inserting this section below 7 would silently
  // shrink the delivery gate, so it goes last. This pins that placement, and
  // that sections 1-12 kept their numbers.
  const nums = srReport.split('\n')
    .map((l) => /^== (\d+)\. /.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  assert.equal(Math.max(...nums), 13, 'the stale-round section must be the last one');
  assert.match(srReport, /^== 7\. Uncut slices/m, 'section 7 must still be uncut slices');
  assert.match(srReport, /^== 12\. Double-claimed branches/m, 'section 12 must keep its number');
});
