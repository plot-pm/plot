import { describe, it, expect } from 'vitest';
import { rowsFromPulse } from '../../src/server/fleet.js';
import type { FleetReading } from '../../src/contract/schema.js';

/**
 * A BRANCH REACHES THE BOARD BY TWO PATHS, and the loose one was told nothing.
 *
 * A branch of a live plan arrives as a slice. A branch whose plan has DELIVERED
 * is no longer carried as one, so it falls to the loose-branch loop — which
 * walks `unmergedBranches`, an ANCESTRY answer, and squash-merge leaves a
 * branch permanently ahead of main. Ancestry therefore calls landed work
 * unmerged forever.
 *
 * Measured 2026-09-04: WAITING ON YOU held 35 rows. Three were work anyone was
 * waiting on. The rest were branches the host had merged (#610, #577, #616) or
 * closed (#363, #369, #56 and eleven more) — each labelled correctly and placed
 * in the section that means a person owes something.
 *
 * These tests drive `rowsFromPulse` directly rather than a browser: the
 * placement is a domain decision the server makes, and the Layering Rule says
 * a view state that needs a browser to assert is one not yet extracted.
 */
const QUIET = 12 * 60;

const pulse = { plans: [], summary: {} } as unknown as FleetReading;

const rowFor = (branch: string, prState: string | null) => {
  const prs = prState === null
    ? new Map()
    : new Map([[branch, { number: 1, head: branch, state: prState, draft: false, checks: 'none' }]]);
  const row = rowsFromPulse(
    pulse, new Map([[branch, 3 * 24 * 60]]), 'plot', QUIET, prs as never, '', null, Date.now(),
    null, null, null, null, null, '', null, new Set([branch]),
  ).find((r) => r.branch === branch);
  if (!row) throw new Error(`no row built for ${branch}`);
  return row;
};

describe('a branch the host finished does not wait on a person', () => {
  it('leaves WAITING ON YOU when the PR merged', () => {
    // #610 merged 2026-09-01 and read `abandoned` for three days, because this
    // path passed no merged fact and `quietKind` defaulted to false.
    expect(rowFor('feature/landed', 'MERGED').group).toBe('quiet');
  });

  it('leaves WAITING ON YOU when the PR closed', () => {
    // A closed PR is a DECISION. `quietNeedsPerson` releases exactly this kind,
    // and the loose path hardcoded `rowQuietKind(null, ...)` so it could never
    // be reached — the row said `closed` and sat in the section that asks.
    expect(rowFor('infra/declined', 'CLOSED').group).toBe('quiet');
  });

  it('still asks a person about a branch with no PR at all', () => {
    // The control. Real abandoned work — commits, no PR ever opened — is what
    // this section is FOR, and neither fix may take it away.
    expect(rowFor('docs/abandoned', null).group).toBe('waiting-on-you');
  });
});
