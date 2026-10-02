// Contract test for the PR listing the fleet scan carries instead of spending.
//
// THE DEFECT, measured 2026-10-02 on the Bitbucket workspace `quatico` (#1069).
// Two checkouts of one repository, one hour: the board fleet scan spent 2949 of
// the account's 3150 calls — 93.6% of all calls and 97.1% of network calls —
// while the board's PR refresh, which already follows the cadence rule, spent
// 17. The scan runs on the 5 s pulse and asks no cadence rule, and its open
// listing sweeps one REST request per tracked branch per state, so 1764 of those
// calls were the per-branch sweep alone. The listing endpoint answered 429 for
// about 100 minutes on 2026-10-01.
//
// The board decides whether a listing may be spent (`listingSpend`, asserted as
// arithmetic in `packages/domain/test/listing-spend.test.ts`) and hands the
// previous listing back through `PLOT_PR_LISTING`. THIS FILE PINS THE SHELL HALF
// — that a carried listing costs no host call and changes no answer.
//
// Each case is here because a naive implementation passes without it:
//
//   a carried listing   — the whole point: the same branch states, and ZERO
//   costs no call         `pr-list` calls. This is the request count the plan
//                         asks to see fall.
//   the states are      — a listing that is cheap and wrong is worse than the
//   unchanged             cost it removed. The states must match the fetched run
//                         byte for byte.
//   an empty value      — absent is not empty. A carried listing with no
//   spends as before      `.list-arrived` must fall through to the host, or a
//                         missing listing licenses `NONE` for every branch — the
//                         2026-08-27 failure that refused four merged plans.
//   a listing with no   — the same refusal from the other direction: rows but no
//   arrival marker        marker is not a licence.
//   the scan reports    — the board cannot carry what the scan does not report,
//   what it fetched       and the report must survive a round trip unchanged.
//   a failed listing    — a throttled host writes no marker, so it reports
//   reports nothing       nothing and the board keeps the listing it had.
//   `host=ok`, not a    — `reachFrom` maps an unknown verdict word to `failed`,
//   new word              which answers `unknown` for every branch and stops
//                         `--next` handing out work. A carried listing arrived
//                         and was whole, so `ok` is the true answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// EVERY TEMP PATH REMOVED BY THE EXACT NAME `mkdtempSync` RETURNED, never a
// glob over the shared temp directory.
function trackTemp(dir) {
  (trackTemp.paths ??= []).push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of trackTemp.paths ?? []) fs.rmSync(dir, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const realScripts = path.join(here, '..', '..', 'skills', 'plot', 'scripts');

const git = (cwd, ...args) => execFileSync('git', args, { encoding: 'utf8', cwd });

/**
 * A sandbox repo with a COPIED scripts directory, so the `plot-host.sh` the scan
 * resolves from its own `BASH_SOURCE` is the stub.
 *
 * THE COPY IS WHAT MAKES THE COUNT REAL. The scan resolves its helpers from its
 * own directory and not from `PATH`, so a stub reached through `PATH` alone would
 * never be asked the question being counted — see `fleetsubject.test.mjs`, which
 * says so and counts something else because of it.
 */
function makeRepo({ branches = ['feature/one', 'feature/two'] } = {}) {
  const tmp = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-fleet-listing-')));
  const origin = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  git(tmp, 'init', '--bare', '-q', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, 'repo');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'Plot Test');
  git(repo, 'config', 'commit.gpgsign', 'false');

  // The scripts the scan will actually run, with the host replaced by a stub.
  const scripts = path.join(tmp, 'scripts');
  fs.cpSync(realScripts, scripts, { recursive: true });
  const log = path.join(tmp, 'host.log');
  // A STUB HOST THAT ANSWERS ONE OPEN PR AND LOGS EVERY CALL. `pr-list` emits the
  // compact one-object-per-line shape the scan parses, with the field adjacency
  // its `sed` anchors on.
  fs.writeFileSync(path.join(scripts, 'plot-host.sh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
case "$1" in
  backend) echo github; exit 0 ;;
  default-branch) echo main; exit 0 ;;
  spend-rate) echo '{"perHour":null,"resetAt":null,"limit":null,"basis":"unknown","account":"acme"}'; exit 0 ;;
  pr-list)
    echo '{"number":1,"state":"OPEN","head":"feature/one","draft":false,"checks":"green"}'
    exit 0 ;;
esac
exit 4
`, { mode: 0o755 });

  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# Fixture project

## Plot Config

- **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
- **Plan directory:** docs/plans/
- **Active index:** docs/plans/active/
- **Delivered index:** docs/plans/delivered/
- **Git host:** github
`);

  fs.mkdirSync(path.join(repo, 'docs', 'plans', 'active'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'plans', 'active', '.gitkeep'), '');
  fs.writeFileSync(path.join(repo, 'docs', 'plans', '2026-10-02-a-plan.md'), `# A plan

## Status

- **State:** Approved
- **Type:** feature

## Branches

### The wave

${branches.map((b) => `- \`${b}\` — do the thing`).join('\n')}
`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'fixture');
  git(repo, 'push', '-q', '-u', 'origin', 'main');

  // A remote ref per named branch, so the scan has branches to track.
  for (const b of branches) {
    git(repo, 'checkout', '-q', '-b', b);
    fs.writeFileSync(path.join(repo, `${b.replace(/\//g, '-')}.txt`), 'work\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', `work on ${b}`);
    git(repo, 'push', '-q', '-u', 'origin', b);
    git(repo, 'checkout', '-q', 'main');
  }
  return { tmp, repo, scripts, log };
}

