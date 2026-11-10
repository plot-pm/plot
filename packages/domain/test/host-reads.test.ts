import { describe, expect, it } from 'vitest';

import type { GithubApi, GithubApiOptions, GithubRequest } from '../src/adapters/host/github-api.js';
import { hostFixture } from '../src/adapters/host/host-fixture.js';
import { hostReadsFor, hostWithListing } from '../src/adapters/host/host-reads.js';
import { hostForReads } from '../src/adapters/host/process-host-reads.js';
import type { Host, LimitObservation, PrListing } from '../src/ports/host.js';

const context = { repoRoot: '/nonexistent', scriptDir: '/nonexistent' };

/** A shell `Host` whose listing answers one fixed row and records every call. */
const shellHost = (): Host & { calls: string[]; observed: LimitObservation[] } => {
  const calls: string[] = [];
  const observed: LimitObservation[] = [];
  const base = hostFixture({});
  return {
    ...base,
    calls,
    observed,
    prListing: async () => {
      calls.push('prListing');
      return { answer: 'answered', rows: [], complete: { open: 'whole' }, refusal: null } satisfies PrListing;
    },
    prState: async (ref) => {
      calls.push('prState');
      return base.prState(ref);
    },
    prList: async () => {
      calls.push('prList');
      return { ok: true, value: [] };
    },
    observe: (o) => {
      observed.push(o);
    },
    lastRefusal: () => ({ kind: 'failed', said: 'the shell said no' }),
  };
};

/** A fake client: a token from `source`, and one listing page with PR #7. */
const fakeClient =
  (source: 'GH_TOKEN' | 'gh auth token' | null, seen: { options: GithubApiOptions | null; requests: GithubRequest[] }) =>
  (options: GithubApiOptions): GithubApi => {
    seen.options = options;
    return {
      origin: { host: 'github.com', slug: 'o/r' },
      base: 'http://stub',
      graphql: 'http://stub/graphql',
      tokenSource: async () => source,
      account: async () => 'census',
      request: async (request) => {
        seen.requests.push(request);
        return {
          ok: true,
          reply: {
            status: 200,
            headers: {},
            body: {
              data: {
                repository: {
                  pullRequests: {
                    nodes: [{ number: 7, title: 't', state: 'OPEN', headRefName: 'feature/x', isDraft: false, url: 'u', headRefOid: 'abc' }],
                    pageInfo: { hasNextPage: false },
                  },
                },
              },
            },
          },
        };
      },
    };
  };

const github = { backend: 'github', ci: 'github-actions' };

describe('hostReadsFor', () => {
  it('reads PR listings in-process on GitHub with a token, and names the token source', async () => {
    const shell = shellHost();
    const seen = { options: null as GithubApiOptions | null, requests: [] as GithubRequest[] };
    const reads = await hostReadsFor(context, github, {
      env: { GH_TOKEN: 'fixture' },
      shell,
      origin: async () => 'git@github.com:o/r.git',
      client: fakeClient('GH_TOKEN', seen),
    });
    expect(reads.choice).toEqual({ transport: 'in-process', reason: 'the git host is github', tokenSource: 'GH_TOKEN' });
    expect(reads.api).not.toBeNull();
    expect(seen.options?.origin).toBe('git@github.com:o/r.git');
    const listing = await reads.host.prListing({ state: 'open', limit: 30 });
    expect(listing.rows.map((r) => r.number)).toEqual([7]);
    expect(seen.requests).toHaveLength(1);
    expect(shell.calls).not.toContain('prListing');
    // The client's observations reach the shell host's observe.
    seen.options?.observe?.({ kind: 'secondary', said: 'x' } as unknown as LimitObservation);
    expect(shell.observed).toHaveLength(1);
  });

  it('keeps the shell for github with CI: jenkins, and asks no token', async () => {
    const shell = shellHost();
    const seen = { options: null as GithubApiOptions | null, requests: [] as GithubRequest[] };
    const reads = await hostReadsFor(context, { backend: 'github', ci: 'jenkins' }, { env: {}, shell, client: fakeClient('GH_TOKEN', seen) });
    expect(reads.choice.transport).toBe('shell');
    expect(reads.choice.reason).toMatch(/^CI is jenkins/);
    expect(reads.api).toBeNull();
    expect(reads.host).toBe(shell);
    expect(seen.options).toBeNull();
  });

  it('keeps the shell untouched on Bitbucket', async () => {
    const shell = shellHost();
    const seen = { options: null as GithubApiOptions | null, requests: [] as GithubRequest[] };
    const reads = await hostReadsFor(context, { backend: 'bitbucket', ci: 'jenkins' }, { env: {}, shell, client: fakeClient('GH_TOKEN', seen) });
    expect(reads.choice).toEqual({ transport: 'shell', reason: 'the git host is bitbucket', tokenSource: null });
    expect(reads.host).toBe(shell);
    expect(seen.options).toBeNull();
  });

  it('keeps the shell where PLOT_HOST_TRANSPORT=shell', async () => {
    const shell = shellHost();
    const seen = { options: null as GithubApiOptions | null, requests: [] as GithubRequest[] };
    const reads = await hostReadsFor(context, github, {
      env: { PLOT_HOST_TRANSPORT: 'shell', GH_TOKEN: 'fixture' },
      shell,
      client: fakeClient('GH_TOKEN', seen),
    });
    expect(reads.choice.reason).toBe('PLOT_HOST_TRANSPORT=shell');
    expect(reads.host).toBe(shell);
    expect(seen.options).toBeNull();
  });

  it('falls back to the shell where no token resolves, and says so', async () => {
    const shell = shellHost();
    const seen = { options: null as GithubApiOptions | null, requests: [] as GithubRequest[] };
    const reads = await hostReadsFor(context, github, { env: {}, shell, origin: async () => null, client: fakeClient(null, seen) });
    expect(reads.choice.transport).toBe('shell');
    expect(reads.choice.reason).toMatch(/^no token/);
    expect(reads.api).toBeNull();
    expect(reads.host).toBe(shell);
  });

  it('reads the origin through git where no seam is given, and survives a repository with none', async () => {
    const shell = shellHost();
    const seen = { options: null as GithubApiOptions | null, requests: [] as GithubRequest[] };
    const reads = await hostReadsFor(context, github, { env: {}, shell, client: fakeClient(null, seen) });
    expect(seen.options?.origin).toBeNull();
    expect(reads.choice.transport).toBe('shell');
  });
});

