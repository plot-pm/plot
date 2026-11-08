import { describe, expect, it } from 'vitest';

import { answered, failed, type PortResult } from '../src/port-result.js';
import type { BranchTip, CommitSubject, Refs } from '../src/ports/refs.js';
import { readReleaseVersions, readUnmerged } from '../src/workflows/board-reads.js';

const commit = (subject: string, empty: boolean): CommitSubject => ({
  at: 0,
  subject,
  tree: 't',
  parentTree: empty ? 't' : 'p',
});

const refsOf = (over: {
  tips?: PortResult<readonly BranchTip[]>;
  files?: Record<string, string>;
  ranges?: Record<string, PortResult<readonly CommitSubject[]>>;
}): Refs =>
  ({
    branchTips: async () => over.tips ?? answered([]),
    showFile: async (ref: string) => (over.files?.[ref] === undefined ? failed() : answered(over.files[ref]!)),
    commitSubjects: async (range: string) => over.ranges?.[range] ?? failed(),
  }) as unknown as Refs;

describe('readReleaseVersions', () => {
  it('reads the version each release branch names and skips what it cannot read', async () => {
    const refs = refsOf({
      tips: answered([
        { branch: 'changeset-release/main', sha: 'a' },
        { branch: 'changeset-release/none', sha: 'b' },
        { branch: 'changeset-release/bad', sha: 'c' },
        { branch: 'changeset-release/empty', sha: 'd' },
      ]),
      files: { a: '{"version":"2.0.0"}', c: 'not json', d: '{"version":""}' },
    });
    expect(await readReleaseVersions(refs)).toEqual(answered({ 'changeset-release/main': '2.0.0' }));
  });

  it('fails where the release branches cannot be listed', async () => {
    expect((await readReleaseVersions(refsOf({ tips: failed() }))).ok).toBe(false);
  });
});

describe('readUnmerged', () => {
  it('names each branch with commits main lacks, and those carrying only claim markers', async () => {
    const refs = refsOf({
      tips: answered([
        { branch: 'main', sha: 'm' },
        { branch: 'origin', sha: 'm' },
        { branch: 'HEAD', sha: 'm' },
        { branch: 'feature/work', sha: 'w' },
        { branch: 'feature/claim', sha: 'c' },
        { branch: 'feature/merged', sha: 'x' },
        { branch: 'feature/unreadable', sha: 'u' },
      ]),
      ranges: {
        'origin/main..origin/feature/work': answered([commit('add a thing', false)]),
        'origin/main..origin/feature/claim': answered([commit('plot: claim feature/claim', true)]),
        'origin/main..origin/feature/merged': answered([]),
      },
    });
    expect(await readUnmerged(refs, 'main')).toEqual(
      answered({ branches: ['feature/work', 'feature/claim'], claimOnly: ['feature/claim'] }),
    );
  });

  it('fails where the remote branches cannot be listed', async () => {
    expect((await readUnmerged(refsOf({ tips: failed() }), 'main')).ok).toBe(false);
  });
});
