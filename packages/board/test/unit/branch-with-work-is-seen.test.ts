import { describe, it, expect } from 'vitest';
import { rowsFromPulse } from '../../src/server/fleet.js';
import type { FleetReading } from '../../src/contract/schema.js';
import type { PrRecord } from '../../src/server/fleet.js';

// A BRANCH THAT CARRIES COMMITS IS VISIBLE, whether or not anyone opened a pull
// request for it.
//
// The measured gap, 2026-08-24: the plan-less row loop iterates PRS, so a branch
// with commits and no PR was in neither collection — no plan named it, so the
// plan walk missed it; no PR existed, so the PR loop never reached it. 33 remote
// branches, 105 rows, and 8 unmerged branches with NO ROW AT ALL. Four of those
// were named by a plan, which is what reframes the finding: not "plan-less work
// is invisible" but *work with no open PR is invisible, plan or no plan*.
//
// The fixture below holds a branch in EACH of the four states the plan names —
// planned, PR-only, commits-only, merged — because the assertions that matter
// are the ones that separate this implementation from the naive one. Walking
// every branch instead of `--no-merged` satisfies "the commits-only branch
// appears" and is wrong.

const QUIET = 30;

const pulse: FleetReading = {
  main: 'main',
  head: 'abc1234',
  plans: [{
    file: '2026-08-24-example-plan.md',
    phase: 'approved',
    slices: [{
      name: 'Implementation',
      verdict: 'eligible',
      branches: [{ branch: 'feature/planned', state: 'wip', deferred: false, claimed: '' }],
    }],
  }],
  summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
};

const ages = new Map<string, number | null>([
  ['feature/planned', 5],
  ['bug/has-a-pr', 10],
  ['bug/commits-only', 12],
  ['docs/long-abandoned', 60 * 24 * 120],
]);

const pr = (over: Record<string, unknown> = {}): PrRecord => ({
  number: 99, head: 'bug/has-a-pr', state: 'OPEN', draft: false,
  checks: 'green', mergeable: 'mergeable', review: '', url: 'https://host/pr/99', ...over,
}) as never;

// What `git branch -r --no-merged origin/main` answers for the fixture above.
// `feature/merged-already` is deliberately ABSENT: it is merged, so the git
// command that bounds this feature does not report it. A test that put it in the
// set and expected no row would be asserting against a filter this code does not
// have and should not grow — the bound IS the walk.
const unmerged = new Set([
  'feature/planned', 'bug/has-a-pr', 'bug/commits-only', 'docs/long-abandoned',
]);

const prs = new Map<string, PrRecord>([['bug/has-a-pr', pr()]]);

const build = () => rowsFromPulse(
  pulse, ages, 'plot', QUIET, prs, '', null, Date.now(), null, null, null, null, null, '', null,
  unmerged,
);

