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
  plans: [{ file, slices: waves }],
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
    expect(allWavesMerged(m, p, true)).toBe('merged');
  });

  it('is true with a deferred branch among merged ones — the scan exempts it', () => {
    // Measured on the Testing plans: six merged, three deferred, and complete.
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
    expect(allWavesMerged(m, p, true)).toBe('merged');
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
    expect(allWavesMerged(m, p, true)).toBe('not-merged');
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
    expect(allWavesMerged(m, p, true)).toBe('not-merged');
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
    expect(allWavesMerged(m, p, true)).toBe('not-merged');
  });

  it('is UNKNOWN without a pulse — a cold cache is not "all merged" and not "unmerged"', () => {
    // Git has said nothing. "Nothing said" must not render as "all merged" — and
    // since 2026-08-27 it must not render as "not merged" either: a caller owes
    // its reader a different sentence for each, and `unknown` is what lets it
    // write one.
    const m = meta({
      waves: [{ name: 'Reached', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    expect(allWavesMerged(m, null, true)).toBe('unknown');
  });

  it('is not-merged when a COMPLETE pulse does not know this plan', () => {
    // A complete scan that does not name this plan has looked and not found it —
    // a real absence, and the plan stays where it is. Contrast the partial-pulse
    // case below, where the same missing plan means the scan never got there.
    // The completeness flag is the only thing separating the two.
    const m = meta({
      waves: [{ name: 'Reached', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    const p = pulse('2026-01-01-some-other-plan.md', [
      wave('Reached', 'complete', [['feature/z', 'merged']]),
    ]);
    expect(allWavesMerged(m, p, true)).toBe('not-merged');
  });

  it('is UNKNOWN on the MEASURED shape: a plan missing from a timed-out scan', () => {
    // Item 1, reproduced from the payload captured 2026-08-27 the same minute an
    // operator hit the refusal:
    //
    //     complete:      False        <- the scan timed out
    //     plans array:   0
    //     waves array:  52
    //
    // The plan's two PRs (#446, #454) had merged the day before. The old lookup
    // missed an empty `plans` array and returned `false`, and `false` is read as
    // *not merged* — a claim about branches, made from a payload that never
    // reached them.
    //
    // `unknown` is the answer, NOT `merged`: this function reads `pulse.plans`,
    // and on a partial pulse the plan's waves are genuinely not in front of it.
    // Refusing to assert is the fix; asserting the positive would be the inverse
    // error the plan rejects ("treat a missing plan as deliverable").
    const m = meta({
      waves: [{ name: 'Told', branches: [{ branch: 'bug/an-unreachable-host-says-so', deferred: false, claimed: '' }] }],
    });
    const timedOut: FleetPulse = {
      main: 'main',
      head: 'abc1234',
      plans: [],
      summary: { plans: 0, waves: 52, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    };
    expect(allWavesMerged(m, timedOut, false)).toBe('unknown');
    // And emphatically not the word that produced the refusal.
    expect(allWavesMerged(m, timedOut, false)).not.toBe('not-merged');
  });

  it('is UNKNOWN on an incomplete scan even when the plan IS present and merged', () => {
    // The completeness flag is load-bearing on its own. A scan still in flight
    // has not finished deriving anything, so even a plan that looks complete in
    // the partial payload is not yet a measurement. This is what makes `complete`
    // a gate rather than a hint — and it is why no default parameter was added:
    // a defaulted `complete` would silently restore *absent is false* here.
    const m = meta({
      waves: [{ name: 'Reached', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    const p = pulse('2026-08-21-done-means-delivered.md', [
      wave('Reached', 'complete', [['feature/a', 'merged']]),
    ]);
    expect(allWavesMerged(m, p, false)).toBe('unknown');
    // The SAME pulse, once the scan finishes, is a measurement.
    expect(allWavesMerged(m, p, true)).toBe('merged');
  });

  it('STILL REFUSES a genuinely unmerged branch on a complete pulse', () => {
    // Item 4, asserted separately because a fix that always returns `merged`
    // passes item 1 and destroys the gate #350 kept. The scan finished, it saw
    // the plan, and one wave is not complete: that is a real negative and it must
    // survive every change made for the partial-pulse case.
    const m = meta({
      waves: [{ name: 'Reached', branches: [
        { branch: 'feature/a', deferred: false, claimed: '' },
        { branch: 'feature/unfinished', deferred: false, claimed: '' },
      ] }],
    });
    const p = pulse('2026-08-21-done-means-delivered.md', [
      wave('Reached', 'complete', [['feature/a', 'merged']]),
      wave('Pending', 'eligible', [['feature/unfinished', 'open']]),
    ]);
    expect(allWavesMerged(m, p, true)).toBe('not-merged');
    expect(allWavesMerged(m, p, true)).not.toBe('merged');
  });

  it('a DELETED branch does not change the answer — the refuted hypothesis, pinned', () => {
    // Item 5. `bug/an-unreachable-host-says-so` was deleted from origin minutes
    // before the refusal, and the natural suspicion was that the pulse derives
    // `merged` from `origin/<branch>` and could no longer see it. Measured
    // 2026-08-27: the scan still reports `merged` with the ref gone.
    //
    // This function reads the pulse's reported state and never the ref, so a
    // deleted branch is indistinguishable here — which is exactly the property
    // that keeps the hypothesis refuted. A plan naming a branch the pulse calls
    // `merged` is merged, whether or not the ref still exists.
    const m = meta({
      waves: [{ name: 'Told', branches: [{ branch: 'bug/an-unreachable-host-says-so', deferred: false, claimed: '' }] }],
    });
    const p = pulse('2026-08-21-done-means-delivered.md', [
      wave('Told', 'complete', [['bug/an-unreachable-host-says-so', 'merged']]),
    ]);
    expect(allWavesMerged(m, p, true)).toBe('merged');
  });

  it('reads the wave VERDICT, not a second walk of the branch states — one derivation', () => {
    // Item 6. The scan already decided whether a wave is complete; re-deriving it
    // from the branch states under it is the second implementation this repo
    // keeps removing. This pins WHICH source is authoritative by making the two
    // disagree: every branch reads `merged`, but the scan called the wave
    // `eligible`. Reading the verdict yields `not-merged`; re-deriving from the
    // branches would yield `merged`.
    //
    // Such a pulse is not one the scan emits — it is a probe, and it fails the
    // moment anyone reinstates the branch walk.
    const m = meta({
      waves: [{ name: 'Reached', branches: [{ branch: 'feature/a', deferred: false, claimed: '' }] }],
    });
    const p = pulse('2026-08-21-done-means-delivered.md', [
      wave('Reached', 'eligible', [['feature/a', 'merged']]),
    ]);
    expect(allWavesMerged(m, p, true)).toBe('not-merged');
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
    expect(allWavesMerged(m, p, true)).toBe('merged');
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
    expect(allWavesMerged(m, p, true)).toBe('merged');
    // The file still says Approved — the function read it, the pulse said merged,
    // and nobody delivered. That gap is the whole point: a person acts from here.
    expect(m.phase).toBe('approved');
  });
});

describe('the bump reaches the phase after Development, read from the mapping', () => {
  // The wiring in `buildBoard` computes the target as `toBoardPhase('delivered')`
  // rather than a literal, so the rename wave (Named: Testing → Testing) needs no
  // edit here — the mapping stays the one definition of which column `delivered`
  // lands in, and this derivation follows it. Pinning the current value keeps the
  // reference discoverable; the rename wave updates this one line, not the logic.
  it('is the same column a delivered plan lands in', () => {
    const afterDevelopment = toBoardPhase('delivered');
    expect(afterDevelopment).toBe('Testing');
    // ...and it is NOT Development — the bump must actually move the card.
    expect(afterDevelopment).not.toBe('Development');
    expect(afterDevelopment).not.toBe(toBoardPhase('approved'));
  });
});
