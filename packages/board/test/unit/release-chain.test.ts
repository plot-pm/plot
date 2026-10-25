import { describe, expect, it } from 'vitest';
import { answered, failed, type PortResult } from '@plot-pm/domain';
import type { MergeDest } from '@plot-pm/domain/ports/host';
import { resolveRelease, type ResolvePorts } from '../../src/server/entry/release-chain.js';

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
): ResolvePorts => ({
  host: {
    prMergeDests: async (branch) => answered(dests[branch] ?? []),
    lastRefusal: () => null,
  },
  refs: {
    contains: async () => answered('unknown' as const),
    tagsContaining: async () => tags,
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
      host: { prMergeDests: async () => failed(), lastRefusal: () => ({ kind: 'failed', said: 'HTTP 500' }) },
      refs: { contains: async () => answered('unknown' as const), tagsContaining: async () => answered([]) },
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
});
