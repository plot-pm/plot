// Contract test for the bug `plot-reconcile-scan.sh` names a merged branch an
// orphan when Bitbucket's merged-PR page is cut at 50 rows (#2282, measured on
// ewz-kus-portal: PR #3623 merged, ~90 PRs behind the newest page, and section
// 3 printed `ahead of develop, no open PR → orphan` with no truncation note).
//
// WHAT THIS PINS, per the brief's "Done when":
//   1. a 50-row Bitbucket merged page is read as cut, a 49-row page is not —
//      so a hard-coded `-ge 50` in the scan itself would fail the second case;
//   2. the branch past the page is asked about individually (`pr-merged`)
//      before section 3 calls it an orphan, and a `merged` answer reclassifies
//      it and fires the section 20 truncation note;
//   3. a failed or `unknown` per-branch ask leaves the orphan line standing —
//      silence is never read as proof the branch never merged;
//   4. GitHub, which honours --limit, makes NO per-branch call at all.
//
// THE FIRST ASSERTION IS THAT THIS FAILS ON MAIN: a fixture with the orphan
// branch inside the 50 rows would pass before and after this fix and prove
// nothing — every case below puts it OUTSIDE the page.
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
// open PR — the shape section 3 must decide "merged" or "orphan" about. The
// host's merged-PR page never lists it: it merged before the newest page.
let repo;
before(() => {
  const t = tmp('bbcut');
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

  // The branch is REAL work ahead of main — a squash merge rewrites the
  // commits, so this ref stays "ahead" forever even though its PR merged.
  git(repo, 'checkout', '-q', '-b', 'feature/old-merge');
  w('old.txt', 'old work\n');
  git(repo, 'add', 'old.txt');
  git(repo, 'commit', '-qm', 'old work, merged long ago');
  git(repo, 'checkout', '-q', 'main');

  git(repo, 'push', '-q', 'origin', 'main', 'feature/old-merge');

  // Retarget the URL only AFTER pushing — the scan's backend detection reads
  // the remote URL, but the push itself must still land in the local bare repo.
  git(repo, 'remote', 'set-url', 'origin', 'https://bitbucket.org/quatico/fixture.git');
});

// A `bb` stub serving exactly two calls the scan can make: the merged-list
// PAGE (`pullrequests?state=MERGED&pagelen=50`, no `q=`) and the per-branch
// ASK (`pullrequests?q=state="MERGED" AND source.branch.name="..."`). `rows`
// is the merged list's row count — 50 (cut) or 49 (not cut) — none of which
// is `feature/old-merge`. `branchAnswer` controls what the per-branch ask for
// `feature/old-merge` reports: 'merged' | 'none' | 'fail' | 'unknown-page'.
// Bitbucket's real envelope is `{"values": [...], ...}` — every `bb api` call
// site in plot-host.sh pipes its output through `jq -c '.values // []'`, so a
// bare array here would make that filter throw "Cannot index array with
// string" rather than silently read as empty.
const envelope = (rows) => JSON.stringify({ values: rows });

const stubBb = ({ rows, branchAnswer = 'merged' } = {}) => {
  const dir = tmp('bbcut-bb');
  const callsFile = path.join(dir, 'calls.log');
  const page = envelope(
    Array.from({ length: rows }, (_, i) => ({
      state: 'MERGED',
      source: { branch: { name: `feature/pr-${i}` } },
    })),
  );
  // A branch-query page for a branch NOT asked about (every other call this
  // scan makes) answers empty rather than erroring — keeps section 2's own
  // per-branch reads (the PR index miss path) harmless if ever exercised.
  const branchBody = (() => {
    switch (branchAnswer) {
      case 'merged':
        // `pr-merge-dest` reads `id`, `merge_commit.hash` and
        // `destination.branch.name` — not `pr-merged`'s plain `state` check —
        // so the fixture's "merged" row carries all three, as a real Bitbucket
        // merged-PR row does.
        return `echo '${envelope([{
          id: 4242,
          state: 'MERGED',
          source: { branch: { name: 'feature/old-merge' } },
          destination: { branch: { name: 'main' } },
          merge_commit: { hash: 'deadbeef' },
          updated_on: '2026-01-01T00:00:00Z',
        }])}'`;
      case 'none':
        return `echo '${envelope([])}'`;
      case 'fail':
        return `echo 'error: minute rate limit exceeded' >&2; exit 1`;
      case 'unknown-page': {
        // The REAL `q=` filter already pins both `state="MERGED"` and
        // `source.branch.name="feature/old-merge"` server-side, so a page this
        // query returns is BY CONSTRUCTION every row for this one branch — a
        // branch whose PR was repeatedly declined/superseded/merged can still
        // fill 50 rows without the eventual MERGED one surviving the window.
        // Giving every row a non-MERGED state is what makes bb_full_page_lacks's
        // predicate (`any(.[]; .state == "MERGED")`) find nothing on a full page.
        const full = envelope(
          Array.from({ length: 50 }, (_, i) => ({
            state: 'DECLINED',
            source: { branch: { name: 'feature/old-merge' } },
          })),
        );
        return `echo '${full}'`;
      }
      default:
        throw new Error(`unknown branchAnswer ${branchAnswer}`);
    }
  })();
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
  scanTmpdir ??= tmp('bbcut-tmpdir');
  const env = {
    ...process.env,
    TMPDIR: scanTmpdir,
    PLOT_BUDGET_HOME: scanTmpdir,
    PATH: `${stub.dir}:${process.env.PATH}`,
    PLOT_PR_INDEX_HOME: tmp('bbcut-empty-store'),
    ...extraEnv,
  };
  return execFileSync('bash', [scan, '--no-fetch'], { encoding: 'utf8', cwd: repo, env });
};

