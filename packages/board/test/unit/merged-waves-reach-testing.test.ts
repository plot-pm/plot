import { describe, it, expect } from 'vitest';
import { allWavesMerged } from '../../src/server/board.js';
import { toBoardPhase, PlanMetaSchema, type FleetPulse } from '../../src/contract/schema.js';

// A plan whose every non-deferred branch has merged reaches the phase after
// Development on its own — detection the scan already does, now read by the
// board so a column stops lying while nobody remembers to run `/plot-deliver`.
//
// The rule is a MEASUREMENT and only that: it asserts the code landed, which git
// knows. It flips no phase and writes no record — those assertions live in the
// buildBoard block below. Merge state is read from the PULSE, matching
// `plot-fleet-scan.sh`'s own derivation; a deferred branch is exempt from it,
// matching the scan too.

const meta = (over: Record<string, unknown> = {}) =>
  PlanMetaSchema.parse({
    file: '/repo/docs/plans/2026-08-21-done-means-delivered.md',
    format: 'canonical',
    phase: 'approved',
    ...over,
  });

/** One wave, whatever branches it holds — the state tuple is what these tests vary. */
const wave = (
  name: string,
  verdict: 'complete' | 'eligible' | 'blocked',
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred']>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    claimed: '',
    local_dirty: false,
    local_worktree: '',
  })),
});

const pulse = (file: string, waves: ReturnType<typeof wave>[]): FleetPulse => ({
  main: 'main',
  head: 'abc1234',
  plans: [{ file, waves }],
  summary: {
    plans: 1, waves: waves.length, branches: 0, claimed: 0,
    eligible: 0, blocked: 0, deferred: 0,
  },
});

