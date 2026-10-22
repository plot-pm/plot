// Contract test for the bug section 20 misses what section 3 already proved
// (the plan behind this branch): on a cut Bitbucket merged-PR list, section 3
// asks the host per branch (`pr-merged`/`pr-merge-dest`, formerly line 1307)
// and reclassifies a branch outside the page as merged — but that answer was
// never folded back into `merged_pr_heads`, so section 20, which only reads
// `merged_pr_for_branch` against the bundled 50-row page, still printed
// "(none — no remote ref outlives its merged PR)" on the same run.
//
// WHAT THIS PINS, per the brief's "Done when":
//   1. section 20 lists the ref, with the same PR number section 3's ask
//      bought — not a second host call to re-learn it (`q=` count stays 1);
//   2. both truncation notes (sections 2 and 20) name the actual Bitbucket
//      page size (50), not `MERGED_PR_LIMIT` (500);
//   3. the GitHub arm is unchanged: its note still names `MERGED_PR_LIMIT`,
//      since GitHub's `--limit` is an honoured ceiling, not a fixed page.
//
// THE FIXTURE PUTS THE BRANCH OUTSIDE THE 50-ROW PAGE, as
// `bitbucket-cut-merged-list.test.mjs` does for the sibling bug — a branch
// inside the page would pass before and after this fix and prove nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scan = path.join(here, '..', '..', 'skills', 'plot', 'scripts', 'plot-reconcile-scan.sh');

const ctx = [];
const tmp = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `plot-${tag}-`));
  ctx.push(d);
  return d;
};
after(() => { for (const d of ctx) fs.rmSync(d, { recursive: true, force: true }); });

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

