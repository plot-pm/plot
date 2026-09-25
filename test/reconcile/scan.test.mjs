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
  // demotion has to preserve — a missing link is a browsing gap (index drift),
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

test('scan: section 12 reports an unlinked plan at convenience level, not as attention', () => {
  // Since #254 the phase grouping is derived from plan content, so an unlinked
  // plan is fully visible and the old "(orphaned)" verdict expired. It stays
  // listed — the symlink is still a browsing convenience — but as `optional:`
  // in index drift (section 12 since the unsliced-wave, prose-name, and sprint-drift
  // sections took 7, 8 and 9), and it must not appear in section 5.
  const sections = splitSections(report);
  assert.match(sections['12'], /2026-01-05-omega\.md — phase 'Approved', no symlink in plans\/active\/ or plans\/delivered\/ \(browsing only\)/);
  assert.match(sections['12'], /optional: ln -s \.\.\/2026-01-05-omega\.md plans\/active\/omega\.md/);
  assert.doesNotMatch(sections['5'], /2026-01-05-omega\.md/);
  // The word that expired must be gone from the whole report for this plan.
  assert.doesNotMatch(report, /2026-01-05-omega\.md[^\n]*orphaned/);
});

test('scan: section 12 calls a phase-less file a non-plan, agreeing with plot-fleet-scan.sh', () => {
  // #254 decided a file whose phase parses as NONE is not a plan. This script
  // used to call the same file a plan needing attention; that split is closed
  // in #254's direction, and the file stays visible at convenience level
  // (index drift, section 12 since the unsliced-wave, prose-name, and sprint-drift
  // sections took 7, 8 and 9).
  const sections = splitSections(report);
  assert.match(sections['12'], /2026-01-04-legacy\.md — no phase field → not a plan/);
  assert.doesNotMatch(sections['5'], /2026-01-04-legacy\.md/);
});

test('scan: section 5 still flags a DANGLING index symlink as attention', () => {
  // The contrast the demotion must preserve: no link is cosmetic, a link
  // pointing at nothing is a broken pointer. No fix command is offered —
  // repoint or remove is a judgment the script cannot make.
  const sections = splitSections(report);
  assert.match(sections['5'], /plans\/active\/vanished\.md — symlink target missing: \.\.\/2026-01-99-vanished\.md \(dangling index link\)/);
  assert.doesNotMatch(sections['12'], /vanished\.md/);
});

test('scan: section 1 flags a Superseded plan still symlinked in active/ (terminal drift)', () => {
  assert.match(report, /2026-01-06-sigma\.md — phase 'Superseded' \(terminal\) but symlink still in plans\/active\//);
  assert.match(report, /fix: git rm plans\/active\/sigma\.md && ln -s \.\.\/2026-01-06-sigma\.md plans\/delivered\/sigma\.md && git add -A/);
});

test('scan: section 12 routes an unlinked Superseded plan to delivered/, not active/', () => {
  const sections = splitSections(report);
  assert.match(sections['12'], /2026-01-07-tau\.md — phase 'Superseded', no symlink/);
  assert.match(sections['12'], /optional: ln -s \.\.\/2026-01-07-tau\.md plans\/delivered\/tau\.md/);
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
  // unplanned_members / sprint_unset / sprint_mismatch: 0 — the fixture has
  // no sprint files, so all three sprint-membership sections are silent. They
  // are three counters rather than one because they answer three questions:
  // a member naming no plan is not drift at all, and burying it with the two
  // real defects is what left `sprint_drift=57` unread for weeks.
  // stale_tally: 0 — no sprint files, so the stale-tally section is silent.
  // double_claims: 0 — every branch in this fixture is named by exactly one
  // plan, so that section is silent; its collision case has its own fixture.
  // rounds_drift: 0 — no plan here is Draft and none records a Rounds: value,
  // so that section is silent; its stale-round case has its own fixture.
  // sprint_index_drift: 0 — no sprint files, so that section is silent as
  // well; both its directions have their own fixture.
  // sprint_shipped: 0 — no sprint files and no tags, so that section is
  // silent; its shipped-release case has its own fixture.
  // desks: 0 — and the zero is the property, not an accident. This fixture
  // declares no `Worktree root`, so no tree is even a candidate desk and the
  // checkout itself produces nothing. A non-zero here would mean the sweep had
  // started reporting on a person's own checkout, which is the failure mode
  // `desk-finding.test.mjs` guards from the other side.
  const last = report.trim().split('\n').at(-1);
  assert.equal(last,
    'summary: drift=2 merged_not_delivered=1 stale=2 claims=0 attention=1 concurrent=2 unreleased_delivered=1 uncut_slices=0 prose_slice_names=0 unplanned_members=0 sprint_unset=0 sprint_mismatch=0 stale_tally=0 index_drift=3 double_claims=0 rounds_drift=0 sprint_index_drift=0 sprint_shipped=0 stated_waits=0 unclaimed_work=0 merged_refs=0 desks=0 no_changeset=0 open_issues=0 pr_source=degraded main=main');
});

// A docs plan that also names a Sprint. Section 6 exempts docs/infra plans by
// `case "$ptype" in docs|infra) continue`, and the exemption silently stopped
// working when `sprint` was appended to the jq row: the loop read EIGHT
// variables for NINE fields, so bash's last-variable-takes-the-rest rule gave
// `ptype` the value `docs<US>the-sprint`, which matches neither arm.
//
// Measured 2026-09-16 on the live estate: two docs/infra plans were reported
// as `unreleased_delivered`, and /plot-release's gate is a hard stop on any
// non-zero. The two other readers of the same row were unaffected only because
// they discard the field (`_ptype`) rather than test it.
//
// THE SPRINT FIELD IS THE POINT. A docs plan with no sprint produces a bare
// `docs` even with the shifted read, so a fixture without one passes either
// way and pins nothing.
test('scan: a docs plan naming a sprint is still exempt from section 6', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-docs-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const f = path.join(repo, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  w('CLAUDE.md', ['# Fixture', '', '## Plot Config', '',
    '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/',
    '- **Plan directory:** plans/', '- **Active index:** plans/active/',
    '- **Delivered index:** plans/delivered/', ''].join('\n'));
  w('plans/2026-01-01-a-docs-plan.md', ['# A docs plan', '', '## Status', '',
    '- **State:** Delivered', '- **Type:** docs',
    '- **Sprint:** a-sprint-with-a-long-name', '- **Delivered:** 2026-01-01', '',
    '## Slices', '', '### One (Branch: docs/a-docs-plan, PR: #1)', '',
    '- `docs/a-docs-plan` — the slice', ''].join('\n'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'fixture');
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'tag', 'v1.0.0');

  // `--no-fetch`, NOT `--offline`. This test pins the docs/infra exemption,
  // which lives INSIDE section 6's loop — and since 2026-09-17 `--offline` sets
  // `PR_SOURCE=off` and the loop skips every plan before reaching it. Under the
  // flag this assertion would still pass, for a reason that is not the one it
  // states: a `0` produced by a section that never ran. The origin here is a
  // local path, so there is no host to reach and no network cost to avoid.
  const out = execFileSync('bash', [scan, '--no-fetch'], {
    encoding: 'utf8', cwd: repo,
  });
  const footer = out.trim().split('\n').at(-1);
  assert.match(footer, /unreleased_delivered=0/,
    `a docs plan naming a sprint must stay exempt from section 6: ${footer}`);
  assert.equal(lineMatching(out, /a-docs-plan.*still Delivered/).length, 0,
    'section 6 named a docs plan');
  // The exemption must be what produced the zero. Without this the test passes
  // whenever the section is skipped for ANY reason — which is precisely the
  // failure mode the flag guard introduced.
  assert.doesNotMatch(out, /release state not resolved/,
    'the zero must come from the exemption, not from a skipped section');
  fs.rmSync(tmp, { recursive: true, force: true });
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
  // Link every plan so index drift stays silent — keeps this
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
// Section 13: stale sprint tally (unchecked items whose plan is delivered or
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
- [ ] [no-such-plan] Unchecked, slug names no plan — silent (the unplanned-members finding)
- [ ] A bare prose line with no slug — silent (no plan to check)
`);

  git(stRepo, 'add', '-A');
  git(stRepo, 'commit', '-q', '-m', 'fixture');
  git(stRepo, 'push', '-q', 'origin', 'main');

  stReport = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: stRepo });
  stSections = splitSections(stReport);
});
after(() => fs.rmSync(stTmp, { recursive: true, force: true }));

test('scan: section 13 reports an unchecked item whose plan is delivered', () => {
  const hits = stSections['13'].split('\n')
    .filter((l) => l.includes('delivered-plan') && l.includes('unchecked'));
  assert.equal(hits.length, 1, `expected exactly one delivered-plan stale finding, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /unchecked but plan is delivered/);
});