const section = (report, n) => report.split(`== ${n}. `)[1].split('\n== ')[0];

test('bitbucket: a 50-row merged page reclassifies a branch past it as merged, with the truncation note', () => {
  const stub = stubBb({ rows: 50, branchAnswer: 'merged' });
  const out = runScan(stub);
  const s3 = section(out, '3');
  assert.doesNotMatch(s3, /old-merge.*orphan/s, s3);
  assert.match(s3, /old-merge — merged into main, no open PR/, s3);
  assert.match(section(out, '20'), /merged-PR list hit its limit/, section(out, '20'));
  assert.equal(branchQueryCalls(stub).length, 1, 'asked about the one branch about to be named orphan');
});

test('bitbucket: a 49-row merged page is NOT read as cut, and the branch stays an orphan', () => {
  const stub = stubBb({ rows: 49, branchAnswer: 'merged' });
  const out = runScan(stub);
  const s3 = section(out, '3');
  // 49 < 50 proves completeness — the per-branch ask must not even fire, since
  // the branch's absence from a complete page is itself the answer.
  assert.match(s3, /old-merge — ahead of main, no open PR → orphan/, s3);
  assert.doesNotMatch(section(out, '20'), /merged-PR list hit its limit/, section(out, '20'));
  assert.equal(branchQueryCalls(stub).length, 0, 'a provably complete page needs no per-branch ask');
});

test('bitbucket: this must fail on main — a naive fixture with the branch inside the page proves nothing', () => {
  // Sanity check on the fixture itself: put `feature/old-merge` INSIDE the
  // 50-row page (so even the current, unfixed scan sees it as merged) and
  // confirm the orphan line does not appear either way. This case passes on
  // both main and the fix, which is exactly why the two cases above — where
  // the branch sits OUTSIDE the page — are the ones that matter.
  const dir = tmp('bbcut-bb-inside');
  const callsFile = path.join(dir, 'calls.log');
  const rows = Array.from({ length: 50 }, (_, i) => ({
    state: 'MERGED',
    source: { branch: { name: i === 0 ? 'feature/old-merge' : `feature/pr-${i}` } },
  }));
  fs.writeFileSync(path.join(dir, 'bb'), `#!/usr/bin/env bash
if [[ "$*" == *"--version"* ]]; then echo "bb version 1.9.0"; exit 0; fi
printf '%s\\n' "$*" >> ${JSON.stringify(callsFile)}
if [ "$1" != "api" ]; then echo "stub: only bb api is served" >&2; exit 9; fi
echo '${JSON.stringify(rows)}'
`);
  fs.chmodSync(path.join(dir, 'bb'), 0o755);
  const out = runScan({ dir });
  assert.doesNotMatch(section(out, '3'), /old-merge.*orphan/s, section(out, '3'));
});

test('bitbucket: a failed per-branch ask stays an orphan, with the note — never a silent merged', () => {
  const stub = stubBb({ rows: 50, branchAnswer: 'fail' });
  const out = runScan(stub);
  const s3 = section(out, '3');
  assert.match(s3, /old-merge — ahead of main, no open PR → orphan/, s3);
  assert.match(section(out, '20'), /merged-PR list hit its limit/, section(out, '20'));
});

test('bitbucket: an "unknown" per-branch answer (full page, no match) stays an orphan too', () => {
  const stub = stubBb({ rows: 50, branchAnswer: 'unknown-page' });
  const out = runScan(stub);
  assert.match(section(out, '3'), /old-merge — ahead of main, no open PR → orphan/, section(out, '3'));
});

test('github: a cut-list fixture makes no per-branch call — the scan asks Bitbucket only', () => {
  const dir = tmp('bbcut-gh');
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
    const calls = fs.readFileSync(callsFile, 'utf8').split('\n').filter((l) => l !== '');
    assert.ok(!calls.some((l) => l.includes('--head feature/old-merge')), 'no per-branch pr-merged call on GitHub');
    // GitHub honours --limit, and this page came back AT the limit (500 of
    // 500) — still truncated, by the existing rule, and the branch is outside
    // it, so it stays an orphan.
    assert.match(section(out, '3'), /old-merge — ahead of main, no open PR → orphan/, section(out, '3'));
  } finally {
    git(repo, 'remote', 'set-url', 'origin', 'https://bitbucket.org/quatico/fixture.git');
  }
});
