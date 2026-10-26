import { describe, expect, it } from 'vitest';

import {
  MAX_RELEASE_CHAIN_DEPTH,
  pickReleaseHop,
  releaseChainStep,
  type ReleaseChainCandidate,
  type ReleaseChainHop,
} from '../src/rules/release-chain.js';

const candidate = (over: Partial<ReleaseChainCandidate>): ReleaseChainCandidate => ({
  number: 1,
  base: 'main',
  mergeCommit: 'm1',
  mergedAt: '2026-03-01T00:00:00Z',
  contains: 'unknown',
  ...over,
});

const answered = (...candidates: ReleaseChainCandidate[]): ReleaseChainHop => ({ answered: true, candidates });

const reading = (hops: ReleaseChainHop[], destination = 'feature/b', planCommit = { commit: 'plan', mergedAt: '' }) => ({
  defaultBranch: 'main',
  planCommit,
  destination,
  hops,
});

describe('releaseChainStep', () => {
  it('asks about the destination first, testing candidates against the plan commit', () => {
    expect(releaseChainStep(reading([]))).toEqual({ outcome: 'ask', branch: 'feature/b', previous: 'plan' });
  });

  it('resolves through one hop when the only merged PR of the destination merges onto the default branch', () => {
    const step = releaseChainStep(reading([answered(candidate({ number: 3491, mergeCommit: '651cb9be' }))]));
    expect(step).toEqual({ outcome: 'resolved', mergeCommit: '651cb9be' });
  });

  it('asks the next branch with the picked merge commit as the commit to contain', () => {
    const step = releaseChainStep(reading([answered(candidate({ base: 'develop', mergeCommit: 'aaa' }))]));
    expect(step).toEqual({ outcome: 'ask', branch: 'develop', previous: 'aaa' });
  });

  it('follows a second hop by containment, not by the first merged PR the host lists', () => {
    const step = releaseChainStep(
      reading([
        answered(candidate({ base: 'develop', mergeCommit: 'aaa', mergedAt: '2026-03-01T00:00:00Z' })),
        answered(
          candidate({ number: 10, mergeCommit: 'old', mergedAt: '2026-01-01T00:00:00Z', contains: 'no' }),
          candidate({ number: 12, mergeCommit: 'right', mergedAt: '2026-04-01T00:00:00Z', contains: 'yes' }),
        ),
      ]),
    );
    expect(step).toEqual({ outcome: 'resolved', mergeCommit: 'right' });
  });

  it('refuses ambiguous on the first hop when several merged PRs qualify and nothing orders them', () => {
    const step = releaseChainStep(
      reading(
        [answered(candidate({ number: 1, mergeCommit: 'a' }), candidate({ number: 2, mergeCommit: 'b' }))],
        'develop',
      ),
    );
    expect(step).toEqual({ outcome: 'refused', reason: 'ambiguous', branch: 'develop', candidates: 2 });
  });

  it('refuses dead-end naming the branch when no merged PR carries it onward', () => {
    expect(releaseChainStep(reading([answered()]))).toEqual({
      outcome: 'refused',
      reason: 'dead-end',
      branch: 'feature/b',
      candidates: 0,
    });
  });

  it('refuses host-failed naming the branch the host could not answer for, never dead-end', () => {
    expect(releaseChainStep(reading([{ answered: false }]))).toEqual({
      outcome: 'refused',
      reason: 'host-failed',
      branch: 'feature/b',
      candidates: 0,
    });
  });

  it('refuses cycle when the walk reaches a branch already asked about', () => {
    const step = releaseChainStep(
      reading(
        [
          answered(candidate({ base: 'feature/b', mergeCommit: 'a' })),
          answered(candidate({ base: 'feature/a', mergeCommit: 'b', contains: 'yes' })),
        ],
        'feature/a',
      ),
    );
    expect(step).toMatchObject({ outcome: 'refused', reason: 'cycle', branch: 'feature/a' });
  });

  it('refuses too-deep instead of asking past the depth bound', () => {
    const hops = Array.from({ length: MAX_RELEASE_CHAIN_DEPTH }, (_, i) =>
      answered(candidate({ base: `chain-${i + 1}`, mergeCommit: `sha${i}`, contains: 'yes' })),
    );
    const step = releaseChainStep(reading(hops, 'chain-0'));
    expect(step).toMatchObject({ outcome: 'refused', reason: 'too-deep', branch: `chain-${MAX_RELEASE_CHAIN_DEPTH}` });
  });

  it('#2238: the first hop picks the earlier of two unknown-containment candidates using the plan PR\'s own merge time, instead of refusing ambiguous', () => {
    const early = candidate({ number: 10, mergeCommit: 'early', mergedAt: '2026-01-01T00:00:00Z' });
    const late = candidate({ number: 11, mergeCommit: 'late', mergedAt: '2026-06-01T00:00:00Z' });
    const step = releaseChainStep(
      reading([answered(early, late)], 'feature/b', { commit: 'plan', mergedAt: '2026-03-01T00:00:00Z' }),
    );
    expect(step).toEqual({ outcome: 'resolved', mergeCommit: 'late' });
  });

  it('#2238: still refuses ambiguous on the first hop when the plan PR carries no merge time at all', () => {
    const a = candidate({ number: 10, mergeCommit: 'a', mergedAt: '2026-01-01T00:00:00Z' });
    const b = candidate({ number: 11, mergeCommit: 'b', mergedAt: '2026-06-01T00:00:00Z' });
    const step = releaseChainStep(reading([answered(a, b)], 'feature/b', { commit: 'plan', mergedAt: '' }));
    expect(step).toEqual({ outcome: 'refused', reason: 'ambiguous', branch: 'feature/b', candidates: 2 });
  });
});