test('scan: section 13 reports an unchecked item whose plan is released', () => {
  const hits = stSections['13'].split('\n')
    .filter((l) => l.includes('released-plan') && l.includes('unchecked'));
  assert.equal(hits.length, 1, `expected exactly one released-plan stale finding, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /unchecked but plan is released/);
});

test('scan: section 13 is silent for an unchecked item whose plan is NOT delivered', () => {
  assert.doesNotMatch(stSections['13'], /approved-plan/);
});

test('scan: section 13 is silent for a checked item (even if plan is delivered)', () => {
  // The delivered-plan appears once (unchecked) but not twice (the checked line).
  const hits = stSections['13'].split('\n')
    .filter((l) => l.includes('delivered-plan') && l.includes('unchecked'));
  assert.equal(hits.length, 1, 'only the unchecked mention should appear');
});

test('scan: section 13 skips an unresolvable slug silently', () => {
  // [no-such-plan] names no plan file. This is NOT a section 13 finding — it is
  // the unplanned-members finding (section 9). The stale-tally section must NOT
  // report it as stale.
  assert.doesNotMatch(stSections['13'], /no-such-plan/);
  // But the unplanned-members section should catch it.
  assert.match(stSections['9'], /no-such-plan/);
});

test('scan: section 13 skips a bare prose line silently', () => {
  // "A bare prose line with no slug" has no `[slug]` — the regex never matches.
  assert.doesNotMatch(stSections['13'], /bare prose/);
});

test('scan: section 13 footer counter matches the number of findings', () => {
  // delivered-plan (delivered) + released-plan (released) = 2 findings.
  const bodyFindings = stSections['13'].split('\n').filter((l) => l.includes('unchecked but plan is')).length;
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

test('scan: section 13 covers CLOSED sprints, not just active ones', () => {
  // The fixture sprint is Phase: Closed. The fact that findings appear at all
  // proves closed sprints are walked. This test pins the premise: if the sprint
  // were somehow active-only, stale_tally=0 would be the silent failure.
  const footer = stReport.trim().split('\n').at(-1);
  assert.match(footer, /\bstale_tally=2\b/, 'closed sprint must produce findings');
});

// ---------------------------------------------------------------------------
// Section 14: double-claimed branches (one branch listed by more than one plan).
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

test('scan: section 14 reports a doubly-claimed branch once, naming both plans and their waves', () => {
  const hits = dcSections['14'].split('\n').filter((l) => l.includes('feature/contested') && l.includes('claimed by'));
  assert.equal(hits.length, 1, `expected exactly one collision finding, got:\n${hits.join('\n')}`);
  // Both plans AND the wave each lists it under — the plan line asks for both.
  assert.match(hits[0], /first-claimant \(Shared\)/);
  assert.match(hits[0], /second-claimant \(Disputed\)/);
  assert.match(hits[0], /claimed by 2 plans/);
  // And the actionable line a person runs — resolve:, not fix:.
  assert.match(dcSections['14'], /resolve: decide which plan owns `feature\/contested`/);
});

test('scan: section 14 is silent for a branch claimed by exactly one plan', () => {
  assert.doesNotMatch(dcSections['14'], /feature\/first-only/);
  assert.doesNotMatch(dcSections['14'], /feature\/second-only/);
  assert.doesNotMatch(dcSections['14'], /feature\/citing-own/);
});

test('scan: section 14 does not read a CITATION as a second claim', () => {
  // citing.md names `feature/contested` in a blockquote AND inside its own
  // branch line's description — the two shapes the pre-#490 matcher read as
  // claims. It must not appear as a claimant, and the count must stay 2.
  assert.doesNotMatch(dcSections['14'], /citing \(/);
  const hits = dcSections['14'].split('\n').filter((l) => l.includes('claimed by'));
  assert.match(hits[0], /claimed by 2 plans/, 'a citation must not raise the claimant count');
});

test('scan: section 14 does not treat a phase-less file as a claimant', () => {
  // notes.md lists `feature/contested` in claim shape but has no Phase:, so it
  // is not a plan. Catches a second parser that treats every .md as a plan.
  assert.doesNotMatch(dcSections['14'], /notes \(/);
});

test('scan: section 14 does not report a plan colliding with itself', () => {
  // self-repeat.md lists `feature/repeated` in two of its own waves. That is one
  // claimant, not a conflict — a different fault with a different repair.
  assert.doesNotMatch(dcSections['14'], /feature\/repeated/);
});

test('scan: section 14 footer counter matches the number of findings', () => {
  // One collision (feature/contested). The counter must be wired to the same
  // variable the body increments — a footer wired to a different variable is a
  // bug no single-finding assertion above can see.
  const bodyFindings = dcSections['14'].split('\n').filter((l) => l.includes('claimed by')).length;
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

test('scan: a double claim sits below the blocking-sections marker', () => {
  // WHAT KEEPS IT OUT OF THE DELIVERY GATE IS THE MARKER, NOT ITS NUMBER. This
  // used to assert that section 14 was double claims and section 7 was uncut
  // slices, because the gate read `== 7.` and a section inserted below it would
  // silently shrink the gate. The gate now reads to the marker, so what is
  // worth pinning is which SIDE of it this section falls on.
  assert.ok(
    dcReport.indexOf('== blocking sections end ==') <
      dcReport.indexOf('== 14. Double-claimed branches'),
    'the double-claim section must sit below the boundary marker',
  );
});

// ---------------------------------------------------------------------------
// Stale interrogation rounds (section 15).
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

test('scan: section 15 reports a Draft plan amended since its recorded round, naming both commits', () => {
  assert.match(srSections['15'], /2026-04-01-stale-round\.md — records round 2 \(last written in [0-9a-f]+\), amended since in [0-9a-f]+/);
  // The finding names its inputs, so a reader can judge it — and the two
  // commits must DIFFER, or the comparison reported nothing.
  const m = /records round 2 \(last written in ([0-9a-f]+)\), amended since in ([0-9a-f]+)/.exec(srSections['15']);
  assert.ok(m, 'the finding must name both commits');
  assert.notEqual(m[1], m[2], 'the round commit and the amendment must be different commits');
  // A hint, not an order: the verb is `consider:`, not `fix:`.
  assert.match(srSections['15'], /consider: re-question the plan/);
});

test('scan: section 15 treats `Rounds: 0` as a recorded value, not as absence', () => {
  // The parser emits `"rounds":0` for this plan and NO `rounds` key for one
  // with no field. A shell test on truthiness would silence exactly this plan —
  // the one that explicitly said it was never questioned.
  assert.match(srSections['15'], /2026-04-02-zero-round\.md — records round 0 \(last written in [0-9a-f]+\)/);
});

test('scan: section 15 is silent for a plan with no Rounds: field', () => {
  // THE HALF A CARELESS IMPLEMENTATION GETS WRONG. This plan was amended in the
  // same commit as the two reported above, so only the missing round separates
  // it from them: a plan nobody has questioned is honestly unquestioned.
  assert.doesNotMatch(srSections['15'], /never-questioned/);
});

test('scan: section 15 is silent for an Approved plan', () => {
  // Records round 3, amended after it — and out of scope. An Approved plan has
  // passed the review the questioning feeds; the badge a reader judges belongs
  // to a Draft plan's card.
  assert.doesNotMatch(srSections['15'], /2026-04-04-approved\.md/);
});

test('scan: section 15 is silent for a Draft plan untouched since its round', () => {
  assert.doesNotMatch(srSections['15'], /2026-04-05-current\.md/);
});

test('scan: section 15 footer counter matches the number of findings', () => {
  // Two findings: the round-2 plan and the round-0 plan. The counter must be
  // wired to the same variable the body increments — a footer wired to a
  // different variable is a bug no single-finding assertion above can see.
  const bodyFindings = srSections['15'].split('\n').filter((l) => l.includes('records round ')).length;
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

test('scan: a stale round sits below the blocking-sections marker', () => {
  // Same rule as the double-claim section above, and the same reason this test
  // no longer names a number: the gate reads to the marker, so the placement
  // that matters is which side of it this section falls on.
  assert.ok(
    srReport.indexOf('== blocking sections end ==') <
      srReport.indexOf('== 15. Stale interrogation rounds'),
    'the stale-round section must sit below the boundary marker',
  );
});

// ---------------------------------------------------------------------------
// The delivery gate stops at a name, not a line number.
//
// /plot-deliver's delivery-landed gate reads the scan to a boundary and greps
// what came before it. The boundary's MEANING is *the last section that stops a
// delivery*; its EXPRESSION was the number 7, and the two agreed by maintenance
// — this scan has been renumbered twice, and each time somebody had to notice.
//
// So the property under test is the one the old `sed` lacked: INSERTING A
// SECTION BELOW THE OLD MARKER MUST NOT CHANGE WHAT THE GATE BLOCKS ON. The
// tests run the skill's own command, verbatim, over a real report — and then
// over the same report renumbered — and assert the two answers are identical.
// ---------------------------------------------------------------------------

/** The marker line the scan emits between the blocking and advisory sections. */
const BOUNDARY = '== blocking sections end ==';

/**
 * /plot-deliver's gate, run exactly as the skill writes it.
 *
 * The command is `sed` and `grep` through a shell, not a JavaScript
 * reimplementation: a reimplementation would pass while the shipped line
 * failed, which is the whole risk a gate test exists to cover.
 */
function runGate(reportText, slug) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gate-'));
  const file = path.join(dir, 'gate.txt');
  fs.writeFileSync(file, reportText);
  const res = execFileSync(
    'bash',
    ['-c', `sed -n '/^== ${BOUNDARY.slice(3)}/q;p' "$1" | grep -F "$2" || true`, '_', file, slug],
    { encoding: 'utf8' },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

/**
 * Adds a blocking section and renumbers everything after it — the edit the old
 * gate could not survive.
 *
 * IT GOES INSIDE THE BLOCKING SET, at 6, which is what makes this the real
 * defect rather than a rearrangement. Every advisory section shifts up by one,
 * so the first non-blocking section becomes 8 while the literal `== 7.` the old
 * gate stopped at now names a BLOCKING section — the gate silently stopped one
 * section short of the boundary it was written to find. The marker moves with
 * the boundary; the number does not.
 */
function withBlockingSectionAdded(reportText) {
  // IT INSERTS AT THE MARKER, NOT AT A NUMBER. This keyed off `n >= 6` until
  // 2026-09-18, when the release question moved below the marker and kept the
  // number 6 — so a numeric rule would have planted the new "blocking" section
  // BELOW the boundary and asserted the opposite of what this fixture means.
  // The marker is where the boundary is; that is the property under test, so it
  // is also how the edit is made.
  const out = [];
  let inserted = false;
  let seenBoundary = false;
  for (const line of reportText.split('\n')) {
    if (line === BOUNDARY) {
      // The last blocking slot: everything after this is advisory.
      out.push('== 6. A blocking section somebody added later ==');
      out.push('  plans/2026-01-05-inserted.md — a finding that must gate');
      out.push('');
      inserted = true;
      seenBoundary = true;
      out.push(line);
      continue;
    }
    // Renumber the sections that follow the insertion in PRINT order, so the
    // advisory set shifts exactly as it would if a real section were added.
    const m = /^== (\d+)\. (.*)$/.exec(line);
    if (m && (seenBoundary || Number(m[1]) >= 6)) {
      out.push(`== ${Number(m[1]) + 1}. ${m[2]}`);
      continue;
    }
    out.push(line);
  }
  assert.ok(inserted, 'the fixture must carry the boundary marker to insert at');
  return out.join('\n');
}

test('gate: the scan emits the boundary marker exactly once', () => {
  // ONCE, because `sed … q` stops at the first match: a second marker would be
  // unreachable and a reader would not know which one gates.
  const hits = report.split('\n').filter((l) => l === BOUNDARY);
  assert.equal(hits.length, 1, 'exactly one boundary marker');
});

test('gate: the blocking sections sit above the marker and the advisory ones below', () => {
  // The blocking set is FIVE SECTIONS, NAMED. It read `number <= 6` until
  // 2026-09-18, which derived placement FROM the number — the very coupling the
  // marker exists to break, and the reason a `== 7.` gate had to be replaced.
  // Section 6 now prints LAST, below the marker, so a numeric predicate cannot
  // express the boundary at all; the names can, and they are what a reader of
  // CLAUDE.md checks this against.
  const BLOCKING = [
    'Phase<->symlink drift',
    'Merged-but-not-delivered',
    'Stale branches',
    'Concurrent-delivery check',
    'Needs attention',
  ];
  const lines = report.split('\n');
  const boundaryAt = lines.indexOf(BOUNDARY);
  assert.ok(boundaryAt > 0, 'the marker must be in the report');

  const headingsAbove = lines
    .slice(0, boundaryAt)
    .filter((l) => /^== \d+\. /.test(l));
  assert.equal(
    headingsAbove.length,
    BLOCKING.length,
    `exactly ${BLOCKING.length} sections may gate a delivery`,
  );
  for (const [i, title] of BLOCKING.entries()) {
    assert.ok(
      headingsAbove[i].includes(title),
      `blocking section ${i + 1} must be ${title}, got: ${headingsAbove[i]}`,
    );
  }

  // And the release question is below it — the defect this pins. A section that
  // asks which release contains a plan cannot stop the next delivery.
  const releaseAt = lines.findIndex((l) => /^== \d+\. Delivered but already released/.test(l));
  assert.ok(releaseAt > boundaryAt, 'the release question must not gate a delivery');
});

test('gate: a release-question finding does not reach the delivery gate', () => {
  // THE DEFECT, RUN THROUGH THE SHIPPED COMMAND. Section 6 asks which release
  // contains a plan. Its unanswerable case is `cannot resolve`, and on a host
  // whose pr-state carries no merge commit that is EVERY delivered plan: the
  // reporting repository measured 45 findings and `unreleased_delivered=82`,
  // with section 6 above the marker, so no delivery could ever clear step 7b.
  //
  // The fixture is the real report plus one such finding, and the assertion runs
  // /plot-deliver's own `sed`+`grep` — `runGate` — rather than reasoning about
  // placement, because the gate is a shell line and only the shell line can fail
  // the way the operator's did.
  const lines = report.split('\n');
  const sixAt = lines.findIndex((l) => /^== \d+\. Delivered but already released/.test(l));
  assert.ok(sixAt > 0, 'the fixture must carry the release-question section');

  const planted = [...lines];
  planted.splice(
    sixAt + 1,
    0,
    '  2026-01-09-bitbucket.md — delivered, but PR #943 has no merge commit → cannot resolve',
  );
  const withFinding = planted.join('\n');

  // The finding IS in the report — the section still reports exactly as before.
  assert.match(withFinding, /2026-01-09-bitbucket\.md/);
  // And the gate cannot see it, because the section sits below the marker.
  assert.equal(
    runGate(withFinding, '2026-01-09-bitbucket.md'),
    '',
    'a plan reported only as unreleased must not block its own delivery',
  );
});

test('gate: it blocks on a finding in a blocking section', () => {
  // The gate must still REFUSE what it refuses today. `vanished` is the main
  // fixture's dangling index link, planted in section 5 — the section CLAUDE.md
  // names as the one that gates.
  const out = runGate(report, 'vanished');
  assert.match(out, /vanished/, 'a section-5 finding must reach the gate');
});

test('gate: it permits a plan named only by the convenience index', () => {
  // AND STILL PERMITS WHAT IT PERMITS. `omega` appears only in index drift —
  // a plan with no symlink, which since the phase grouping became derived is a
  // browsing gap rather than a half-landed delivery. It is below the marker,
  // and a gate that reached it would refuse a delivery that landed.
  assert.match(report, /2026-01-05-omega\.md/, 'the fixture must name omega somewhere');
  assert.equal(runGate(report, 'omega'), '', 'an index-drift-only plan must not gate');
});

test('gate: it permits a finding that sits only below the marker', () => {
  // And still PERMIT what it permits. A plan named only under an advisory
  // section clears the gate — this is the half a marker placed too late breaks.
  const advisoryOnly = [
    '== 1. Phase<->symlink drift ==',
    '  (none)',
    '',
    BOUNDARY,
    '',
    '== 7. Uncut slices ==',
    '  plans/2026-01-01-quiet.md — one slice, three branches',
    '',
    'summary: attention=0',
  ].join('\n');
  assert.equal(runGate(advisoryOnly, 'quiet'), '', 'an advisory-only finding must not gate');
});

test('gate: adding a section does not change what it gates on', () => {
  // THE TEST THE PLAN NAMES, and the property the `== 7.` sed lacked.
  //
  // Both halves are asserted, because only one of them fails loudly. A gate that
  // stops SHORT hides a half-landed delivery; a gate that reads too FAR blocks a
  // delivery on a shape nobody had to fix.
  const renumbered = withBlockingSectionAdded(report);
  assert.match(renumbered, /^== 6\. A blocking section somebody added later/m);
  assert.match(renumbered, /^== 8\. Uncut slices/m, 'the advisory sections must have shifted');

  // `vanished` still gates and `omega` still does not — the two answers the
  // delivery gate gives today, unchanged by the renumbering.
  for (const slug of ['vanished', 'omega']) {
    assert.equal(
      runGate(renumbered, slug),
      runGate(report, slug),
      `a renumbering must not change what the gate blocks on (${slug})`,
    );
  }
  // And the ADDED blocking section gates, because it went above the marker.
  assert.match(runGate(renumbered, 'inserted'), /inserted/);
});

test('gate: the old positional marker would have been fooled by that same edit', () => {
  // THE DEFECT, DEMONSTRATED RATHER THAN ASSERTED. Without this the test above
  // could pass against a gate that never had the bug; this proves the fixture
  // reproduces the failure the marker prevents.
  //
  // The old gate stopped at the literal `== 7.`. After the insertion a section
  // that used to be advisory carries the number 7 no longer, or a blocking one
  // carries it instead — either way the old gate stops short of its own
  // boundary, reading less of the report than it was written to read.
  const renumbered = withBlockingSectionAdded(report);
  const oldGate = (text) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gate-old-'));
    const file = path.join(dir, 'gate.txt');
    fs.writeFileSync(file, text);
    const res = execFileSync(
      'bash',
      ['-c', `sed -n '/^== 7\\./q;p' "$1" | grep -c . || true`, '_', file],
      { encoding: 'utf8' },
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return Number(res.trim());
  };
  const sectionsRead = (text) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-gate-cnt-'));
    const file = path.join(dir, 'gate.txt');
    fs.writeFileSync(file, text);
    const res = execFileSync(
      'bash',
      ['-c', `sed -n '/^== 7\\./q;p' "$1" | grep -cE '^== [0-9]+\\. ' || true`, '_', file],
      { encoding: 'utf8' },
    );
    fs.rmSync(dir, { recursive: true, force: true });
    return Number(res.trim());
  };
  /** Sections above the marker — the boundary as the shipped gate reads it. */
  const trueBlocking = (text) =>
    text
      .slice(0, text.indexOf(BOUNDARY))
      .split('\n')
      .filter((l) => /^== \d+\. /.test(l)).length;

  // THE COUNTS ARE DERIVED, NOT WRITTEN DOWN. They were the literals 6 and 7
  // until 2026-09-18, when the blocking set legitimately shrank to five and this
  // test failed for a reason that had nothing to do with the defect it
  // demonstrates. The defect is a RELATIONSHIP — the old gate reads the same
  // number of sections before and after an insertion, while the real boundary
  // grows by one — and that holds whatever the set's size is.
  const before = trueBlocking(report);
  const after = trueBlocking(renumbered);
  assert.equal(after, before + 1, 'the fixture must add exactly one blocking section');

  // THE OLD GATE TRACKS A NUMBER, NOT THE BOUNDARY, and after the insertion the
  // two disagree. Which DIRECTION it is wrong in depends on where the numbers
  // land — it reads too few when a blocking section takes the number 7, and the
  // whole report when no section carries 7 at all, which is this fixture today.
  // Asserting a specific wrong count would pin an accident of the fixture; what
  // the marker fixes is that the count is unrelated to the boundary.
  assert.notEqual(
    sectionsRead(renumbered),
    after,
    `the old gate must not happen to read the ${after} blocking sections`,
  );
  // The marker, by contrast, reads exactly the boundary — before and after.
  assert.equal(trueBlocking(report), before, 'the marker reads the boundary before the edit');
  assert.equal(trueBlocking(renumbered), after, 'and after it');
  assert.ok(oldGate(renumbered) > 0, 'the fixture is non-trivial');
});

// ---------------------------------------------------------------------------
// Section 16: sprint phase vs index. Two records of ONE fact — is this sprint
// running — and until this section nothing read the pair.
//
// The estate had ZERO instances when this shipped: the `Planned` sprint sitting
// in the index was corrected by hand the day the plan was written. So the
// section is only provable against a fixture, and a fixture is the only thing
// that will still prove it after the next hand correction.
//
// Properties under test:
// 1. Active with no link in the index is reported
// 2. Linked while Planned is reported — the OTHER direction, which is the half
//    a filename comparison would miss and the half measured first
// 3. Linked while Closed is reported too; the index claims what the file denies
// 4. Active AND linked is silent — they agree
// 5. Closed and unlinked is silent — they agree the other way
// 6. A sprint file with no `Phase:` line is skipped, never guessed at
// 7. The link is resolved by READING it: the link is named for the slug and the
//    file for the week, so no name comparison relates the two
// 8. The footer counter sprint_index_drift= matches the findings
// 9. attention= is unchanged — this section does NOT gate
// ---------------------------------------------------------------------------

let spTmp, spRepo, spReport, spSections;

before(() => {
  spTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-sp-'));
  const origin = path.join(spTmp, 'origin.git');
  spRepo = path.join(spTmp, 'repo');
  git(spTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(spTmp, 'clone', '-q', origin, spRepo);
  git(spRepo, 'config', 'user.email', 'test@example.invalid');
  git(spRepo, 'config', 'user.name', 'Plot Test');
  git(spRepo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(spRepo, rel);
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

  const sprint = (title, phase) => `# Sprint: ${title}

## Status

- **Phase:** ${phase}
- **Start:** 2026-01-01
- **End:** 2026-01-14
`;

  // The measured defect's second direction: Active, and the index does not
  // know. `2026-W35-the-board-tells-the-truth-in-every-section` was this.
  w('sprints/2026-W01-unlinked-active.md', sprint('Unlinked Active', 'Active'));

  // The measured defect's first direction: in the index, and the file says it
  // is not running. This was the whole of the 2026-09-06 reading.
  w('sprints/2026-W02-linked-planned.md', sprint('Linked Planned', 'Planned'));

  // The same disagreement from the far end of the lifecycle.
  w('sprints/2026-W03-linked-closed.md', sprint('Linked Closed', 'Closed'));

  // Agreement, both ways — neither may be reported.
  w('sprints/2026-W04-linked-active.md', sprint('Linked Active', 'Active'));
  w('sprints/2026-W05-unlinked-closed.md', sprint('Unlinked Closed', 'Closed'));

  // No `Phase:` at all. Not a sprint this section can ask about, so it is
  // skipped rather than guessed at — the rule sections 1, 7, 8, 12 and 13 all
  // apply to a plan with no phase.
  w('sprints/2026-W06-no-phase.md', `# Sprint: No Phase

Prose only — this file never declares a phase.
`);

  // THE LINKS ARE NAMED FOR THE SLUG, THE FILES FOR THE WEEK. That is the real
  // estate's shape — `the-domain-owns-the-lifecycle.md` points at
  // `2026-W37-the-domain-owns-the-lifecycle.md` — so a section comparing
  // filenames would see no link at all and report every Active sprint.
  fs.mkdirSync(path.join(spRepo, 'sprints', 'active'), { recursive: true });
  fs.symlinkSync('../2026-W02-linked-planned.md',
    path.join(spRepo, 'sprints', 'active', 'linked-planned.md'));
  fs.symlinkSync('../2026-W03-linked-closed.md',
    path.join(spRepo, 'sprints', 'active', 'linked-closed.md'));
  fs.symlinkSync('../2026-W04-linked-active.md',
    path.join(spRepo, 'sprints', 'active', 'linked-active.md'));

  git(spRepo, 'add', '-A');
  git(spRepo, 'commit', '-q', '-m', 'sprint index fixture');
  git(spRepo, 'push', '-q', 'origin', 'main');

  spReport = execFileSync('bash', [scan], { encoding: 'utf8', cwd: spRepo });
  spSections = splitSections(spReport);
});

after(() => {
  if (spTmp) fs.rmSync(spTmp, { recursive: true, force: true });
});

test('scan: section 16 reports an Active sprint missing from the index', () => {
  assert.match(spSections['16'], /2026-W01-unlinked-active\.md/,
    `an Active sprint with no link must be named:\n${spSections['16']}`);
  assert.match(spSections['16'], /Phase: Active, but no link/,
    'and the line must say which way the disagreement runs');
});

test('scan: section 16 reports a linked sprint that is not Active', () => {
  // The direction measured on 2026-09-06, and the one a filename comparison
  // cannot see.
  assert.match(spSections['16'], /2026-W02-linked-planned\.md/,
    `a Planned sprint in the index must be named:\n${spSections['16']}`);
  assert.match(spSections['16'], /Phase: Planned, but still linked/,
    'and the line must say the index claims what the file denies');

  assert.match(spSections['16'], /2026-W03-linked-closed\.md/,
    'a Closed sprint in the index is the same finding');
  assert.match(spSections['16'], /Phase: Closed, but still linked/,
    'named by its own phase, not by a collapsed "not Active"');
});

test('scan: section 16 is silent when phase and index agree', () => {
  assert.doesNotMatch(spSections['16'], /2026-W04-linked-active/,
    `Active and linked agree:\n${spSections['16']}`);
  assert.doesNotMatch(spSections['16'], /2026-W05-unlinked-closed/,
    `Closed and unlinked agree:\n${spSections['16']}`);
});

test('scan: section 16 skips a sprint file with no phase', () => {
  // Not a sprint this section can ask about. Reporting it would say the index
  // is wrong when all that is known is that the file declares nothing.
  assert.doesNotMatch(spSections['16'], /2026-W06-no-phase/,
    `a file with no Phase: is skipped:\n${spSections['16']}`);
});

test('scan: section 16 resolves the link by reading it, not by its name', () => {
  // `linked-active.md` -> `2026-W04-linked-active.md`. Nothing in the link's
  // own name matches the file's, so a name comparison would find no link and
  // report this sprint as an unlinked Active one. Its absence is the proof.
  assert.doesNotMatch(spSections['16'], /2026-W04/,
    `the slug-named link must resolve to the week-named file:\n${spSections['16']}`);
});

test('scan: section 16 counts in the footer and gates nothing', () => {
  const footer = spReport.trim().split('\n').at(-1);
  assert.match(footer, /\bsprint_index_drift=3\b/,
    `three disagreements, one counter:\n${footer}`);
  // THE POINT OF THE SECTION'S PLACEMENT. `attention=` is what /plot-deliver
  // gates on; a sprint indexed wrongly must never stop a delivery.
  assert.match(footer, /\battention=0\b/,
    `section 16 must not reach attention=:\n${footer}`);
});

test('scan: section 16 sits below the blocking marker', () => {
  // The marker is what /plot-deliver's gate reads to. A convenience section
  // above it would join the blocking set without any counter saying so.
  const marker = spReport.indexOf('== blocking sections end ==');
  const section = spReport.indexOf('== 16. ');
  assert.ok(marker > 0, 'the fixture report carries the marker');
  assert.ok(section > marker,
    'section 16 must sit below the marker, like every other advisory section');
});

test('scan: section 16 is distinct from the sprint-membership counters', () => {
  // `sprint_mismatch=` and `sprint_unset=` count PLANS whose `Sprint:` field
  // disagrees with, or is absent from, the sprint file listing them, and
  // `unplanned_members=` counts MEMBERS naming no plan. This fixture has no
  // plans at all, so all three stay zero while section 16 reports three — one
  // number could not have said both.
  const footer = spReport.trim().split('\n').at(-1);
  assert.match(footer, /\bsprint_mismatch=0\b/,
    `the plan-side mismatch counter is untouched:\n${footer}`);
  assert.match(footer, /\bsprint_unset=0\b/,
    `the plan-side unset counter is untouched:\n${footer}`);
  assert.match(footer, /\bunplanned_members=0\b/,
    `the member-side counter is untouched:\n${footer}`);
});

// ---------------------------------------------------------------------------
// Sprint outlived its release (section 17).
//
// A sprint that is NOT Closed whose declared `Release:` has been tagged. The
// train has left; the file has not caught up.
//
// A SEPARATE FIXTURE, because this section's subject is the pair
// (sprint file, git tag) and no other fixture here cuts a tag. Same minimal
// shape as the sprint-index one beside it: sprint files, no plans, no branches.
//
// The properties under test are the ones the plan's `## Done when` names:
//
// 1. A non-Closed sprint whose release shipped is reported
// 2. It names the sprint, its release and the tag
// 3. A Closed sprint is silent — that is the state this section is about
//    reaching, not a finding
// 4. A sprint whose release has NOT shipped is silent
// 5. A sprint with no `Release:` is silent
// 6. `Planning` is reported, not only `Planned` — the measured file's own word
// 7. A `Release:` carrying prose after the version still resolves
// 8. A tag without the `v` prefix is found
// 9. The footer counter sprint_shipped= matches the findings
// 10. attention= is unchanged, and the finding sits below the marker — this
//     section does NOT gate
// 11. It closes nothing and offers no close
// ---------------------------------------------------------------------------

let srlTmp, srlRepo, srlReport, srlSections;

before(() => {
  srlTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-srl-'));
  const origin = path.join(srlTmp, 'origin.git');
  srlRepo = path.join(srlTmp, 'repo');
  git(srlTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(srlTmp, 'clone', '-q', origin, srlRepo);
  git(srlRepo, 'config', 'user.email', 'test@example.invalid');
  git(srlRepo, 'config', 'user.name', 'Plot Test');
  git(srlRepo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(srlRepo, rel);
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

  const sprint = (title, phase, release) => `# Sprint: ${title}

## Status

- **Phase:** ${phase}
${release === null ? '' : `- **Release:** ${release}\n`}- **Start:** 2026-01-01
- **End:** 2026-01-14
`;

  // THE MEASURED CASE, and its own word for the phase. The real file reads
  // `Planning`, not the template's `Planned` — a section matching a list of
  // open phases would have missed the one sprint it exists for.
  w('sprints/2026-W01-shipped-planning.md', sprint('Shipped Planning', 'Planning', '1.1.0'));

  // Active and shipped: the same finding from the other live phase.
  w('sprints/2026-W02-shipped-active.md', sprint('Shipped Active', 'Active', '1.2.0'));

  // A `Release:` that carries prose after the version — measured on this
  // estate, where one sprint reads `2.13.0 — **released 2026-09-05**, ...`.
  // The FIRST N.N.N is the target and the rest is a note to a human.
  w('sprints/2026-W03-shipped-prose.md',
    sprint('Shipped Prose', 'Active', '1.3.0 — **released 2026-01-09**, see the notes below'));

  // A project that tags WITHOUT the `v` prefix. Both spellings are tried, so
  // this is not silently reported as unshipped.
  w('sprints/2026-W04-shipped-bare-tag.md', sprint('Shipped Bare Tag', 'Active', '1.4.0'));

  // CLOSED AND SHIPPED — silent. This is the state the section is about
  // reaching, so reporting it would report every finished sprint forever.
  w('sprints/2026-W05-closed-shipped.md', sprint('Closed Shipped', 'Closed', '1.1.0'));

  // Open, but its release has not shipped. Nothing has happened yet.
  w('sprints/2026-W06-unshipped.md', sprint('Unshipped', 'Active', '9.9.9'));

  // Open with no `Release:` at all — this sprint says nothing about a release.
  w('sprints/2026-W07-no-release.md', sprint('No Release', 'Active', null));

  git(srlRepo, 'add', '-A');
  git(srlRepo, 'commit', '-q', '-m', 'sprint release fixture');
  git(srlRepo, 'push', '-q', 'origin', 'main');

  // The tags the sprints above claim. `v`-prefixed for three, bare for one.
  for (const t of ['v1.1.0', 'v1.2.0', 'v1.3.0', '1.4.0']) {
    git(srlRepo, 'tag', t);
  }

  srlReport = execFileSync('bash', [scan], { encoding: 'utf8', cwd: srlRepo });
  srlSections = splitSections(srlReport);
});

after(() => {
  if (srlTmp) fs.rmSync(srlTmp, { recursive: true, force: true });
});

test('scan: section 17 reports a non-Closed sprint whose release shipped', () => {
  assert.match(srlSections['17'], /2026-W01-shipped-planning\.md/,
    `the measured case must be named:\n${srlSections['17']}`);
  assert.match(srlSections['17'], /2026-W02-shipped-active\.md/,
    `an Active sprint whose release shipped must be named too:\n${srlSections['17']}`);
});

test('scan: section 17 names the sprint, its release and the tag', () => {
  // NAMED, NEVER COUNTED. A reader who has to open the file to find out which
  // release shipped has been told nothing they could act on.
  const line = srlSections['17'].split('\n')
    .find((l) => l.includes('2026-W01-shipped-planning.md'));
  assert.ok(line, `the finding must be one line:\n${srlSections['17']}`);
  assert.match(line, /Phase: Planning/, 'the phase it is still in');
  assert.match(line, /\b1\.1\.0\b/, 'the release it declared');
  assert.match(line, /\bv1\.1\.0\b/, 'and the tag that shipped it');
});

test('scan: section 17 reads Planning, not only the template word Planned', () => {
  // THE MEASURED FILE'S OWN WORD. `a-half-landed-workflow-says-so` reads
  // `Phase: Planning` while the template says `Planned`, so the population is
  // written as "not Closed" rather than as a list of open phases — a list
  // would have missed the single sprint this section was built for.
  assert.match(srlSections['17'], /2026-W01-shipped-planning\.md — Phase: Planning/,
    `a Planning sprint must be reported:\n${srlSections['17']}`);
});

test('scan: section 17 resolves a release that carries prose after the version', () => {
  // Measured on this estate: `Release: 2.13.0 — **released 2026-09-05**, ...`.
  // `plot-sprint-release.sh` reports the field verbatim, which is right for a
  // facts collector; the first N.N.N in it is the target.
  assert.match(srlSections['17'], /2026-W03-shipped-prose\.md/,
    `a release with a trailing note must still resolve:\n${srlSections['17']}`);
  assert.match(srlSections['17'], /\bv1\.3\.0\b/, 'and find its tag');
});

test('scan: section 17 finds a tag with no v prefix', () => {
  // Sprints declare `1.4.0` and a project may tag either `v1.4.0` or `1.4.0`.
  // Trying one spelling only would report a shipped release as unshipped.
  const line = srlSections['17'].split('\n')
    .find((l) => l.includes('2026-W04-shipped-bare-tag.md'));
  assert.ok(line, `a bare tag must be found:\n${srlSections['17']}`);
  assert.match(line, /shipped as 1\.4\.0/, 'and named as the estate spells it');
});

test('scan: section 17 is silent about a Closed sprint', () => {
  // THE STATE THIS SECTION IS ABOUT REACHING. A Closed sprint whose release
  // shipped is a sprint that finished correctly; reporting it would report
  // every finished sprint forever, and the section would be noise by its
  // second week.
  assert.doesNotMatch(srlSections['17'], /2026-W05-closed-shipped\.md/,
    `a Closed sprint must not be reported:\n${srlSections['17']}`);
});

test('scan: section 17 is silent when the release has not shipped', () => {
  assert.doesNotMatch(srlSections['17'], /2026-W06-unshipped\.md/,
    `an open sprint whose release is untagged must be silent:\n${srlSections['17']}`);
});

test('scan: section 17 is silent when the sprint declares no release', () => {
  // A sprint with no `Release:` says nothing about a release, so there is no
  // pair to compare — the same rule `plot-sprint-release.sh` states.
  assert.doesNotMatch(srlSections['17'], /2026-W07-no-release\.md/,
    `a sprint with no release target must be silent:\n${srlSections['17']}`);
});

test('scan: section 17 counts in the footer and gates nothing', () => {
  const footer = srlReport.trim().split('\n').at(-1);
  assert.match(footer, /\bsprint_shipped=4\b/,
    `four sprints shipped their release:\n${footer}`);
  // AND attention= IS UNTOUCHED. /plot-deliver's gate and the /plot hygiene
  // line both read that counter; a sprint whose release shipped is somebody
  // else's paperwork and must not stop a delivery.
  assert.match(footer, /\battention=0\b/,
    `this section must not reach the gating counter:\n${footer}`);
});

test('scan: section 17 sits below the blocking-sections marker', () => {
  // The placement is what keeps it out of /plot-deliver's gate, which reads to
  // the marker rather than to a section number.
  const marker = srlReport.indexOf('== blocking sections end ==');
  const section = srlReport.indexOf('== 17. Sprint outlived its release');
  assert.ok(marker > 0 && section > marker,
    'section 17 must sit below the marker, like every other advisory section');
});

test('scan: the delivery gate cannot see a shipped-release finding', () => {
  // THE PROPERTY, MEASURED THE WAY /plot-deliver MEASURES IT rather than
  // asserted about line numbers: everything the gate reads is above the marker,
  // and no sprint of this fixture appears there.
  const gated = srlReport.split('== blocking sections end ==')[0];
  for (const sprint of ['2026-W01-shipped-planning', '2026-W02-shipped-active']) {
    assert.ok(!gated.includes(sprint),
      `${sprint} must be invisible to the delivery gate`);
  }
});

test('scan: section 17 closes nothing and offers no close', () => {
  // CLOSING IS THE TEAM'S WORD. A shipped release says the sprint's window
  // passed, not that its work is done — the measured sprint's eight items are
  // all still open — so the section names the fact and stops.
  assert.doesNotMatch(srlSections['17'], /\/plot-sprint close/,
    `the section must not offer to close:\n${srlSections['17']}`);
  // And it wrote nothing: the fixture's sprint files are untouched.
  const status = git(srlRepo, 'status', '--porcelain');
  assert.equal(status.trim(), '', 'the scan must not modify the working tree');
});

test('scan: section 17 is distinct from both sprint counters beside it', () => {
  // THREE QUESTIONS, THREE NUMBERS, and this fixture answers all three at once
  // — which is the argument for keeping them apart rather than a coincidence.
  //
  // `sprint_mismatch=` counts PLANS whose `Sprint:` field disagrees with the
  // sprint file; this fixture has no plans, so it is 0, as are the other two
  // sprint-membership counters beside it.
  //
  // `sprint_index_drift=` counts SPRINTS whose phase disagrees with the index.
  // It reads 5, not 0: five of these sprints are Active or Planning with no
  // link, which is section 16's finding and correct. The five are not the four
  // — `2026-W06-unshipped` and `2026-W07-no-release` are index findings and not
  // release ones, while `2026-W05-closed-shipped` is neither.
  //
  // A single counter answering both would report 9, or 5, or 4, and a reader
  // would have to open the report to re-derive which sprints were which. That
  // is exactly what section 16's slice argued against.
  const footer = srlReport.trim().split('\n').at(-1);
  assert.match(footer, /\bsprint_mismatch=0\b/, `the plan-side counter is untouched:\n${footer}`);
  assert.match(footer, /\bsprint_unset=0\b/, `and so is the unset counter:\n${footer}`);
  assert.match(footer, /\bunplanned_members=0\b/, `and so is the member-side counter:\n${footer}`);
  assert.match(footer, /\bsprint_index_drift=5\b/,
    `the index counter reports its own finding, on its own population:\n${footer}`);
  assert.match(footer, /\bsprint_shipped=4\b/, `and this one carries a different four:\n${footer}`);
  // The populations genuinely differ, which is the point rather than the count:
  // one sprint is reported by 14 and not by 15.
  assert.match(srlSections['16'], /2026-W06-unshipped\.md/, 'section 16 sees it');
  assert.doesNotMatch(srlSections['17'], /2026-W06-unshipped\.md/, 'section 17 does not');
});

// ---------------------------------------------------------------------------
// Section 18 — stated waits with no annotation.
//
// Its own fixture, because the discriminators are all about WORDING and the
// shared fixture's plans are written to exercise phases and symlinks. Proves:
//   1. A slice body claiming a wait with no `waits:` is reported, in both
//      plan dialects (`### ` heading and `- \`branch\`` list item)
//   2. The sentence is quoted, so a reader can judge the finding
//   3. A slice carrying the annotation is silent — the fix is the annotation
//   4. The subject must be the slice: a `--stop` that "waits for each worker
//      to exit" is a description of behaviour, not a dependency claim
//   5. A backticked span quotes the phrase and never claims it
//   6. A plan link or a PR number alone is NOT a wait — the drafted rule that
//      fired on 391 of 477 slices
//   7. `depends on` and `after` are not matched
//   8. Delivered and Released plans are not scanned
//   9. It counts in the footer, gates nothing, and sits below the marker
// ---------------------------------------------------------------------------

let swTmp, swRepo, swReport, swSections;

before(() => {
  swTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-sw-'));
  const origin = path.join(swTmp, 'origin.git');
  swRepo = path.join(swTmp, 'repo');
  git(swTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(swTmp, 'clone', '-q', origin, swRepo);
  git(swRepo, 'config', 'user.email', 'test@example.invalid');
  git(swRepo, 'config', 'user.name', 'Plot Test');
  git(swRepo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(swRepo, rel);
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

  const status = (phase) => `## Status

- **Phase:** ${phase}
- **Type:** bug
`;

  // THE MEASURED CASE, in the heading dialect. `a-desk-is-adopted-and-swept`
  // said exactly this and carried no annotation, so the branch read as
  // eligible and reached the supervisor's queue.
  w('plans/2026-01-01-stated.md', `# Stated

${status('Approved')}
## Slices

### A vanished desk is not a desk (Branch: bug/stated-heading)

**IT WAITS FOR [\`another-plan\`](2026-01-02-other.md) (#705).** That plan unifies two implementations of one question.

### Annotated already (Branch: bug/annotated-heading) <!-- waits: bug/stated-heading -->

**This slice waits on the branch above**, and its line says so — the annotation is the fix, so this must be silent.
`);

  // The list dialect: branch, annotation and body are ONE line.
  w('plans/2026-01-03-listed.md', `# Listed

${status('Draft')}
## Branches

- \`bug/stated-list\` — the repair lands here. **This slice waits on the parser slice**, which has to land first.
- \`bug/annotated-list\` <!-- waits: bug/stated-list --> — **it waits on the slice above**, and its line already says so.
`);

  // EVERY FALSE POSITIVE THE ESTATE MEASURED, in one live plan. None may
  // report: each was read by hand and is not a dependency claim.
  w('plans/2026-01-04-quiet.md', `# Quiet

${status('Approved')}
## Slices

### The fleet changes hands (Branch: bug/describes-behaviour)

**\`--stop\` IS AN ORCHESTRATION.** It calls \`plot-dispatch.sh --stop <branch>\` once per dispatched agent, waits for each worker to exit, and only then unloads the supervisor.

### The phrase is tabulated (Branch: bug/quotes-the-phrase)

Measured over the same 477 slices — the phrase this section matches is \`waits for\` / \`waits on\`, and quoting it must not report the slice that defines it.

### A link is not a claim (Branch: bug/links-a-plan)

Built on [\`the-other-plan\`](2026-01-02-other.md), and #705 lands the groundwork. The drafted rule fired on 391 of 477 slices exactly here.

### Near misses stay out (Branch: bug/near-misses)

This slice depends on the parser landing, and it goes after #705. Neither phrase is a dependency claim in this estate's usage.
`);

  // NOT SCANNED. A shipped plan's wait was resolved by shipping, and this is
  // the filter that takes the whole-estate count to zero.
  w('plans/2026-01-05-shipped.md', `# Shipped

${status('Released')}
## Slices

### Long since done (Branch: bug/released-stated)

**This slice waits on a branch that merged weeks ago**, and reporting it is noise about finished work.
`);
  w('plans/2026-01-06-delivered.md', `# Delivered

${status('Delivered')}
## Slices

### Also done (Branch: bug/delivered-stated)

**It waits on the slice before it**, and the plan is delivered.
`);

  git(swRepo, 'add', '-A');
  git(swRepo, 'commit', '-q', '-m', 'stated-waits fixture');
  git(swRepo, 'push', '-q', 'origin', 'main');

  swReport = execFileSync('bash', [scan, '--offline'], { encoding: 'utf8', cwd: swRepo });
  swSections = splitSections(swReport);
});

after(() => {
  if (swTmp) fs.rmSync(swTmp, { recursive: true, force: true });
});

test('scan: section 18 reports a stated wait in the heading dialect', () => {
  assert.match(swSections['18'], /bug\/stated-heading/,
    `the measured case must be named:\n${swSections['18']}`);
});

test('scan: section 18 reports a stated wait in the list dialect', () => {
  // Both plan shapes are live on this estate, and a section reading only one
  // is silent on half the plans without saying so.
  assert.match(swSections['18'], /bug\/stated-list/,
    `the list dialect must be read too:\n${swSections['18']}`);
});

test('scan: section 18 quotes the sentence', () => {
  // The finding is weaker than a verdict, so it must name its evidence: a
  // reader decides whether the sentence IS a dependency claim.
  assert.match(swSections['18'], /IT WAITS FOR/,
    `the claiming sentence must be quoted:\n${swSections['18']}`);
  assert.match(swSections['18'], /This slice waits on the parser slice/,
    'and the list dialect quotes its own line');
});

test('scan: section 18 is silent on a slice that carries the annotation', () => {
  // Adding `waits:` IS the repair, so the section must go quiet when it lands.
  assert.doesNotMatch(swSections['18'], /bug\/annotated-heading/,
    `an annotated heading is the fixed state:\n${swSections['18']}`);
  assert.doesNotMatch(swSections['18'], /bug\/annotated-list/,
    `and so is an annotated list item:\n${swSections['18']}`);
});

test('scan: section 18 does not match a wait whose subject is not the slice', () => {
  // The measured false positive: `--stop` waits for each worker to exit. The
  // sentence describes runtime behaviour; nothing about the slice waits.
  assert.doesNotMatch(swSections['18'], /bug\/describes-behaviour/,
    `a described wait is not a claimed one:\n${swSections['18']}`);
});

test('scan: section 18 does not match the phrase inside a code span', () => {
  // A plan documenting this section tabulates the phrases it matches. Without
  // the code-span strip, the slice that defines the check reports itself.
  assert.doesNotMatch(swSections['18'], /bug\/quotes-the-phrase/,
    `a backticked phrase quotes, it does not claim:\n${swSections['18']}`);
});

test('scan: section 18 does not match a plan link or a PR number', () => {
  // The drafted rule, measured at 391 of 477 slices — 82% of the estate. A
  // finding that fires on four slices in five is one a reader learns to skip.
  assert.doesNotMatch(swSections['18'], /bug\/links-a-plan/,
    `a citation is context, not a wait:\n${swSections['18']}`);
});

test('scan: section 18 does not match `depends on` or `after`', () => {
  // 29 further hits, and neither reads as a dependency claim here: `depends
  // on` is design rationale more often than ordering, `after` is temporal.
  assert.doesNotMatch(swSections['18'], /bug\/near-misses/,
    `the near misses stay out:\n${swSections['18']}`);
});

test('scan: section 18 scans only Draft and Approved plans', () => {
  // The filter that makes the section silent on today's estate. A shipped
  // plan's wait was resolved by shipping.
  assert.doesNotMatch(swSections['18'], /bug\/released-stated/,
    `a Released plan is not scanned:\n${swSections['18']}`);
  assert.doesNotMatch(swSections['18'], /bug\/delivered-stated/,
    `nor is a Delivered one:\n${swSections['18']}`);
});

test('scan: section 18 counts in the footer and gates nothing', () => {
  const footer = swReport.trim().split('\n').at(-1);
  assert.match(footer, /\bstated_waits=2\b/,
    `two stated waits, one counter:\n${footer}`);
  // THE POINT OF THE PLACEMENT. An unannotated wait is a legibility gap, and
  // an advisory finding that can stop a delivery is a gate nobody agreed to.
  assert.match(footer, /\battention=0\b/,
    `section 18 must not reach attention=:\n${footer}`);
});

test('scan: section 18 sits below the blocking marker', () => {
  const marker = swReport.indexOf('== blocking sections end ==');
  const section = swReport.indexOf('== 18. ');
  assert.ok(marker > 0, 'the fixture report carries the marker');
  assert.ok(section > marker,
    'section 18 must sit below the marker, like every other advisory section');
});

// --- Section 20: a merged ref that outlived its PR --------------------------
//
// A SECOND FIXTURE, and it needs a git host. Every assertion above runs against
// a local bare origin, which is deliberately `degraded` — but section 20's whole
// predicate is the host's merged-PR list, so the shared fixture can only prove
// the suppression case. This repo therefore copies the scripts into a shim, puts
// a stubbed `plot-host.sh` beside them, and points `origin` at a github.com URL
// after the push so `--no-fetch` never touches the network.
//
// Measured on the estate this section was written for: nine merged PRs whose
// refs survived, none of them reported by anything.

const shimScripts = (shim) => {
  const realScripts = path.dirname(scan);
  const dest = path.join(shim, 'scripts');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(realScripts)) {
    if (f.endsWith('.sh')) fs.copyFileSync(path.join(realScripts, f), path.join(dest, f));
  }
  const board = path.join(realScripts, 'board');
  if (fs.existsSync(board)) {
    fs.mkdirSync(path.join(dest, 'board'), { recursive: true });
    for (const f of fs.readdirSync(board)) {
      if (!f.endsWith('.mjs')) continue;
      const to = path.join(dest, 'board', f);
      fs.copyFileSync(path.join(board, f), to);
      fs.chmodSync(to, 0o755);
    }
  }
  return dest;
};

let mrTmp, mrRepo, mrReport, mrSections, mrShim;

before(() => {
  mrTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-mergedref-'));
  const origin = path.join(mrTmp, 'origin.git');
  mrRepo = path.join(mrTmp, 'repo');
  git(mrTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(mrTmp, 'clone', '-q', origin, mrRepo);
  git(mrRepo, 'config', 'user.email', 'test@example.invalid');
  git(mrRepo, 'config', 'user.name', 'Plot Test');
  git(mrRepo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(mrRepo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  const status = (phase) => `## Status\n\n- **Phase:** ${phase}\n- **Type:** feature\n\n`;

  w('CLAUDE.md', `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`);

  // A DELIVERED plan claiming a merged branch → the ref sweep is the tool.
  w('plans/2026-01-01-shipped.md', `# Shipped

${status('Delivered')}## Branches

- \`feature/sweepable\` — impl
`);
  // A LIVE plan claiming a merged branch → the delivery comes first.
  w('plans/2026-01-02-live.md', `# Live

${status('Approved')}## Branches

- \`feature/live-claim\` — impl
`);
  // A file with no phase is not a claimant (section 19's rule).
  w('plans/2026-01-03-notaplan.md', '# Worker report\n\nIt mentions `feature/ownerless` in passing.\n');

  git(mrRepo, 'add', '-A');
  git(mrRepo, 'commit', '-q', '-m', 'merged-ref fixture');
  git(mrRepo, 'push', '-q', 'origin', 'main');

  // Four remote branches. Three carry merged PRs in the stub; the fourth does
  // not, and is the control that proves the section reads the host rather than
  // enumerating every ref.
  for (const b of ['feature/sweepable', 'feature/live-claim', 'feature/ownerless', 'feature/unmerged']) {
    git(mrRepo, 'checkout', '-q', '-b', b);
    fs.writeFileSync(path.join(mrRepo, `${b.replace('/', '-')}.txt`), 'work\n');
    git(mrRepo, 'add', '-A');
    git(mrRepo, 'commit', '-q', '-m', `work on ${b}`);
    git(mrRepo, 'push', '-q', '-u', 'origin', b);
    git(mrRepo, 'checkout', '-q', 'main');
  }

  mrShim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-mergedref-shim-'));
  shimScripts(mrShim);
  fs.writeFileSync(path.join(mrShim, 'scripts', 'plot-host.sh'), `#!/usr/bin/env bash
# Stub: three merged PRs, no open ones. \`--state merged\` and \`--state open\`
# are the two calls the scan makes, and they must answer differently.
state=""
for a in "$@"; do [ "$prev" = "--state" ] && state="$a"; prev="$a"; done
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  pr-list)
    if [ "$state" = merged ]; then
      echo '{"number":600,"state":"MERGED","head":"feature/sweepable"}'
      echo '{"number":577,"state":"MERGED","head":"feature/live-claim"}'
      echo '{"number":683,"state":"MERGED","head":"feature/ownerless"}'
    fi ;;
  *) echo "{}" ;;
esac
`);
  fs.chmodSync(path.join(mrShim, 'scripts', 'plot-host.sh'), 0o755);

  // Origin must LOOK like GitHub for the scan to route to the adapter — it reads
  // the remote URL, not the config key, because it joins the PR list against
  // `origin/*` refs. `--no-fetch` is what keeps that URL from being dialled.
  git(mrRepo, 'remote', 'set-url', 'origin', 'https://github.com/plot-pm/fixture.git');

  mrReport = execFileSync('bash', [path.join(mrShim, 'scripts', 'plot-reconcile-scan.sh'), '--no-fetch'],
    { encoding: 'utf8', cwd: mrRepo });
  mrSections = splitSections(mrReport);
});

after(() => {
  if (mrTmp) fs.rmSync(mrTmp, { recursive: true, force: true });
  if (mrShim) fs.rmSync(mrShim, { recursive: true, force: true });
});

test('scan: section 20 names a merged ref no plan claims', () => {
  // The finding's real subject. `plot-release-refs.sh` is plan-scoped, so
  // nothing reaches a merged ref that no plan names — nine accumulated.
  assert.match(mrSections['20'], /feature\/ownerless/,
    `an unclaimed merged ref must be named:\n${mrSections['20']}`);
  assert.match(mrSections['20'], /#683 merged/,
    'and the PR number the host reported is the evidence');
  assert.match(mrSections['20'], /no plan names it/,
    'the ownerless case says so in words');
  assert.match(mrSections['20'], /git push origin --delete feature\/ownerless/,
    'and names the deletion a person may run');
});

test('scan: section 20 routes a delivered plan\'s merged ref to the ref sweep', () => {
  // Already licensed for exactly this ref, and plan-scoped. The finding says so
  // rather than proposing a bare `git push --delete`.
  const line = mrSections['20'].split('\n').filter((l) => l.includes('feature/sweepable') || l.includes('shipped'));
  assert.match(mrSections['20'], /feature\/sweepable/,
    `a delivered plan's merged ref must be named:\n${mrSections['20']}`);
  assert.match(mrSections['20'], /2026-01-01-shipped\.md \(delivered\)/,
    `the claiming plan and its phase are the finding:\n${line.join('\n')}`);
  assert.match(mrSections['20'], /plot-release-refs\.sh shipped --yes/,
    'and the plan-scoped tool is what it names');
});

test('scan: section 20 sends a live plan to its delivery, not to the ref sweep', () => {
  // The ref sweep runs AFTER the delivery. Proposing it on a live plan would
  // propose deleting a ref whose plan has not finished with it.
  assert.match(mrSections['20'], /feature\/live-claim/,
    `a live plan's merged ref is still a finding:\n${mrSections['20']}`);
  assert.match(mrSections['20'], /2026-01-02-live\.md \(approved\)/,
    'and its phase is named');
  assert.match(mrSections['20'], /\/plot-deliver live/,
    'the delivery is the next step');
  assert.doesNotMatch(mrSections['20'], /plot-release-refs\.sh live/,
    `the ref sweep must not be proposed for an undelivered plan:\n${mrSections['20']}`);
});

test('scan: section 20 is silent on a ref with no merged PR', () => {
  // The control. The section reads the HOST's merged list; a ref the host never
  // merged is not a finding, however old the branch is.
  assert.doesNotMatch(mrSections['20'], /feature\/unmerged/,
    `an unmerged ref is not a merged one:\n${mrSections['20']}`);
});

test('scan: section 20 counts in the footer and gates nothing', () => {
  const footer = mrReport.trim().split('\n').at(-1);
  assert.match(footer, /\bmerged_refs=3\b/,
    `three merged refs, one counter:\n${footer}`);
  // A leftover ref is a tidiness gap, not a broken pointer. An advisory finding
  // that can stop a delivery is a gate nobody agreed to.
  assert.match(footer, /\battention=0\b/,
    `section 20 must not reach attention=:\n${footer}`);
});

test('scan: section 20 sits below the blocking marker', () => {
  const marker = mrReport.indexOf('== blocking sections end ==');
  const section = mrReport.indexOf('== 20. ');
  assert.ok(marker > 0, 'the fixture report carries the marker');
  assert.ok(section > marker,
    'section 20 must sit below the marker, like every other advisory section');
});

test('scan: section 20 reports nothing when the host cannot be asked', () => {
  // AN UNREACHABLE HOST REPORTS NOTHING, NOT EVERYTHING. Without the merged-PR
  // list every ref reads as unmerged, so a section that fell back to ancestry
  // would turn an outage into a list of deletion candidates — and squash-merge
  // makes ancestry wrong about a merged branch anyway (ten of ten, 2026-09-04).
  const offline = execFileSync('bash', [path.join(mrShim, 'scripts', 'plot-reconcile-scan.sh'), '--offline'],
    { encoding: 'utf8', cwd: mrRepo });
  const sections = splitSections(offline);
  assert.match(sections['20'], /not evaluated/,
    `an unaskable host must say so:\n${sections['20']}`);
  assert.doesNotMatch(sections['20'], /feature\/ownerless/,
    'and must name no ref at all');
  assert.match(offline.trim().split('\n').at(-1), /\bmerged_refs=0\b/,
    'the count stays 0 rather than counting an unevaluated section');
});

// ---------------------------------------------------------------------------
// Section 20 — a merge that shipped code and added no changeset.
//
// Its own fixture repo, because the question is about MERGE COMMITS and the
// shared fixture has none. Every case below is a merge into main: one finding
// and one control per exclusion, so a naive implementation cannot pass by
// reporting everything or nothing.
let ncTmp, ncRepo, ncReport, ncSections, ncShim;

before(() => {
  ncTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-nochangeset-'));
  const origin = path.join(ncTmp, 'origin.git');
  ncRepo = path.join(ncTmp, 'repo');
  git(ncTmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(ncTmp, 'clone', '-q', origin, ncRepo);
  git(ncRepo, 'config', 'user.email', 'test@example.invalid');
  git(ncRepo, 'config', 'user.name', 'Plot Test');
  git(ncRepo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(ncRepo, rel);
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
  git(ncRepo, 'add', '-A');
  git(ncRepo, 'commit', '-q', '-m', 'no-changeset fixture');
  git(ncRepo, 'push', '-q', 'origin', 'main');

  // Merge `branch` into main as a real merge commit with the host's own
  // subject, so the PR number is lifted the way it is in production.
  const mergeToMain = (branch, pr, files) => {
    git(ncRepo, 'checkout', '-q', '-b', branch, 'main');
    for (const [rel, body] of Object.entries(files)) {
      const p = path.join(ncRepo, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    }
    git(ncRepo, 'add', '-A');
    git(ncRepo, 'commit', '-q', '-m', `work on ${branch}`);
    git(ncRepo, 'checkout', '-q', 'main');
    git(ncRepo, 'merge', '-q', '--no-ff', branch,
      '-m', `Merge pull request #${pr} from plot-pm/${branch}`);
  };

  // THE FINDING. Shipped code under skills/, no changeset.
  mergeToMain('feature/silent-ship', 701, {
    'skills/plot/scripts/quiet.sh': '#!/usr/bin/env bash\necho quiet\n',
  });

  // CONTROL — added a changeset. `--diff-filter=A` is what makes this silent;
  // a grep for the string `.changeset` anywhere in the diff reports it.
  mergeToMain('feature/noted-ship', 702, {
    'skills/plot/scripts/noted.sh': '#!/usr/bin/env bash\necho noted\n',
    '.changeset/brave-pandas-smile.md': "---\n'plot': patch\n---\n\nIt says what changed.\n",
  });

  // CONTROL — exclusion one: no shipped-code path. Docs and tests carry no
  // release note.
  mergeToMain('docs/just-words', 703, {
    'docs/notes.md': 'Some prose.\n',
    'test/reconcile/extra.test.mjs': '// a test\n',
  });

  // CONTROL — exclusion two: a plan PR ships no code by construction.
  mergeToMain('idea/a-plan-only', 704, {
    'skills/plot/scripts/plan-shaped.sh': '#!/usr/bin/env bash\necho plan\n',
  });

  // CONTROL — exclusion three: the release PR CONSUMES changesets; demanding
  // one of it inverts the workflow.
  mergeToMain('changeset-release/main', 705, {
    'skills/plot/scripts/released.sh': '#!/usr/bin/env bash\necho released\n',
  });

  // CONTROL — exclusion four: a rebase-style merge of main INTO a feature
  // branch, which is not a delivery. It sits OFF the first-parent spine, and
  // its first parent is still an ancestor of main once the branch lands —
  // which is why the spine is the reading and ancestry is not.
  //
  // The branch carries its OWN changeset, so its eventual delivery (#706) is
  // legitimately silent and the only thing left to test is the inner merge.
  // Without it the fixture plants two findings and #706 is a CORRECT one — it
  // really did ship code with no note — which measured here as `no_changeset=2`
  // against an asserted 1.
  git(ncRepo, 'checkout', '-q', '-b', 'feature/took-main', 'main~3');
  fs.mkdirSync(path.join(ncRepo, 'skills/plot/scripts'), { recursive: true });
  fs.writeFileSync(path.join(ncRepo, 'skills/plot/scripts/rebased.sh'), '#!/usr/bin/env bash\necho r\n');
  fs.mkdirSync(path.join(ncRepo, '.changeset'), { recursive: true });
  fs.writeFileSync(path.join(ncRepo, '.changeset/tidy-otters-wave.md'),
    "---\n'plot': patch\n---\n\nThe rebased branch says what changed.\n");
  git(ncRepo, 'add', '-A');
  git(ncRepo, 'commit', '-q', '-m', 'work on feature/took-main');
  git(ncRepo, 'merge', '-q', '--no-ff', 'main', '-m', "Merge remote-tracking branch 'origin/main' into feature/took-main");
  git(ncRepo, 'checkout', '-q', 'main');
  git(ncRepo, 'merge', '-q', '--no-ff', 'feature/took-main',
    '-m', 'Merge pull request #706 from plot-pm/feature/took-main');

  git(ncRepo, 'push', '-q', 'origin', 'main');

  ncShim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-nochangeset-shim-'));
  shimScripts(ncShim);

  ncReport = execFileSync('bash', [path.join(ncShim, 'scripts', 'plot-reconcile-scan.sh'), '--offline'],
    { encoding: 'utf8', cwd: ncRepo });
  ncSections = splitSections(ncReport);
});

after(() => {
  if (ncTmp) fs.rmSync(ncTmp, { recursive: true, force: true });
  if (ncShim) fs.rmSync(ncShim, { recursive: true, force: true });
});

test('scan: section 22 names a merge that shipped code with no changeset', () => {
  assert.match(ncSections['22'], /feature\/silent-ship/,
    `the merge that shipped code and no changeset must be named:\n${ncSections['22']}`);
  // The PR number is a nicety lifted from the merge subject, and it is what
  // makes the finding actionable without a host call.
  assert.match(ncSections['22'], /PR #701/,
    `and the PR number the merge subject carries is the evidence:\n${ncSections['22']}`);
  // NAMES THE DECISION, NOT A REPAIR: a change may legitimately owe no note.
  assert.match(ncSections['22'], /decide:/,
    'the finding names the decision a person makes');
});

test('scan: section 22 is silent on a merge that ADDED a changeset', () => {
  // Without `--diff-filter=A` a section that greps for `.changeset` anywhere in
  // the diff passes its happy-path test and reports every release PR forever.
  assert.doesNotMatch(ncSections['22'], /feature\/noted-ship/,
    `a merge carrying a changeset is not a finding:\n${ncSections['22']}`);
});

test('scan: section 22 holds its four exclusions', () => {
  assert.doesNotMatch(ncSections['22'], /docs\/just-words/,
    `a docs/test merge describes nothing a release note would carry:\n${ncSections['22']}`);
  assert.doesNotMatch(ncSections['22'], /idea\/a-plan-only/,
    'a plan PR ships no code and carries no changeset by construction');
  assert.doesNotMatch(ncSections['22'], /changeset-release/,
    'the release PR consumes changesets; demanding one of it inverts the workflow');
  // THE SPINE IS THE READING. `merge-base --is-ancestor "$m^1" origin/main` is
  // TRUE for this merge once the branch lands, so an ancestry test cannot drop
  // it; the first-parent spine can, because a merge of main INTO a branch sits
  // off the sequence of deliveries.
  assert.doesNotMatch(ncSections['22'], /Merge remote-tracking branch/,
    `a rebase-style merge into a feature branch is not a delivery:\n${ncSections['22']}`);
});

test('scan: section 22 counts in the footer, states its window, and gates nothing', () => {
  const footer = ncReport.trim().split('\n').at(-1);
  assert.match(footer, /\bno_changeset=1\b/,
    `one planted finding, one counter — a section with no footer key is invisible\n${footer}`);
  // A missing release note is a decision gap, not a broken pointer. An advisory
  // finding that can stop a delivery is a gate nobody agreed to.
  assert.match(footer, /\battention=0\b/,
    `section 22 must not reach attention=:\n${footer}`);
  // THE SECTION STATES ITS WINDOW. What bounds it is how far back it walks
  // `git log --merges`; saying the number is the difference between a report
  // that is complete and one that looks complete.
  assert.match(ncSections['22'], /window: the last \d+ merge commit\(s\)/,
    `the window is stated rather than implied:\n${ncSections['22']}`);
});

test('scan: section 22 sits below the blocking marker', () => {
  const marker = ncReport.indexOf('== blocking sections end ==');
  const section = ncReport.indexOf('== 22. ');
  assert.ok(marker > 0, 'the fixture report carries the marker');
  assert.ok(section > marker,
    'section 22 must sit below the marker, so /plot-deliver\'s gate does not read it');
});

test('scan: section 22 needs no host call', () => {
  // `--offline` skips both PR lists. Section 18 prints `(not evaluated — …)`
  // under it; this section answers from the merge parents, so copying that
  // guard would make it silent during an outage for no reason.
  assert.doesNotMatch(ncSections['22'], /not evaluated/,
    `the merge parents hold the whole answer — no host is needed:\n${ncSections['22']}`);
  assert.match(ncSections['22'], /feature\/silent-ship/,
    'so the finding still reports with the host unreachable');
});

// ---------------------------------------------------------------------------
// Section 6 honours --offline / --no-pr.
//
// `--offline` and `--no-pr` both set PR_SOURCE=off and the scan's header
// promises "no git-host network call". Section 2 honoured it; section 6 had no
// PR_SOURCE test at all between its loop and its per-plan `pr-state` call.
//
// THE FIXTURE IS SYNTHESIZED, AND THAT IS LOAD-BEARING. Measured on this estate
// 2026-09-17: `delivered=2, reaching_pr_state=0` — both delivered plans here are
// `docs`/`infra`, which the section exempts BEFORE the host call. No real plan
// exercises the loop, so a test pointed at `docs/plans/` would count zero calls
// offline, zero online, and pin nothing. These three carry a `Type:` outside
// `docs|infra` so the online direction makes calls a guard can remove.
//
// THE GATE IS A CALL COUNT, NOT A TIMING. `3 online, 0 offline` is a fact a
// stub measures exactly; "faster" is a claim a loaded machine can fake in
// either direction. The plan is explicit that no speed-up is expected here —
// section 6 costs 0.06 s on this estate.
// ---------------------------------------------------------------------------

let s6Tmp, s6Repo, s6Bin;

// Counts `pr view` calls — the shape `plot-host.sh pr-state` takes on the
// GraphQL route, which is section 6's only host question. `makeGhStub` logs
// every argv, so the merged/open list calls the scan makes elsewhere are
// present in the same log and must not be counted as section 6's.
const prViewCalls = (argv) =>
  argv.split('\n').filter((l) => /\bpr view\b/.test(l));

// A stub of its own rather than `makeGhStub` plus an append. That helper ends
// its script with `exit 0`, so an appended `case` arm is UNREACHABLE — measured
// here: the three `pr view` calls were logged (the log line runs first) and
// answered nothing, so the counting assertions passed while the section
// reported "no merge commit" for all three. A stub that logs before it answers
// hides its own dead arms.
function makeSection6Stub(dir, sha) {
  const argvLog = path.join(dir, 'gh.argv');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(argvLog)}
case "$*" in
  *"pr view "*)
    n=$(printf '%s' "$*" | sed -E 's/.*pr view ([0-9]+).*/\\1/')
    printf '%s' "{\\"number\\":$n,\\"state\\":\\"MERGED\\",\\"isDraft\\":false,\\"url\\":\\"u\\",\\"mergeCommit\\":{\\"oid\\":\\"${sha}\\"}}" ;;
  *"--state merged"*|*"--state open"*) printf '%s' '[]' ;;
esac
exit 0
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return argvLog;
}

function runSection6Scan(extraArgs = []) {
  s6Bin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-s6-gh-'));
  const argvLog = makeSection6Stub(s6Bin, s6Sha);
  const out = execFileSync('bash', [scan, '--no-fetch', ...extraArgs], {
    encoding: 'utf8',
    cwd: s6Repo,
    env: { ...process.env, PATH: `${s6Bin}:${process.env.PATH}` },
  });
  return { out, argv: fs.existsSync(argvLog) ? fs.readFileSync(argvLog, 'utf8') : '' };
}

let s6Sha;

before(() => {
  s6Tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-s6-'));
  const origin = path.join(s6Tmp, 'origin.git');
  s6Repo = path.join(s6Tmp, 'repo');
  git(s6Tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(s6Tmp, 'clone', '-q', origin, s6Repo);
  git(s6Repo, 'config', 'user.email', 'test@example.invalid');
  git(s6Repo, 'config', 'user.name', 'Plot Test');
  git(s6Repo, 'config', 'commit.gpgsign', 'false');
  git(s6Repo, 'remote', 'set-url', 'origin', 'https://github.com/plot-pm/fixture.git');
  git(s6Repo, 'remote', 'add', 'store', origin);

  const w = (rel, content) => {
    const p = path.join(s6Repo, rel);
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

  // Three delivered plans, each a `feature`/`bug` — outside the docs|infra
  // exemption, each carrying a PR number. Online, the section asks the host
  // once per plan: three calls, which is the number the guard must remove.
  for (const [n, slug, type] of [[101, 'one', 'feature'],
                                 [102, 'two', 'bug'],
                                 [103, 'three', 'feature']]) {
    w(`plans/2026-03-0${n - 100}-${slug}.md`, `# ${slug}

## Status

- **State:** Delivered
- **Type:** ${type}
- **Delivered:** 2026-03-01

## Slices

### ${slug} (Branch: feature/${slug}, PR: #${n})

- \`feature/${slug}\` — the slice → #${n}
`);
  }
  // A docs plan alongside them. It is exempt online, so it must not be counted
  // by the offline note either — the guard sits AFTER the exemption, and a note
  // naming four plans would report a gap wider than the flag opened.
  w('plans/2026-03-04-docs.md', `# docs

## Status

- **State:** Delivered
- **Type:** docs
- **Delivered:** 2026-03-01

## Slices

### docs (Branch: docs/four, PR: #104)

- \`docs/four\` — the slice → #104
`);

  fs.mkdirSync(path.join(s6Repo, 'plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(s6Repo, 'plans', 'delivered'), { recursive: true });
  for (const [link, target] of [['one.md', '../2026-03-01-one.md'],
                                ['two.md', '../2026-03-02-two.md'],
                                ['three.md', '../2026-03-03-three.md'],
                                ['docs.md', '../2026-03-04-docs.md']]) {
    fs.symlinkSync(target, path.join(s6Repo, 'plans', 'delivered', link));
  }

  git(s6Repo, 'add', '-A');
  git(s6Repo, 'commit', '-q', '-m', 'plans');
  git(s6Repo, 'push', '-q', 'store', 'main');
  git(s6Repo, 'fetch', '-q', 'store');
  git(s6Repo, 'update-ref', 'refs/remotes/origin/main', 'refs/remotes/store/main');
  git(s6Repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  // The tag is what turns "merged" into "already released" — the section asks
  // `git tag --contains <sha>`, so the stub's mergeCommit must be a real commit
  // in this repo and that commit must carry a release tag.
  s6Sha = git(s6Repo, 'rev-parse', 'HEAD').trim();
  git(s6Repo, 'tag', 'v9.0.0');
});
after(() => {
  fs.rmSync(s6Tmp, { recursive: true, force: true });
  if (s6Bin) fs.rmSync(s6Bin, { recursive: true, force: true });
});

test('scan: section 6 asks the host once per eligible delivered plan when online', () => {
  // THE ONLINE DIRECTION IS PINNED FIRST, because a guard that removes the
  // calls is trivially satisfied by a section that never worked. This is also
  // what proves the offline assertion below measures a removal rather than an
  // absence.
  const { out, argv } = runSection6Scan();
  assert.equal(prViewCalls(argv).length, 3,
    `three eligible delivered plans, three pr-state calls:\n${argv}`);
  // The docs plan is exempt BEFORE the call — four delivered plans, three asks.
  assert.equal(prViewCalls(argv).filter((l) => /104/.test(l)).length, 0,
    'a docs plan must not reach the host');
  const sections = splitSections(out);
  assert.match(sections['6'], /2026-03-01-one\.md — shipped in v9\.0\.0/);
  assert.match(sections['6'], /2026-03-02-two\.md — shipped in v9\.0\.0/);
  assert.match(sections['6'], /2026-03-03-three\.md — shipped in v9\.0\.0/);
  assert.match(out.trim().split('\n').at(-1), /\bunreleased_delivered=3\b/);
});

test('scan: --offline makes zero section-6 host calls', () => {
  // THE GATE. Counted against a stub rather than timed: the plan is explicit
  // that no speed-up is expected on this estate (section 6 costs 0.06 s), so a
  // timing assertion would be measuring noise.
  const { argv } = runSection6Scan(['--offline']);
  assert.equal(prViewCalls(argv).length, 0,
    `--offline promises no git-host network call:\n${argv}`);
});

test('scan: --no-pr makes zero section-6 host calls', () => {
  // The two flags are asserted SEPARATELY. They set the same PR_SOURCE today,
  // and a guard written against one of them by name rather than against the
  // state would pass one of these tests and fail the other.
  const { argv } = runSection6Scan(['--no-pr']);
  assert.equal(prViewCalls(argv).length, 0,
    `--no-pr promises no git-host network call:\n${argv}`);
});

test('scan: the skipped section says what it could not resolve', () => {
  // SILENCE WOULD BE THE WORSE BUG. Offline, section 6 reported `(none)` — the
  // same three words it prints when it checked everything and found nothing.
  // The note is asserted BY TEXT so an empty section cannot pass for a clean
  // one, and it names the NUMBER because "some plans" is not actionable.
  const { out } = runSection6Scan(['--offline']);
  const sections = splitSections(out);
  assert.match(sections['6'], /release state not resolved for 3 delivered plan\(s\)/,
    `an empty section reads as "nothing to report":\n${sections['6']}`);
  assert.match(sections['6'], /pr_source=off/);
  // Three, not four: the docs plan is exempt online too, so counting it would
  // report a gap the flag did not open.
  assert.doesNotMatch(sections['6'], /for 4 delivered/);
});

test('scan: the offline footer count is a measured zero, not an unasked one', () => {
  // `unreleased_delivered=` stays a count of plans this section REPORTED. The
  // note is what separates it from a section that never ran — without it, the
  // same `0` means both "checked, nothing released" and "did not check".
  const { out } = runSection6Scan(['--offline']);
  assert.match(out.trim().split('\n').at(-1), /\bunreleased_delivered=0\b/);
  const sections = splitSections(out);
  assert.doesNotMatch(sections['6'], /shipped in v9\.0\.0/,
    'nothing may be reported from a check that did not run');
});

test('scan: the banner names section 6 among what --offline declines', () => {
  // The absent/failed arms name section 3; section 6 now degrades under `off`
  // and belongs in the same list. A reader who sees `(none)` three hundred
  // lines down should have been told at the top that it was not asked.
  const { out } = runSection6Scan(['--offline']);
  assert.match(out, /Section 6 \(delivered but released\) not evaluated/);
});

test('scan: an online section 6 is unchanged by the guard', () => {
  // PINNED, because a flag fix that quietly narrowed the online answer would
  // trade a timeout for a wrong report. The whole section body is compared,
  // note included — the note must be absent here.
  const { out } = runSection6Scan();
  const sections = splitSections(out);
  assert.doesNotMatch(sections['6'], /not resolved/,
    `the note belongs to the skipped path only:\n${sections['6']}`);
  // The three findings and nothing else. Counted by FINDING LINE rather than by
  // the section's line total, which also carries the blocking marker and its
  // blanks — an assertion on the total pins the report's layout instead of this
  // section's output, and fails when a neighbour moves.
  const findings = sections['6'].split('\n').filter((l) => /still Delivered$/.test(l));
  assert.equal(findings.length, 3,
    `three eligible delivered plans, three findings:\n${sections['6']}`);
});

// --- an unresolvable sha is not an unreleased plan -------------------------
//
// The section's last step is `git tag --contains "$sha"`, and a sha this clone
// does not hold makes git print `error: no such commit`. THE RC IS NOT
// READABLE: the pipeline's exit code is `head`'s — measured 0 — so the failure
// fell through to the `continue` whose own comment says the plan is simply not
// released yet. A "cannot tell" wearing "nothing wrong"'s clothes, in the one
// section written so those two cannot look the same.
//
// Three populations reach it: `--no-fetch` with PRs on, a merge commit outside
// the local refspec or a shallow clone, and a PR merged outside the host's
// merge button. The stub reproduces all three the same way, by naming a sha
// this repository does not have.

test('scan: a merge commit this clone lacks is reported, not skipped', () => {
  const absent = '0'.repeat(39) + '1';
  s6Bin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-s6-gh-'));
  makeSection6Stub(s6Bin, absent);
  const out = execFileSync('bash', [scan, '--no-fetch'], {
    encoding: 'utf8',
    cwd: s6Repo,
    env: { ...process.env, PATH: `${s6Bin}:${process.env.PATH}` },
  });
  const sections = splitSections(out);

  // The finding NAMES THE SHA. "cannot resolve" alone leaves a reader with
  // nothing to check; the hash is what they paste into `git cat-file`.
  assert.match(sections['6'], /2026-03-01-one\.md — delivered, PR #101 names merge commit/,
    `an unresolvable sha must report, not fall through:\n${sections['6']}`);
  assert.match(sections['6'], new RegExp(absent));
  assert.match(sections['6'], /not in this clone → cannot resolve/);

  // All three, and the count agrees. A guard firing on one plan and silently
  // passing the others would satisfy the assertion above.
  assert.match(out.trim().split('\n').at(-1), /\bunreleased_delivered=3\b/);

  // AND IT IS NOT REPORTED AS RELEASED. The repository carries v9.0.0, so a
  // guard that resolved the unknown sha to HEAD would name a version for a
  // commit it never found — the wrong-version failure the grep fallback was
  // refused for.
  assert.doesNotMatch(sections['6'], /shipped in v9\.0\.0/);
});

test('scan: a free section-6 finding survives --offline', () => {
  // THE FLAG GUARDS THE HOST CALL, NOT THE ITERATION. The `no PR annotation`
  // arm answers from the plan file alone and costs no network, so a flag that
  // exists to avoid one has no business suppressing it. An earlier draft
  // skipped at the top of the loop and dropped this finding offline — the same
  // "silence reads as health" defect the note above is here to prevent.
  const w = (rel, content) => {
    const f = path.join(s6Repo, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  w('plans/2026-03-05-bare.md', ['# bare', '', '## Status', '',
    '- **State:** Delivered', '- **Type:** feature', '- **Delivered:** 2026-03-01', '',
    '## Slices', '', '### bare (Branch: feature/bare)', '',
    '- `feature/bare` — no PR annotation', ''].join('\n'));
  try {
    const { out, argv } = runSection6Scan(['--offline']);
    const sections = splitSections(out);
    assert.match(sections['6'], /2026-03-05-bare\.md — delivered, but no PR annotation/,
      `a finding that needs no host must survive the flag:\n${sections['6']}`);
    assert.equal(prViewCalls(argv).length, 0, 'and it still costs no host call');
    // It is a REPORTED finding, so it counts — unlike the three the flag skipped.
    assert.match(out.trim().split('\n').at(-1), /\bunreleased_delivered=1\b/);
    assert.match(sections['6'], /not resolved for 3 delivered plan\(s\)/,
      'and the note still names only the plans the host would have been asked about');
  } finally {
    fs.rmSync(path.join(s6Repo, 'plans', '2026-03-05-bare.md'), { force: true });
  }
});

// --- The `inspect:` line names a CLI the operator has ------------------------
//
// It printed `gh pr view` unconditionally until 2026-09-18. On the repository
// that reported #943 — `Git host: bitbucket` — that is a command the operator
// cannot run, on every one of the 45 findings the section produced there.

/**
 * Runs the section-6 fixture against a Bitbucket origin with a `bb` on PATH.
 *
 * The stub answers `pr view` WITHOUT a `mergeCommit` key, which is the
 * reporting repository's payload: `plot-host.sh`'s Bitbucket arm constructs no
 * such key, so `jq -r '.mergeCommit // empty'` yields empty and every delivered
 * plan takes the `cannot resolve` arm. That is #943 reproduced — the sibling
 * slice fixes the payload; this one only asserts the command it prints.
 */
function runSection6Bitbucket() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-s6-bb-'));
  fs.writeFileSync(path.join(dir, 'bb'), `#!/usr/bin/env bash
case "$*" in
  *"pr view "*)
    n=$(printf '%s' "$*" | sed -E 's/.*pr view ([0-9]+).*/\\1/')
    printf '%s' "{\\"number\\":$n,\\"state\\":\\"MERGED\\",\\"draft\\":false,\\"url\\":\\"u\\"}" ;;
  *) printf '%s' '[]' ;;
esac
exit 0
`);
  fs.chmodSync(path.join(dir, 'bb'), 0o755);
  const saved = execFileSync('git', ['-C', s6Repo, 'remote', 'get-url', 'origin'],
    { encoding: 'utf8' }).trim();
  git(s6Repo, 'remote', 'set-url', 'origin', 'https://bitbucket.org/plot-pm/fixture.git');
  try {
    return execFileSync('bash', [scan, '--no-fetch'], {
      encoding: 'utf8',
      cwd: s6Repo,
      // The adapter's own documented test escape: the capability probe runs
      // `bb pr list --help --json`, which a stub does not implement.
      env: {
        ...process.env,
        PLOT_BB_SKIP_CAP_CHECK: '1',
        PATH: `${dir}:${process.env.PATH}`,
      },
    });
  } finally {
    git(s6Repo, 'remote', 'set-url', 'origin', saved);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('scan: the unresolvable finding names the configured host CLI', () => {
  // On Bitbucket the section reports every delivered plan as `cannot resolve` —
  // the symptom #943 reported, reproduced here. What this slice fixes is the
  // command beside it: `gh` is not installed on that operator's machine.
  const out = runSection6Bitbucket();
  const sections = splitSections(out);
  assert.match(sections['6'], /has no merge commit → cannot resolve/,
    `the Bitbucket payload must reach the unresolvable arm:\n${sections['6']}`);
  assert.match(sections['6'], /inspect: bb pr view \d+ --json/,
    `the inspect line must name bb on a Bitbucket repo:\n${sections['6']}`);
  assert.doesNotMatch(sections['6'], /inspect: gh /,
    'a Bitbucket operator must never be handed a gh command');
});

test('scan: the unresolvable finding still names gh on a GitHub repo', () => {
  // The other arm, asserted separately: a case that fixed one backend by
  // breaking the other would pass the test above on its own.
  const w = (rel, content) => {
    const f = path.join(s6Repo, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  // A plan whose PR the stub answers for, but whose merge commit is not in this
  // repo's history — the GitHub route into the same unresolvable arm.
  // The heading carries `PR: #N` AND the branch line carries `→ #N` — the shape
  // the three fixture plans beside it use. A branch line alone parses as
  // unannotated and lands in the `no PR annotation` arm, which is a different
  // finding with a different `inspect:` line.
  w('plans/2026-03-06-nomerge.md', ['# nomerge', '', '## Status', '',
    '- **State:** Delivered', '- **Type:** feature', '- **Delivered:** 2026-03-01', '',
    '## Slices', '', '### nomerge (Branch: feature/nomerge, PR: #999)', '',
    '- `feature/nomerge` — the slice → #999', ''].join('\n'));
  try {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-scan-s6-gh2-'));
    // `mergeCommit` present for every PR but 999, which answers without it.
    fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
case "$*" in
  *"pr view 999"*)
    printf '%s' '{"number":999,"state":"MERGED","isDraft":false,"url":"u"}' ;;
  *"pr view "*)
    n=$(printf '%s' "$*" | sed -E 's/.*pr view ([0-9]+).*/\\1/')
    printf '%s' "{\\"number\\":$n,\\"state\\":\\"MERGED\\",\\"isDraft\\":false,\\"url\\":\\"u\\",\\"mergeCommit\\":{\\"oid\\":\\"${s6Sha}\\"}}" ;;
  *) printf '%s' '[]' ;;
esac
exit 0
`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const out = execFileSync('bash', [scan, '--no-fetch'], {
      encoding: 'utf8',
      cwd: s6Repo,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    fs.rmSync(bin, { recursive: true, force: true });
    const sections = splitSections(out);
    assert.match(sections['6'], /2026-03-06-nomerge\.md — delivered, but PR #999 has no merge commit/,
      `the GitHub route into the unresolvable arm:\n${sections['6']}`);
    assert.match(sections['6'], /inspect: gh pr view 999 --json state,mergeCommit/,
      `the inspect line must still name gh on a GitHub repo:\n${sections['6']}`);
  } finally {
    fs.rmSync(path.join(s6Repo, 'plans', '2026-03-06-nomerge.md'), { force: true });
  }
});

// --- Section 23: a finished plan whose issue is still open ------------------
//
// THE FIXTURE NEEDS A TRACKER, so it takes section 20's shape: the scripts are
// copied into a shim, a stub `plot-host.sh` answers `issue-list`, and `origin`
// is pointed at a github.com URL after the push so `--no-fetch` never dials.
//
// Measured on the estate this section was written for: 21 plans at Delivered
// or Released name an issue, 12 issues are open, and the intersection is
// exactly one — `a-gate-matches-an-invocation` and #935, found by a person
// reading a sprint sweep rather than by anything in Plot.

/**
 * A repository whose plans name issues, with a stubbed tracker.
 *
 * `hostBody` is the whole `plot-host.sh` stub, so a test can make the tracker
 * answer, fail, or refuse to be asked. `markerPath`, when the stub writes one,
 * is what proves `--no-pr` never asked at all — the absence of a call cannot
 * be asserted from output that is absent for either reason.
 */
const issueFixture = (hostBody, scanArgs = ['--no-fetch']) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-openissue-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  const plan = (phase, issue) =>
    `## Status\n\n- **State:** ${phase}\n- **Type:** feature\n- **Issue:** ${issue}\n\n`;

  w('CLAUDE.md', `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** plans/
- **Active index:** plans/active/
- **Delivered index:** plans/delivered/
`);

  // #101 open → reported. Released is the phase the observed failure had.
  w('plans/2026-01-01-released-open.md', `# Released open\n\n${plan('Released', '#101')}`);
  // #102 open → reported. Delivered must be caught too: a filter on `released`
  // alone is the naive implementation this catches.
  w('plans/2026-01-02-delivered-open.md', `# Delivered open\n\n${plan('Delivered', '#102')}`);
  // #103 absent from the stub's open list → closed → silent.
  w('plans/2026-01-03-released-closed.md', `# Released closed\n\n${plan('Released', '#103')}`);
  // Approved is not finished, and #104 is open. Nine approved plans on the
  // real estate name an issue, so a missing phase filter is loud there.
  w('plans/2026-01-04-approved-open.md', `# Approved open\n\n${plan('Approved', '#104')}`);
  // Two issues, one open: the finding must name #106 alone.
  w('plans/2026-01-05-partly-open.md', `# Partly open\n\n${plan('Released', '#105, #106')}`);

  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'open-issue fixture');
  git(repo, 'push', '-q', 'origin', 'main');

  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-openissue-shim-'));
  shimScripts(shim);
  const host = path.join(shim, 'scripts', 'plot-host.sh');
  fs.writeFileSync(host, hostBody);
  fs.chmodSync(host, 0o755);

  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/plot-pm/fixture.git');

  const report = execFileSync('bash', [path.join(shim, 'scripts', 'plot-reconcile-scan.sh'), ...scanArgs],
    { encoding: 'utf8', cwd: repo });
  return { tmp, repo, shim, report, sections: splitSections(report) };
};

/** A stub answering `issue-list` with the given open issue numbers. */
const issueHost = (numbers, { marker = '', limitEcho = false } = {}) => `#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  issue-list)
    ${marker ? `printf 'called\\n' >> '${marker}'` : ':'}
    ${limitEcho ? 'true' : 'true'}
${numbers.map((n) => `    echo '{"number":${n},"title":"t","url":"u"}'`).join('\n')}
    ;;
  pr-list) ;;
  *) echo "{}" ;;
esac
exit 0
`;

test('section 23 reports a Released and a Delivered plan naming an open issue', () => {
  const f = issueFixture(issueHost([101, 102, 106]));
  try {
    const s = f.sections['23'];
    assert.match(s, /2026-01-01-released-open\.md — released, still open: #101/,
      `a released plan whose issue is open is the observed failure:\n${s}`);
    // DELIVERED TOO. `Delivered` means the code merged; the ticket is just as
    // open. A filter on `released` alone passes every other test in this block.
    assert.match(s, /2026-01-02-delivered-open\.md — delivered, still open: #102/,
      `a delivered plan must be caught as well:\n${s}`);
    assert.match(s, /decide: close the issue by hand, or record why it stays open/,
      `the finding names a decision, never a repair:\n${s}`);
    // PLOT CLOSES NO TICKET. `plot-host.sh` creates none and closes none, so a
    // close command must not appear as a remedy.
    assert.doesNotMatch(s, /issue close/, `no close command may be printed:\n${s}`);
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
    fs.rmSync(f.shim, { recursive: true, force: true });
  }
});

test('section 23 is silent about a plan whose issue is closed', () => {
  const f = issueFixture(issueHost([101, 102, 106]));
  try {
    const s = f.sections['23'];
    // #103 is absent from the stub's open list, which is what "closed" looks
    // like through `issue-list`. Reporting it would mean reporting every plan
    // that names an issue at all.
    assert.doesNotMatch(s, /2026-01-03-released-closed/,
      `a closed issue is not a finding:\n${s}`);
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
    fs.rmSync(f.shim, { recursive: true, force: true });
  }
});

test('section 23 is silent about an Approved plan naming an open issue', () => {
  const f = issueFixture(issueHost([101, 102, 104, 106]));
  try {
    const s = f.sections['23'];
    // #104 IS open, and the plan is not finished — so there is nothing to
    // reconcile. Nine approved plans name an issue on the real estate, so a
    // missing phase filter turns one finding into ten.
    assert.doesNotMatch(s, /2026-01-04-approved-open/,
      `an unfinished plan's open issue is not drift:\n${s}`);
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
    fs.rmSync(f.shim, { recursive: true, force: true });
  }
});

test('section 23 reports only the open issues of a plan naming several', () => {
  const f = issueFixture(issueHost([106]));
  try {
    const s = f.sections['23'];
    const line = s.split('\n').find((l) => l.includes('2026-01-05-partly-open'));
    assert.ok(line, `the plan must be reported for its open issue:\n${s}`);
    // PER ISSUE, NOT PER PLAN. #105 is closed; naming it would send a person
    // to a ticket that needs nothing.
    assert.match(line, /still open: #106$/, `only the open issue may be named:\n${line}`);
    assert.doesNotMatch(line, /#105/, `a closed issue must not be named:\n${line}`);
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
    fs.rmSync(f.shim, { recursive: true, force: true });
  }
});

test('section 23 says not evaluated when the tracker cannot be asked (exit 4)', () => {
  const f = issueFixture(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  issue-list) echo "no tracker configured for this host" >&2; exit 4 ;;
  pr-list) ;;
  *) echo "{}" ;;
esac
exit 0
`);
  try {
    const s = f.sections['23'];
    // AN OUTAGE IS NOT AN ANSWER. `(none)` here would report a clean estate
    // the section never measured — the failure the adapter's three-way exit
    // split exists to prevent.
    assert.match(s, /\(not evaluated — this host cannot be asked for issues/,
      `exit 4 is a configuration, and it must say so:\n${s}`);
    assert.doesNotMatch(s, /\(none/, `an unasked tracker must never print (none):\n${s}`);
    assert.match(f.report, /open_issues=0/, 'an unevaluated section counts zero findings');
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
    fs.rmSync(f.shim, { recursive: true, force: true });
  }
});

test('section 23 says not evaluated when the tracker question fails (exit 3)', () => {
  const f = issueFixture(`#!/usr/bin/env bash
case "$1" in
  backend) echo github ;;
  default-branch) echo main ;;
  issue-list) echo "HTTP 503 upstream unavailable" >&2; exit 3 ;;
  pr-list) ;;
  *) echo "{}" ;;
esac
exit 0
`);
  try {
    const s = f.sections['23'];
    assert.match(s, /\(not evaluated — the tracker question failed/,
      `a failed question is not an empty estate:\n${s}`);
    // THE ERROR TEXT IS THE HOST'S OWN, the rule `PR_ERROR` already follows: a
    // person reads "HTTP 503" and acts; no word this scan invents is worth more.
    assert.match(s, /HTTP 503 upstream unavailable/,
      `the host's own words carry the reason:\n${s}`);
    assert.doesNotMatch(s, /\(none/, `a failed question must never print (none):\n${s}`);
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
    fs.rmSync(f.shim, { recursive: true, force: true });
  }
});

test('section 23 never asks the tracker under --no-pr', () => {
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-oi-marker-')), 'called');
  const f = issueFixture(issueHost([101, 102, 106], { marker }), ['--no-fetch', '--no-pr']);
  try {
    // THE ABSENCE OF A CALL CANNOT BE ASSERTED FROM ABSENT OUTPUT — the section
    // is quiet under `--no-pr` whether it asked or not. The marker file is the
    // only evidence that distinguishes them.
    assert.ok(!fs.existsSync(marker),
      '--no-pr promises no git-host network call, and the tracker is one');
    const s = f.sections['23'];
    assert.match(s, /\(not evaluated — pr_source=off/,
      `the skip is stated, not silent:\n${s}`);
    // NAMES THE NUMBER. "some plans" is a sentence a reader cannot act on;
    // section 6's own offline note sets the pattern.
    // FOUR, not three: the plan whose issue is closed is unchecked too. Offline
    // the section cannot know which of them is closed — that is the point.
    assert.match(s, /note: 4 finished plan\(s\) naming an issue went unchecked/,
      `the note counts what went unchecked:\n${s}`);
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
    fs.rmSync(f.shim, { recursive: true, force: true });
    fs.rmSync(path.dirname(marker), { recursive: true, force: true });
  }
});

test('section 23 warns when the tracker returned a full window', () => {
  // PLOT_ISSUE_LIMIT=2 with two issues returned: the count equals the limit, so
  // a third open issue would be invisible and the section must say so. Absence
  // past the window says nothing about an issue's state.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-oi-limit-'));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'),
    '# F\n\n## Plot Config\n\n- **Plan directory:** plans/\n- **Active index:** plans/active/\n- **Delivered index:** plans/delivered/\n');
  fs.mkdirSync(path.join(repo, 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plans', '2026-01-01-r.md'),
    '# R\n\n## Status\n\n- **State:** Released\n- **Type:** feature\n- **Issue:** #101\n\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'limit fixture');
  git(repo, 'push', '-q', 'origin', 'main');
  const shim = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-oi-limit-shim-'));
  shimScripts(shim);
  fs.writeFileSync(path.join(shim, 'scripts', 'plot-host.sh'), issueHost([101, 999]));
  fs.chmodSync(path.join(shim, 'scripts', 'plot-host.sh'), 0o755);
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/plot-pm/fixture.git');
  try {
    const out = execFileSync('bash', [path.join(shim, 'scripts', 'plot-reconcile-scan.sh'), '--no-fetch'], {
      encoding: 'utf8', cwd: repo, env: { ...process.env, PLOT_ISSUE_LIMIT: '2' },
    });
    const s = splitSections(out)['23'];
    assert.match(s, /window: the 2 open issue\(s\) the tracker returned, limit 2/,
      `the window is stated the way section 22 states its own:\n${s}`);
    assert.match(s, /an open\n\s+issue beyond this window would not be seen/,
      `a full window cannot claim completeness:\n${s}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(shim, { recursive: true, force: true });
  }
});

test('section 23 sits below the marker and stays out of the delivery gate', () => {
  const f = issueFixture(issueHost([101, 102, 106]));
  try {
    // IT REPORTS AND NEVER GATES. A tracker is a copy of Plot's state, so an
    // open ticket must not stop `/plot-deliver` — the rule every advisory
    // section since 7 follows.
    const before = f.report.slice(0, f.report.indexOf(BOUNDARY));
    assert.ok(!before.includes('== 23.'),
      'section 23 must sit BELOW the blocking-sections marker');
    assert.equal(runGate(f.report, '2026-01-01-released-open').trim(), '',
      "the delivery gate must not see this section's findings");
    // The counter exists, is non-zero, and is not `attention=`.
    assert.match(f.report, /open_issues=2/, 'the section carries its own counter');
    assert.match(f.report, /attention=0/, 'an open ticket is not an attention finding');
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
    fs.rmSync(f.shim, { recursive: true, force: true });
  }
});
