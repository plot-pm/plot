import { describe, expect, it } from 'vitest';

import { MAX_RELEASE_CHAIN_DEPTH, releaseChain } from '../src/rules/release-chain.js';

const DEFAULT_BRANCH = 'main';

describe('releaseChain', () => {
  it('resolves through one hop when the first destination merges onto the default branch', () => {
    const result = releaseChain({
      defaultBranch: DEFAULT_BRANCH,
      hops: [{ branch: 'feature/b', found: true, number: '3491', base: 'main', mergeCommit: 'deadbeef' }],
    });
    expect(result).toEqual({ outcome: 'resolved', mergeCommit: 'deadbeef' });
  });

  it('follows a second hop when the first destination merges onto another non-default branch', () => {
    const result = releaseChain({
      defaultBranch: DEFAULT_BRANCH,
      hops: [
        { branch: 'feature/b', found: true, number: '10', base: 'develop', mergeCommit: 'aaa111' },
        { branch: 'develop', found: true, number: '11', base: 'main', mergeCommit: 'bbb222' },
      ],
    });
    expect(result).toEqual({ outcome: 'resolved', mergeCommit: 'bbb222' });
  });

  it('refuses dead-end naming the deleted destination branch when no merged PR carries it onward', () => {
    const result = releaseChain({
      defaultBranch: DEFAULT_BRANCH,
      hops: [{ branch: 'feature/b', found: false }],
    });
    expect(result).toEqual({ outcome: 'refused', reason: 'dead-end', branch: 'feature/b' });
  });

  it('refuses cycle when a branch already walked reappears', () => {
    const result = releaseChain({
      defaultBranch: DEFAULT_BRANCH,
      hops: [
        { branch: 'feature/a', found: true, number: '1', base: 'feature/b', mergeCommit: 'aaa' },
        { branch: 'feature/b', found: true, number: '2', base: 'feature/a', mergeCommit: 'bbb' },
        { branch: 'feature/a', found: true, number: '3', base: 'feature/b', mergeCommit: 'ccc' },
      ],
    });
    expect(result).toEqual({ outcome: 'refused', reason: 'cycle', branch: 'feature/a' });
  });

  it('refuses too-deep once the trace exceeds the depth bound with no resolve and no dead end', () => {
    const hops = Array.from({ length: MAX_RELEASE_CHAIN_DEPTH + 1 }, (_, i) => ({
      branch: `feature/chain-${i}`,
      found: true as const,
      number: String(i),
      base: `feature/chain-${i + 1}`,
      mergeCommit: `sha${i}`,
    }));
    const result = releaseChain({ defaultBranch: DEFAULT_BRANCH, hops });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'too-deep' });
  });

  it('refuses too-deep on an empty trace rather than guessing a verdict', () => {
    const result = releaseChain({ defaultBranch: DEFAULT_BRANCH, hops: [] });
    expect(result).toEqual({ outcome: 'refused', reason: 'too-deep', branch: '' });
  });
});