describe('a branch with work on it is visible', () => {
  it('gives a branch with commits and no PR a row, kind branch and state wip', () => {
    // Done when #2, and the whole point of the change. Before this, the row did
    // not exist in any collection the board walked.
    const row = build().find((r) => r.branch === 'bug/commits-only');
    expect(row).toBeDefined();
    // NOT a new `orphan` kind: `RowKindSchema`'s docstring says adding one makes
    // two tables a compile error until both answer for it, deliberately. A
    // branch with no PR *is* a `branch`.
    expect(row!.kind).toBe('branch');
    // `wip` is the honest git answer — the branch exists and carries work — and
    // it is what the PR loop already uses for its own rows.
    expect(row!.state).toBe('wip');
  });

  it('gives a MERGED branch no row — the assertion a naive implementation fails', () => {
    // Done when #3, and the one that separates this from walking every branch.
    // Walking all of them passes items 1, 2, 4 and 5 while adding a row for
    // every branch that already landed. A merged branch has nothing outstanding.
    expect(build().some((r) => r.branch === 'feature/merged-already')).toBe(false);
  });

  it('gives a branch a plan already names NO SECOND ROW', () => {
    // Done when #4. One branch on the board twice is a defect this sprint has
    // already fixed four times, and `feature/planned` is in BOTH the pulse and
    // the unmerged set — which is the ordinary case, not a contrived one.
    const rows = build().filter((r) => r.branch === 'feature/planned');
    expect(rows).toHaveLength(1);
    // And it is still the PLAN's row: the plan walk built it, so it keeps its
    // plan, which a second row from this loop would not have.
    // The SLUG — the plan file with its date prefix and `.md` stripped, which is
    // the spelling every row writes into `plan`.
    expect(rows[0].plan).toBe('example-plan');
  });

  it('gives a branch with an open PR NO SECOND ROW', () => {
    // Done when #4, the other half. `bug/has-a-pr` is in the unmerged set AND in
    // the PR map, so both loops can reach it; the PR loop owns it.
    const rows = build().filter((r) => r.branch === 'bug/has-a-pr');
    expect(rows).toHaveLength(1);
    expect(rows[0].pr?.number).toBe(99);
  });

  it('agrees with the git walk — every unmerged branch has exactly one row', () => {
    // Done when #1, stated as the invariant rather than as four separate counts:
    // the row set and `git branch -r --no-merged` name the same branches, once
    // each. This is the assertion that fails if a fifth path ever adds a row.
    const rows = build();
    for (const branch of unmerged) {
      expect(rows.filter((r) => r.branch === branch)).toHaveLength(1);
    }
  });

  it('sends nothing from this path to WAITING ON YOU', () => {
    // Done when #5. Nothing is asked of the reader by a branch someone may still
    // be writing, and WAITING ON YOU's whole value is that its rows need an
    // answer — swamping it with ~31 branches destroys that.
    //
    // Structural rather than incidental: no PR is handed to `classify`, and every
    // one of its `waiting-on-you` arms requires a PR record. Asserted on the two
    // rows this loop actually builds, so a change that started passing a PR here
    // fails.
    const rows = build();
    expect(rows.find((r) => r.branch === 'bug/commits-only')!.group).not.toBe('waiting-on-you');
    expect(rows.find((r) => r.branch === 'docs/long-abandoned')!.group).not.toBe('waiting-on-you');
  });

  it('lands a recently-pushed branch in NOT STARTED', () => {
    // The plan's section choice: work that exists and that nobody is waiting on a
    // machine for. Reached through the existing `wip` routing rather than a
    // special case — which is why a worker running on the branch still moves it
    // to WORKING through the path every other row uses.
    expect(build().find((r) => r.branch === 'bug/commits-only')!.group).toBe('not-started');
  });

  it('lets an abandoned branch fall to QUIET, as every stale wip row does', () => {
    // Four months old, so past the quiet window. QUIET means "go check whether
    // this died", which is the correct errand for it — and it is the EXISTING
    // routing, not an exception this loop carves. Two of the six branches the
    // gap was measured on were four weeks and four months old: not in flight,
    // abandoned, and the board is the place that would have said so.
    expect(build().find((r) => r.branch === 'docs/long-abandoned')!.group).toBe('quiet');
  });

  it('claims no plan, no wave and no worker it never looked for', () => {
    // ABSENT IS NOT FALSE. This row is built from a REF: no plan names the
    // branch, no wave holds it, and the worktree scan never visited it. Each
    // field says *not looked at* rather than a value that reads as a measurement
    // this machine never made.
    const row = build().find((r) => r.branch === 'bug/commits-only')!;
    expect(row.plan).toBe('');
    expect(row.planFile).toBe('');
    expect(row.phase).toBeNull();
    expect(row.verdict).toBeNull();
    expect(row.startability).toBeNull();
    expect(row.waitingOn).toBeNull();
    // `elsewhere` SAYS "no worktree here" rather than leaving it inferred.
    // `none` would be the invented observation: looking and finding nothing
    // sends a reader into this checkout, and nothing looked.
    expect(row.worker).toBe('elsewhere');
    expect(row.brief).toBe('unknown');
  });

  it('leaves every existing caller unchanged — no set means no branch rows', () => {
    // The parameter is last and optional, so a caller that says nothing about
    // unmerged branches gets the board that predates the field. Empty must mean
    // NOT LOOKED AT rather than "nothing is unmerged": the only thing that reads
    // the set adds rows from it, so a failed read renders as it always did rather
    // than claiming a fleet with no outstanding work.
    const rows = rowsFromPulse(pulse, ages, 'plot', QUIET, prs);
    expect(rows.some((r) => r.branch === 'bug/commits-only')).toBe(false);
    expect(rows.some((r) => r.branch === 'docs/long-abandoned')).toBe(false);
    // And the rows that did not depend on it are all still there.
    expect(rows.some((r) => r.branch === 'feature/planned')).toBe(true);
    expect(rows.some((r) => r.branch === 'bug/has-a-pr')).toBe(true);
  });
});
