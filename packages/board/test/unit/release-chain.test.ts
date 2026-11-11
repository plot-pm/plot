import { describe, expect, it } from 'vitest';
import { answered, failed, type PortResult } from '@plot-pm/domain';
import type { MergeDest } from '@plot-pm/domain/ports/host';
import { carriedRelease, resolveRelease, type ResolvePorts } from '../../src/server/entry/release-chain.js';

const input = {
  pr: '3488',
  mergeCommit: 'absent',
  mergedAt: '2026-10-01T00:00:00Z',
  base: 'feature/x',
  defaultBranch: 'develop',
  prSource: 'bb',
  noFetch: false,
};

const ports = (
  dests: Readonly<Record<string, readonly MergeDest[]>>,
  tags: PortResult<readonly string[]>,
  over: { contains?: 'yes' | 'no' | 'unknown'; subjects?: readonly string[] } = {},
): ResolvePorts => ({
  host: {
    prMergeDests: async (branch) => answered(dests[branch] ?? []),
    lastRefusal: () => null,
    backend: async () => answered('github'),
  },
  refs: {
    contains: async () => answered(over.contains ?? 'unknown'),
    tagsContaining: async () => tags,
    commitSubjects: async () => answered((over.subjects ?? []).map((subject) => ({ at: 0, subject, tree: 't', parentTree: 'p' }))),
    remoteUrl: async () => answered('git@github.com:plot-pm/plot.git'),
  },
});

const hop: MergeDest = { number: 3491, base: 'develop', mergeCommit: '651cb9be', mergedAt: '2026-10-01T00:00:00Z' };

describe('resolveRelease', () => {
  it('names the tag and the destination it walked through', async () => {
    const line = await resolveRelease(input, ports({ 'feature/x': [hop] }, answered(['v5.23.2213', 'v5.24.0'])), () => {});
    expect(line).toBe('shipped\tv5.23.2213 via feature/x');
  });

  it('answers unreleased where the resolved commit carries no release tag', async () => {
    const line = await resolveRelease(input, ports({ 'feature/x': [hop] }, answered([])), () => {});
    expect(line).toBe('unreleased');
  });

  it('reads a resolved commit missing from the clone as cannot tell, never as unreleased', async () => {
    const line = await resolveRelease(input, ports({ 'feature/x': [hop] }, failed()), () => {});
    expect(line).toMatch(/^finding\tdelivered, PR #3488 merged into 'feature\/x' → cannot tell \(merge commit 651cb9be on 'develop' is not in this clone\)/);
  });

  it('reports a host failure as cannot tell and passes the reason to warn', async () => {
    const warned: string[] = [];
    const failing: ResolvePorts = {
      host: { prMergeDests: async () => failed(), lastRefusal: () => ({ kind: 'failed', said: 'HTTP 500' }), backend: async () => answered('github') },
      refs: {
        contains: async () => answered('unknown' as const),
        tagsContaining: async () => answered([]),
        commitSubjects: async () => answered([]),
        remoteUrl: async () => answered('git@github.com:plot-pm/plot.git'),
      },
    };
    const line = await resolveRelease(input, failing, (s) => warned.push(s));
    expect(line).toBe("finding\tdelivered, PR #3488 merged into 'feature/x' → cannot tell (the host did not answer for 'feature/x')");
    expect(warned.join('')).toMatch(/pr-merge-dest feature\/x failed: HTTP 500/);
  });

  it('keeps the not-in-clone finding where the PR merged into the default branch', async () => {
    const line = await resolveRelease({ ...input, base: 'develop' }, ports({}, answered([])), () => {});
    expect(line).toMatch(/names merge commit absent, not in this clone → cannot resolve\\n {4}unreachable: /);
  });

  it('#2238/#2202 bullet 5: a --no-fetch run gets advice naming the flag, not the generic git-fetch suggestion', async () => {
    const ghInput = { ...input, base: 'develop', prSource: 'gh', noFetch: true };
    const line = await resolveRelease(ghInput, ports({}, answered([])), () => {});
    expect(line).toMatch(/cannot resolve\\n {4}re-run without --no-fetch\/--offline: /);
  });

  it('a normal (non --no-fetch) run that still cannot resolve a commit gets different advice than the --no-fetch run', async () => {
    const ghInput = { ...input, base: 'develop', prSource: 'gh', noFetch: false };
    const line = await resolveRelease(ghInput, ports({}, answered([])), () => {});
    expect(line).toMatch(/cannot resolve\\n {4}inspect: shallow clone, or a destination this remote never held/);
    expect(line).not.toMatch(/--no-fetch/);
  });

  it('walks across a rewritten branch whose merge carries the PR\'s merge subject', async () => {
    const rewritten = { ...input, head: 'feature/tickets', prSource: 'gh' };
    const subjects = ['plot: a later commit', 'Merge pull request #3488 from plot-pm/feature/tickets'];
    const line = await resolveRelease(rewritten, ports({ 'feature/x': [hop] }, answered(['v2.32.0']), { contains: 'no', subjects }), () => {});
    expect(line).toBe('shipped\tv2.32.0 via feature/x');
  });

  it('refuses dead-end where the rewritten branch\'s merge carries no subject for this PR', async () => {
    const rewritten = { ...input, head: 'feature/tickets', prSource: 'gh' };
    const subjects = ['Merge pull request #3499 from plot-pm/feature/tickets'];
    const line = await resolveRelease(rewritten, ports({ 'feature/x': [hop] }, answered(['v2.32.0']), { contains: 'no', subjects }), () => {});
    expect(line).toBe("finding\tdelivered, PR #3488 merged into 'feature/x' → cannot resolve (dead-end at 'feature/x')");
  });
});

describe('carriedRelease', () => {
  const pr = { number: 3488, mergeCommit: '8f6fc983', mergedAt: '2026-10-01T00:00:00Z', base: 'feature/x', head: 'feature/tickets' };
  const subjects = ['Merge pull request #3488 from plot-pm/feature/tickets'];

  it('answers the merge commit that carried the PR onto the default branch, and its tags', async () => {
    const carried = await carriedRelease(pr, 'develop', ports({ 'feature/x': [hop] }, answered(['v2.32.0']), { contains: 'no', subjects }), () => {});
    expect(carried).toEqual({ mergeCommit: '651cb9be', containingTags: ['v2.32.0'] });
  });

  it('answers null for a PR that merged into the default branch', async () => {
    const carried = await carriedRelease({ ...pr, base: 'develop' }, 'develop', ports({ 'feature/x': [hop] }, answered(['v2.32.0'])), () => {});
    expect(carried).toBeNull();
  });

  it('answers null where the walk refuses', async () => {
    const carried = await carriedRelease(pr, 'develop', ports({ 'feature/x': [hop] }, answered(['v2.32.0']), { contains: 'no' }), () => {});
    expect(carried).toBeNull();
  });
});

describe('the owner the subject names', () => {
  it('refuses a subject naming another owner\'s branch', async () => {
    const rewritten = { ...input, head: 'feature/tickets', prSource: 'gh' };
    const subjects = ['Merge pull request #3488 from otherorg/feature/tickets'];
    const line = await resolveRelease(rewritten, ports({ 'feature/x': [hop] }, answered(['v2.32.0']), { contains: 'no', subjects }), () => {});
    expect(line).toBe("finding\tdelivered, PR #3488 merged into 'feature/x' → cannot resolve (dead-end at 'feature/x')");
  });
});