describe('the composed prList', () => {
  const composed = async () => {
    const shell = shellHost();
    const seen = { options: null as GithubApiOptions | null, requests: [] as GithubRequest[] };
    const reads = await hostReadsFor(context, github, {
      env: { GH_TOKEN: 'fixture' },
      shell,
      origin: async () => 'git@github.com:o/r.git',
      client: fakeClient('GH_TOKEN', seen),
    });
    return { shell, seen, host: reads.host };
  };

  it('answers open, all, merged and settled in-process, settled read as all', async () => {
    const { shell, seen, host } = await composed();
    const settled = await host.prList('settled', 100);
    expect(settled.ok && settled.value.map((pr) => [pr.number, pr.head, pr.state])).toEqual([[7, 'feature/x', 'OPEN']]);
    expect((seen.requests[0]?.body as { variables: { state: string[] } }).variables.state).toEqual(['OPEN', 'CLOSED', 'MERGED']);
    await host.prList('open', undefined, undefined, true);
    expect(JSON.stringify(seen.requests[1]?.body)).toContain('statusCheckRollup');
    await host.prList('merged', 500, '2026-01-01T00:00:00Z');
    expect(shell.calls).toEqual([]);
  });

  it('sends a state the listing does not answer to the shell', async () => {
    const { shell, seen, host } = await composed();
    await host.prList('closed', 10);
    expect(shell.calls).toEqual(['prList']);
    expect(seen.requests).toHaveLength(0);
  });

  it('answers failed and unaskable as the listing did', async () => {
    const shell = shellHost();
    const failing = (answer: 'failed' | 'unaskable') => ({
      prListing: async (): Promise<PrListing> => ({ answer, rows: [], complete: { all: 'possibly-truncated' }, refusal: { kind: 'failed', said: 'no slug' } }),
      lastRefusal: () => ({ kind: 'failed' as const, said: 'no slug' }),
    });
    expect(await hostWithListing(shell, failing('failed')).prList('all')).toEqual({ ok: false, why: 'failed' });
    const refused = await hostWithListing(shell, failing('unaskable')).prList('all');
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.why).toBe('unaskable');
  });
});

describe('hostWithListing', () => {
  it('sends every other operation to the shell, and reports the refusal of the last call', async () => {
    const shell = shellHost();
    const listing = {
      prListing: async (): Promise<PrListing> => ({
        answer: 'failed',
        rows: [],
        complete: { open: 'possibly-truncated' },
        refusal: { kind: 'secondary', said: 'slow down' },
      }),
      lastRefusal: () => ({ kind: 'secondary' as const, said: 'slow down' }),
    };
    const host = hostWithListing(shell, listing);
    await host.prListing({ state: 'open' });
    expect(host.lastRefusal()).toEqual({ kind: 'secondary', said: 'slow down' });
    await host.prState('feature/x');
    expect(shell.calls).toEqual(['prState']);
    expect(host.lastRefusal()).toEqual({ kind: 'failed', said: 'the shell said no' });
  });
});

describe('hostForReads', () => {
  it('answers the in-process composition for its repository, and the shell for any other', async () => {
    const shell = shellHost();
    const seen = { options: null as GithubApiOptions | null, requests: [] as GithubRequest[] };
    const root = { repoRoot: '/nonexistent/host-for-reads', scriptDir: '/nonexistent' };
    const reads = await hostReadsFor(root, github, {
      env: { GH_TOKEN: 'fixture' },
      shell,
      origin: async () => 'git@github.com:o/r.git',
      client: fakeClient('GH_TOKEN', seen),
    });
    expect(hostForReads(root)).toBe(reads.host);
    expect(hostForReads({ repoRoot: '/nonexistent/other', scriptDir: '/nonexistent' })).not.toBe(reads.host);
  });
});