/** Run the scan, returning stdout, the tagged stderr notes, and the host calls. */
function runScan({ repo, scripts, log }, env = {}) {
  fs.rmSync(log, { force: true });
  const scan = path.join(scripts, 'plot-fleet-scan.sh');
  let stdout = '';
  let stderr = '';
  try {
    const proc = execFileSync('bash', [scan], {
      encoding: 'utf8',
      cwd: repo,
      env: { ...process.env, PLOT_HOST: 'github', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    stdout = proc;
  } catch (e) {
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
  }
  // execFileSync only gives stderr on failure, so re-run capturing both when the
  // first call succeeded. One extra run is acceptable in a fixture and keeps the
  // assertion about the SECOND run's host calls honest.
  if (stderr === '') {
    fs.rmSync(log, { force: true });
    const res = execFileSync('bash', ['-c',
      `${JSON.stringify(scan)} 2>${JSON.stringify(path.join(repo, '.stderr'))}`], {
      encoding: 'utf8', cwd: repo,
      env: { ...process.env, PLOT_HOST: 'github', ...env },
    });
    stdout = res;
    stderr = fs.readFileSync(path.join(repo, '.stderr'), 'utf8');
  }
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  const listing = stderr.split('\n')
    .filter((l) => l.startsWith('listing:'))
    .map((l) => l.slice('listing:'.length).trim())
    .join('\n');
  return { stdout, stderr, calls, listing };
}

const prListCalls = (calls) => calls.filter((c) => c.startsWith('pr-list')).length;

test('a fetched listing reports itself for the next pulse to carry', () => {
  const fx = makeRepo();
  const { listing, calls } = runScan(fx);

  assert.ok(prListCalls(calls) > 0, 'a scan with no carried listing asks the host');
  assert.match(listing, /^\.list-arrived\t1\t-\t-$/m, 'the arrival marker travels');
  assert.match(listing, /^\.branches\t\d+\t-\t-$/m, 'the swept branch count travels');
  // The branch the stub answered for, in the cache's own key encoding
  // (`/` becomes `_`, `_` becomes `__`) and its STATE<TAB>checks<TAB>draft shape.
  assert.match(listing, /^feature_one\tOPEN\tgreen\tfalse$/m, 'the branch state travels');
});

test('a carried listing costs no host listing and keeps every state', () => {
  const fx = makeRepo();
  const fetched = runScan(fx);
  assert.ok(prListCalls(fetched.calls) > 0, 'the first run fetches');

  const carried = runScan(fx, { PLOT_PR_LISTING: fetched.listing });

  // THE REQUEST COUNT THE PLAN ASKS TO SEE FALL.
  assert.equal(prListCalls(carried.calls), 0, 'a carried listing asks the host for no listing');
  // AND THE ANSWERS ARE UNCHANGED. A cheap listing that is wrong is worse than
  // the cost it removed, so the branch states are compared rather than assumed.
  const states = (out) => out.split('\n').filter((l) => /feature\/(one|two)/.test(l)).join('\n');
  assert.equal(states(carried.stdout), states(fetched.stdout), 'the branch states are unchanged');
});

test('a carried listing reports host=ok rather than a word that stops the fleet', () => {
  const fx = makeRepo();
  const fetched = runScan(fx);
  const carried = runScan(fx, { PLOT_PR_LISTING: fetched.listing });

  // `reachFrom` (`entry/branch-state.ts`) maps a word it does not know to
  // `failed`, which answers `unknown` for every branch and stops `--next`
  // handing out work. A carried listing arrived and was whole, so `ok` is true.
  assert.match(carried.stdout, /host=ok/, 'a carried listing reads as an answered host');
});

test('an empty carried listing spends the listing as before', () => {
  const fx = makeRepo();
  const { calls } = runScan(fx, { PLOT_PR_LISTING: '' });

  assert.ok(prListCalls(calls) > 0, 'an empty value is not a listing and the host is asked');
});

test('a carried listing with no arrival marker is refused', () => {
  const fx = makeRepo();
  const fetched = runScan(fx);
  // Rows, but no `.list-arrived`. ABSENT IS NOT EMPTY: without the marker the
  // scan cannot tell a real listing from one truncated in transit, and deriving
  // `NONE` from the second would report a real PR as having none.
  const markerless = fetched.listing.split('\n')
    .filter((l) => !l.startsWith('.list-arrived'))
    .join('\n');

  const { calls } = runScan(fx, { PLOT_PR_LISTING: markerless });

  assert.ok(prListCalls(calls) > 0, 'a listing without its arrival marker is not carried');
});

test('a throttled listing reports nothing, so the board keeps the one it had', () => {
  const fx = makeRepo();
  // A host that refuses the listing writes no `.list-arrived`, so there is
  // nothing to report — and carrying its empty cache forward would turn one
  // refusal into a listing the next pulse trusts.
  fs.writeFileSync(path.join(fx.scripts, 'plot-host.sh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(fx.log)}
case "$1" in
  backend) echo github; exit 0 ;;
  default-branch) echo main; exit 0 ;;
esac
echo "API rate limit exceeded" >&2
exit 7
`, { mode: 0o755 });

  const { listing } = runScan(fx);

  assert.equal(listing, '', 'a refused listing reports no listing at all');
});
