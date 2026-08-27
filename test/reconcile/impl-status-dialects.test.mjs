// Contract test for `plot-impl-status.sh`: it must read BOTH plan dialects.
//
// THE DEFECT THIS FILE PINS. A plan states its branches either as `## Branches`
// list items or as `## Waves` headings of the form
// `### Name (Branch: x, PR: #N)`. This helper read only the first. Measured on
// this estate 2026-08-27: **126 plans use Waves, 27 use Branches** — so the
// MAJORITY dialect resolved to no branch lines and the helper answered
// `{"error": "No branches found in plan", "prs": []}`.
//
// The consequence was not a visible error. `plot-deliver.sh` calls this helper
// and swallows a failure into `{"prs":[]}`, then finds no PR for any branch — so
// every branch of every Waves plan read *not merged*. Four fully-merged plans
// were refused delivery, the message naming branches whose PRs had landed the
// day before. Absent read as false, in a gate.
//
// TWO THINGS THIS HARNESS MUST DO, both learned by getting them wrong first:
//
//   1. CREATE A REAL ORIGIN. The helper reads the plan from `origin/<default>`
//      on purpose — on an impl branch the local copy lacks the `→ #N`
//      annotations — so a fixture with no remote makes it exit before parsing
//      and every test fails for a reason unrelated to the dialect.
//
//   2. STUB `gh`. A branch appears in the output only once a PR resolves to a
//      non-NONE state; with no host reachable the helper reports `{"prs":[]}`
//      for a correct parse AND a broken one. A test asserting "no error" would
//      have passed throughout — the pre-fix helper exited 0 and emitted valid
//      JSON, an empty one. The stub is what makes these tests discriminating.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const implStatus = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-impl-status.sh');

const ctx = [];
after(() => { for (const t of ctx) fs.rmSync(t, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

// A `gh` that answers the two calls this helper makes:
//   pr view <n> --json …   → a MERGED PR carrying that number
//   pr list --state merged → the merged heads, for un-annotated branches
// Everything else exits 0 with `{}` so an unexpected call cannot hang a test.
function stubGh(mergedHeads = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ghstub-'));
  ctx.push(dir);
  const rows = JSON.stringify(mergedHeads.map((h, i) => ({
    number: 900 + i, headRefName: h, state: 'MERGED', title: h,
  })));
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
# The number is echoed back from the argv so a test can assert WHICH pr resolved.
if [[ "$*" == *"pr view"* ]]; then
  n=""
  for a in "$@"; do case "$a" in [0-9]*) n="$a"; break ;; esac; done
  printf '{"number":%s,"state":"MERGED","isDraft":false,"url":"https://example.test/pr/%s","mergeCommit":{"oid":"abc"}}' "\${n:-0}" "\${n:-0}"
  exit 0
fi
if [[ "$*" == *"pr list"* ]]; then printf '%s' '${rows.replace(/'/g, `'\\''`)}'; exit 0; fi
printf '%s' '{}'
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return dir;
}

// A repo holding one plan whose branches section is supplied verbatim, so each
// test states the dialect it is about rather than sharing a fixture that drifts.
function repoWithPlan(sectionBody) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-implst-'));
  ctx.push(tmp);
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    '# Repo\n\n## Plot Config\n\n- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/\n- **Plan directory:** docs/plans/\n',
  );
  fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'docs', 'plans', '2026-08-27-a-plan.md'),
    ['# A plan', '', '## Status', '', '- **Phase:** Approved', '- **Type:** bug', '',
     sectionBody, '', '## Done when', '', '- it works', ''].join('\n'),
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return repo;
}

function statusOf(repo, { mergedHeads = [] } = {}) {
  const stub = stubGh(mergedHeads);
  const out = execFileSync('bash', [implStatus, 'a-plan'], {
    encoding: 'utf8', cwd: repo,
    env: { ...process.env, PATH: `${stub}:${process.env.PATH}`, PLOT_HOST: 'github' },
  });
  return JSON.parse(out);
}

const branchesOf = (j) => (j.prs || []).map((p) => p.branch).sort();
const prsOf = (j) => (j.prs || []).map((p) => p.number).sort((a, b) => a - b);