describe('pickReleaseHop', () => {
  const previous = { commit: 'prev', mergedAt: '2026-03-01T00:00:00Z' };

  it('picks the earliest candidate that contains the previous commit', () => {
    const picked = pickReleaseHop(
      [
        candidate({ number: 3, mergedAt: '2026-05-01T00:00:00Z', contains: 'yes' }),
        candidate({ number: 2, mergedAt: '2026-04-01T00:00:00Z', contains: 'yes' }),
      ],
      previous,
    );
    expect(picked).toMatchObject({ number: 2 });
  });

  it('never picks a candidate that provably does not contain the previous commit', () => {
    expect(pickReleaseHop([candidate({ contains: 'no' })], { commit: 'prev', mergedAt: '' })).toBe('none');
  });

  it('picks the earliest unknown candidate merged at or after the previous merge, skipping older ones', () => {
    const picked = pickReleaseHop(
      [
        candidate({ number: 1, mergedAt: '2026-01-01T00:00:00Z' }),
        candidate({ number: 5, mergedAt: '2026-06-01T00:00:00Z' }),
        candidate({ number: 4, mergedAt: '2026-04-01T00:00:00.123456+00:00' }),
      ],
      previous,
    );
    expect(picked).toMatchObject({ number: 4 });
  });

  it('answers none where every unknown candidate merged before the previous merge', () => {
    expect(pickReleaseHop([candidate({ mergedAt: '2026-01-01T00:00:00Z' })], previous)).toBe('none');
  });

  it('#2202: orders strictly by the mergedAt it is given — a caller feeding Bitbucket\'s updated_on in place of a real merge time gets whatever order that implies', () => {
    // PR #21 genuinely merged first; a later comment or label bumped its
    // `updated_on` past #20's. pickReleaseHop has no way to tell the two
    // apart — it only ever sees the value the caller hands it as `mergedAt`.
    // This is the documented ceiling (see release-chain.ts's Bitbucket call
    // site and the PR description): Bitbucket's pull-requests endpoint
    // carries no real merge timestamp.
    const genuinelyEarlier = candidate({ number: 21, mergeCommit: 'first', mergedAt: '2026-04-05T00:00:00Z' });
    const genuinelyLater = candidate({ number: 20, mergeCommit: 'second', mergedAt: '2026-04-01T00:00:00Z' });
    const picked = pickReleaseHop([genuinelyEarlier, genuinelyLater], previous);
    expect(picked).toMatchObject({ mergeCommit: 'second' });
  });
});