describe('allWavesMerged — every non-deferred branch has landed', () => {
  it('is true when every branch of every wave has merged', () => {
    // The positive case: multi-wave, all merged. This is the plan whose column
    // should move without a person acting.
    const m = meta({
      waves: [
        { name: 'Reached', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] },
        {
          name: 'Verified',
          branches: [
            { branch: 'feature/b', deferred: false, claimed: '' },
            { branch: 'feature/c', deferred: false, claimed: '' },
          ],
        },
      ],
    });
    const p = pulse('2026-08-21-done-means-delivered.md', [
      wave('Reached', 'complete', [['feature/a', 'merged']]),
      wave('Verified', 'complete', [['feature/b', 'merged'], ['feature/c', 'merged']]),
    ]);
    expect(allWavesMerged(m, p)).toBe(true);
  });

  it('is true with a deferred branch among merged ones — the scan exempts it', () => {
    // Measured on the Endgame plans: six merged, three deferred, and complete.
    // A shelved branch is not outstanding work, so it does not hold the plan in
    // Development — matching `plot-fleet-scan.sh`'s own rule.
    const m = meta({
      waves: [{
        name: 'Reached',
        branches: [
          { branch: 'feature/a', deferred: false, claimed: '' },
          { branch: 'feature/shelved', deferred: true, claimed: '' },
        ],
      }],
    });
    const p = pulse('2026-08-21-done-means-delivered.md', [
      wave('Reached', 'complete', [['feature/a', 'merged'], ['feature/shelved', 'deferred']]),
    ]);
    expect(allWavesMerged(m, p)).toBe(true);
  });

  it('is FALSE when one branch is still open — assert the negative directly', () => {
    // The plan insists on this: an implementation that flags everything passes
    // the positive test. One unmerged branch and the work is not done.
    const m = meta({
      waves: [
        { name: 'Reached', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] },
        {
          name: 'Verified',
          branches: [
            { branch: 'feature/b', deferred: false, claimed: '' },
            { branch: 'feature/c', deferred: false, claimed: '' },
          ],
        },
      ],
    });
    const p = pulse('2026-08-21-done-means-delivered.md', [
      wave('Reached', 'complete', [['feature/a', 'merged']]),
      wave('Verified', 'eligible', [['feature/b', 'merged'], ['feature/c', 'open']]),
    ]);
    expect(allWavesMerged(m, p)).toBe(false);
  });

  it('is false for a claimed-but-unmerged branch — a claim is not a landing', () => {
    // A claim is an empty ref a dispatcher pushed; the branch may hold no commits
    // at all. Only `merged` says the code is in main.
    const m = meta({
      waves: [{ name: 'Reached', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    const p = pulse('2026-08-21-done-means-delivered.md', [
      wave('Reached', 'eligible', [['feature/a', 'claimed']]),
    ]);
    expect(allWavesMerged(m, p)).toBe(false);
  });

  it('is false when the plan has only deferred branches — nothing landed to testify to', () => {
    // The empty-reduction trap: "every non-deferred branch merged" is vacuously
    // true when there is no non-deferred branch. Substantively the plan built
    // nothing, and must not be promoted. The `merged > 0` guard is what catches
    // this.
    const m = meta({
      waves: [{
        name: 'Reached',
        branches: [{ branch: 'feature/shelved', deferred: true, claimed: '' }],
      }],
    });
    const p = pulse('2026-08-21-done-means-delivered.md', [
      wave('Reached', 'blocked', [['feature/shelved', 'deferred']]),
    ]);
    expect(allWavesMerged(m, p)).toBe(false);
  });

  it('is false without a pulse — a cold cache is not "all merged"', () => {
    // Git has said nothing. "Nothing said" must not render as "all merged", the
    // same degradation `summariseFromPulse` makes: absent, not asserted.
    const m = meta({
      waves: [{ name: 'Reached', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    expect(allWavesMerged(m, null)).toBe(false);
  });

  it('is false when the pulse does not know this plan', () => {
    // A plan the scan did not cover is one git has said nothing about — the same
    // join-by-basename rule as `summariseFromPulse`, and the same answer when it
    // misses.
    const m = meta({
      waves: [{ name: 'Reached', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    const p = pulse('2026-01-01-some-other-plan.md', [
      wave('Reached', 'complete', [['feature/z', 'merged']]),
    ]);
    expect(allWavesMerged(m, p)).toBe(false);
  });

  it('joins on basename — meta.file is absolute, the pulse names it short', () => {
    // meta.file is an absolute real path; the pulse reports the resolved
    // basename. Joining on anything else silently matches nothing, which looks
    // exactly like the plan not being complete.
    const m = meta({
      file: '/somewhere/else/docs/plans/2026-08-21-done-means-delivered.md',
      waves: [{ name: 'Reached', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    const p = pulse('2026-08-21-done-means-delivered.md', [
      wave('Reached', 'complete', [['feature/a', 'merged']]),
    ]);
    expect(allWavesMerged(m, p)).toBe(true);
  });

  it('does not depend on the plan file recording anything — the pulse is the source', () => {
    // The plan is `approved` in every fixture here, its branches merged only in
    // the pulse. No `Delivered:` record, no phase flip in the file: reaching the
    // later column is a MEASUREMENT the board computes, never a decision it
    // writes. `allWavesMerged` returns a boolean and touches nothing.
    const m = meta({
      phase: 'approved',
      waves: [{ name: 'Reached', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    const p = pulse('2026-08-21-done-means-delivered.md', [
      wave('Reached', 'complete', [['feature/a', 'merged']]),
    ]);
    expect(allWavesMerged(m, p)).toBe(true);
    // The file still says Approved — the function read it, the pulse said merged,
    // and nobody delivered. That gap is the whole point: a person acts from here.
    expect(m.phase).toBe('approved');
  });
});

describe('the bump reaches the phase after Development, read from the mapping', () => {
  // The wiring in `buildBoard` computes the target as `toBoardPhase('delivered')`
  // rather than a literal, so the rename wave (Named: Endgame → Testing) needs no
  // edit here — the mapping stays the one definition of which column `delivered`
  // lands in, and this derivation follows it. Pinning the current value keeps the
  // reference discoverable; the rename wave updates this one line, not the logic.
  it('is the same column a delivered plan lands in', () => {
    const afterDevelopment = toBoardPhase('delivered');
    expect(afterDevelopment).toBe('Endgame');
    // ...and it is NOT Development — the bump must actually move the card.
    expect(afterDevelopment).not.toBe('Development');
    expect(afterDevelopment).not.toBe(toBoardPhase('approved'));
  });
});