// A repository with one branch, `feature/old-merge`, ahead of main and with no
// open PR — merged long before the newest 50-row Bitbucket page.
let repo;
before(() => {
  const t = tmp('s20read');
  const origin = path.join(t, 'origin.git');
  repo = path.join(t, 'repo');
  git(t, 'init', '--bare', '-q', '-b', 'main', origin);
  git(t, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  const w = (rel, content) => {
    const p = path.join(repo, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  w('CLAUDE.md', ['# Fixture', '', '## Plot Config', '',
    '- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/',
    '- **Plan directory:** plans/', '- **Active index:** plans/active/',
    '- **Delivered index:** plans/delivered/', ''].join('\n'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'config');

  git(repo, 'checkout', '-q', '-b', 'feature/old-merge');
  w('old.txt', 'old work\n');
  git(repo, 'add', 'old.txt');
  git(repo, 'commit', '-qm', 'old work, merged long ago');
  git(repo, 'checkout', '-q', 'main');

  git(repo, 'push', '-q', 'origin', 'main', 'feature/old-merge');
  git(repo, 'remote', 'set-url', 'origin', 'https://bitbucket.org/quatico/fixture.git');
});

const envelope = (rows) => JSON.stringify({ values: rows });

// A `bb` stub serving the merged-list PAGE (`state=MERGED`, no `q=`) and the
// per-branch ASK (`q=...source.branch.name="feature/old-merge"`). The
// per-branch row carries `id`, `merge_commit.hash` and `destination.branch` —
// the fields `pr-merge-dest` reads — rather than `pr-merged`'s plain `state`,
// because section 3's ask now needs the PR NUMBER, not just a merged/unmerged
// word. Bitbucket's real envelope is `{"values": [...]}`.
const stubBb = ({ rows }) => {
  const dir = tmp('s20read-bb');
  const callsFile = path.join(dir, 'calls.log');
  const page = envelope(
    Array.from({ length: rows }, (_, i) => ({
      state: 'MERGED',
      source: { branch: { name: `feature/pr-${i}` } },
    })),
  );
  const branchBody = `echo '${envelope([{
    id: 4242,
    state: 'MERGED',
    source: { branch: { name: 'feature/old-merge' } },
    destination: { branch: { name: 'main' } },
    merge_commit: { hash: 'deadbeef' },
    updated_on: '2026-01-01T00:00:00Z',
  }])}'`;
  fs.writeFileSync(path.join(dir, 'bb'), `#!/usr/bin/env bash
if [[ "$*" == *"--version"* ]]; then echo "bb version 1.9.0"; exit 0; fi
printf '%s\\n' "$*" >> ${JSON.stringify(callsFile)}
if [ "$1" != "api" ]; then echo "stub: only bb api is served" >&2; exit 9; fi
path="$2"
case "$path" in
  *"q="*"source.branch.name"*"old-merge"*)
    ${branchBody}
    ;;
  *"q="*)
    echo '${envelope([])}'
    ;;
  *"state=MERGED"*)
    echo '${page}'
    ;;
  *)
    echo '${envelope([])}'
    ;;
esac
`);
  fs.chmodSync(path.join(dir, 'bb'), 0o755);
  return {
    dir,
    calls: () => (fs.existsSync(callsFile)
      ? fs.readFileSync(callsFile, 'utf8').split('\n').filter((l) => l !== '')
      : []),
  };
};

const branchQueryCalls = (stub) =>
  stub.calls().filter((l) => l.includes('q=') && l.includes('old-merge'));

let scanTmpdir;
const runScan = (stub, extraEnv = {}) => {
  scanTmpdir ??= tmp('s20read-tmpdir');
  const env = {
    ...process.env,
    TMPDIR: scanTmpdir,
    PLOT_BUDGET_HOME: scanTmpdir,
    PATH: `${stub.dir}:${process.env.PATH}`,
    PLOT_PR_INDEX_HOME: tmp('s20read-empty-store'),
    ...extraEnv,
  };
  return execFileSync('bash', [scan, '--no-fetch'], { encoding: 'utf8', cwd: repo, env });
};

const section = (report, n) => report.split(`== ${n}. `)[1].split('\n== ')[0];

test('bitbucket: section 20 lists the ref section 3 already proved merged, at no extra host cost', () => {
  const stub = stubBb({ rows: 50 });
  const out = runScan(stub);
  const s3 = section(out, '3');
  const s20 = section(out, '20');

  // Section 3 reclassified it (the sibling bug's fix, already pinned
  // elsewhere) — asserted here only as the precondition for section 20.
  assert.match(s3, /old-merge — merged into main, no open PR/, s3);

  // THE BUG: section 20 must not read "(none...)" when section 3 just named
  // this exact branch a deletion candidate with the same evidence.
  assert.doesNotMatch(s20, /\(none — no remote ref outlives its merged PR\)/, s20);
  assert.match(s20, /old-merge — PR #4242 merged, ref still here/, s20);

  // ONE host call for the branch, not two: section 20 reuses section 3's
  // answer rather than asking again.
  assert.equal(branchQueryCalls(stub).length, 1, 'section 20 must not re-ask the host for a branch section 3 already asked about');
});

test('bitbucket: both truncation notes name the actual page size, not MERGED_PR_LIMIT', () => {
  const stub = stubBb({ rows: 50 });
  const out = runScan(stub);
  assert.match(section(out, '2'), /merged-PR list hit its limit of 50 —/, section(out, '2'));
  assert.match(section(out, '20'), /merged-PR list hit its limit of 50 —/, section(out, '20'));
  assert.doesNotMatch(section(out, '2'), /limit of 500/, section(out, '2'));
  assert.doesNotMatch(section(out, '20'), /limit of 500/, section(out, '20'));
});

test('github: the truncation note is unchanged — still names MERGED_PR_LIMIT (500), the honoured ceiling', () => {
  const dir = tmp('s20read-gh');
  const callsFile = path.join(dir, 'calls.log');
  const page = JSON.stringify(
    Array.from({ length: 500 }, (_, i) => ({ number: i, title: `pr-${i}`, state: 'MERGED', headRefName: `feature/pr-${i}` })),
  );
  fs.writeFileSync(path.join(dir, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(callsFile)}
case "$*" in
  *"--state merged"*) printf '%s' '${page}' ;;
  *"--state open"*)   printf '%s' '[]' ;;
  *"--state all"*"--head"*) printf '%s' '[]' ;;
  *"issue list"*)     printf '%s' '[]' ;;
esac
exit 0
`);
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  git(repo, 'remote', 'set-url', 'origin', 'https://github.com/plot-pm/fixture.git');
  try {
    const out = runScan({ dir });
    assert.match(section(out, '2'), /merged-PR list hit its limit of 500 —/, section(out, '2'));
    assert.match(section(out, '20'), /merged-PR list hit its limit of 500 —/, section(out, '20'));
  } finally {
    git(repo, 'remote', 'set-url', 'origin', 'https://bitbucket.org/quatico/fixture.git');
  }
});