// THE MAJORITY DIALECT, and the one that was invisible.
test('a Waves plan reports the branches named in its headings', () => {
  const repo = repoWithPlan([
    '## Waves', '',
    '### Keyed (Branch: feature/a-plan-cites-a-jira-key, PR: #447)', '',
    'The first wave.', '',
    '### Listed (Branch: feature/jira-issues-reach-the-inbox, PR: #453)', '',
    'The second wave.',
  ].join('\n'));
  const j = statusOf(repo);
  assert.equal(j.error, undefined, 'a Waves plan must not report "No branches found"');
  assert.deepEqual(branchesOf(j), [
    'feature/a-plan-cites-a-jira-key',
    'feature/jira-issues-reach-the-inbox',
  ]);
  // The `PR: #N` INSIDE the heading is the Waves annotation form. Reading the
  // branch but not its PR number would still leave the delivery gate blind.
  assert.deepEqual(prsOf(j), [447, 453]);
});

// The regression the fix invites: reading Waves must not stop reading Branches.
test('a Branches plan still reports its list-item branches', () => {
  const repo = repoWithPlan([
    '## Branches', '',
    '- `feature/the-host-says-which-budget-it-spent` — the adapter reports the budget → #485',
    '- `feature/the-fallback-asks-the-other-budget` — the fallback → #486',
  ].join('\n'));
  const j = statusOf(repo);
  assert.deepEqual(branchesOf(j), [
    'feature/the-fallback-asks-the-other-budget',
    'feature/the-host-says-which-budget-it-spent',
  ]);
  assert.deepEqual(prsOf(j), [485, 486], 'the trailing `→ #N` form still resolves');
});

// A plan mid-reslice carries both sections. The two sets are UNIONED rather than
// chosen between, so no branch is dropped for sitting under the other heading.
test('a plan carrying both sections reports every branch it names', () => {
  const repo = repoWithPlan([
    '## Branches', '',
    '- `feature/from-the-list` — a list item → #1', '',
    '## Waves', '',
    '### Named (Branch: feature/from-the-heading, PR: #2)', '',
    'A wave.',
  ].join('\n'));
  const j = statusOf(repo);
  assert.deepEqual(branchesOf(j), ['feature/from-the-heading', 'feature/from-the-list']);
});

// A branch named in PROSE is not a claim — the same distinction the plan parser
// draws. Without this, a Waves plan that MENTIONS another plan's branch would
// report it, and `plot-deliver.sh` would refuse delivery over a branch the plan
// does not own.
test('a branch mentioned in prose is not reported as a branch of the plan', () => {
  const repo = repoWithPlan([
    '## Waves', '',
    '### Only (Branch: feature/the-real-one, PR: #2)', '',
    'This waits on `feature/somebody-elses-branch` to land first.',
  ].join('\n'));
  const j = statusOf(repo);
  assert.deepEqual(branchesOf(j), ['feature/the-real-one']);
});

// An UN-ANNOTATED Waves heading — the ordinary case, since a worker is asked to
// annotate and measured 2026-08-23 mostly did not. It resolves by matching the
// branch name against merged PR heads, the same fallback the Branches dialect
// has always had.
test('an un-annotated Waves branch resolves by matching merged PR heads', () => {
  const repo = repoWithPlan([
    '## Waves', '',
    '### Unannotated (Branch: feature/no-pr-number-here)', '',
    'A wave whose worker never wrote the annotation.',
  ].join('\n'));
  const j = statusOf(repo, { mergedHeads: ['feature/no-pr-number-here'] });
  assert.deepEqual(branchesOf(j), ['feature/no-pr-number-here']);
});

// A plan with NO branches section is a real shape (a knowledge-only plan). It
// must answer, and answer emptily — not crash, and not invent.
test('a plan naming no branches reports none rather than failing', () => {
  const repo = repoWithPlan('## Design\n\nNo branches here.');
  const j = statusOf(repo);
  assert.deepEqual(j.prs || [], [], 'no branches means an empty list, not a fabricated one');
});

// THE SECOND BUG THIS BRANCH FIXES. `git symbolic-ref refs/remotes/origin/HEAD`
// fails in a fresh clone — it is set only when the remote advertises it — and
// under `set -euo pipefail` that killed the script at that line, BEFORE the
// `|| DEFAULT_BRANCH=main` fallback below could run. Exit 128, no output. Every
// fixture above is a fresh clone, so all of them exercise it; this asserts it
// directly so the cause is named if it ever returns.
test('a clone with no origin/HEAD still resolves the default branch', () => {
  const repo = repoWithPlan([
    '## Waves', '', '### Only (Branch: feature/x, PR: #7)', '', 'A wave.',
  ].join('\n'));
  assert.throws(
    () => execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: repo, stdio: 'pipe' }),
    'the fixture must genuinely lack origin/HEAD, or this asserts nothing',
  );
  const j = statusOf(repo);
  assert.deepEqual(branchesOf(j), ['feature/x'], 'the fallback to `main` must be reachable');
});
