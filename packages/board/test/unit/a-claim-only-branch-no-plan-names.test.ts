import { describe, it, expect } from 'vitest';
import { rowsFromPulse } from '../../src/server/fleet.js';
import type { FleetReading } from '../../src/contract/schema.js';
import type { PrRecord } from '../../src/server/fleet.js';

// A branch no plan names reaches the board through the refs, and that loop
// stated `wip` for every branch it built. A claim-only branch such as
// `bug/main-repair-<sha>` therefore read `abandoned`, the word for real commits
// with no PR (#3235). The loop now states `claimed` for a branch in the
// claim-only set, and the rule answers `orphaned-claim`.

const QUIET = 30;
const CLAIM = 'bug/main-repair-fcc797085ba9';
const REAL = 'bug/main-repair-e54e5381561a';

const pulse: FleetReading = {
  main: 'main',
  head: 'abc1234',
  plans: [],
  summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
};

const ages = new Map<string, number | null>([[CLAIM, 600], [REAL, 600]]);
const unmerged = new Set([CLAIM, REAL]);
const claimOnly = new Set([CLAIM]);

const build = (over: { prs?: Map<string, PrRecord> | null; claimOnly?: Set<string> | null } = {}) =>
  rowsFromPulse(
    pulse, ages, 'plot', QUIET, over.prs === undefined ? new Map() : over.prs, '', null, Date.now(),
    null, null, null, null, null, '', null, unmerged, undefined, undefined, undefined, undefined, undefined, undefined,
    over.claimOnly === undefined ? claimOnly : over.claimOnly,
  );

const rowOf = (rows: ReturnType<typeof build>, branch: string) => rows.find((r) => r.branch === branch)!;

describe('a claim-only branch no plan names', () => {
  it('reads orphaned-claim in QUIET, not abandoned', () => {
    const row = rowOf(build(), CLAIM);
    expect(row.plan).toBe('');
    expect(row.state).toBe('claimed');
    expect(row.quietKind).toBe('orphaned-claim');
    expect(row.group).toBe('quiet');
    expect(row.note).toContain('claimed, no work committed');
  });

  it('leaves a branch with real commits abandoned', () => {
    expect(rowOf(build(), REAL).quietKind).toBe('abandoned');
  });

  it('reads abandoned when the claim-only set was not read at all', () => {
    expect(rowOf(build({ claimOnly: null }), CLAIM).quietKind).toBe('abandoned');
  });

  it('never reads abandoned while the PR fetch has not landed', () => {
    // `quietKind`'s arm order is settled: an empty claim outranks an unasked
    // host, as it does for a planned claim. The outage must not state "no PR
    // ever opened" about either branch; `release-claim` re-reads the PR itself
    // and refuses where one is open.
    const rows = build({ prs: null });
    const claim = rowOf(rows, CLAIM);
    expect(claim.quietKind).toBe('orphaned-claim');
    expect(claim.note).not.toContain('no PR ever opened');
    expect(rowOf(rows, REAL).quietKind).toBe('quiet');
  });
});
