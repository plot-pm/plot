import { describe, expect, it } from 'vitest';

import type { GithubApi, GithubRequest } from '../src/adapters/host/github-api.js';
import { trackerGitHost, trackerOfSource } from '../src/adapters/tracker/tracker-resolve.js';

const context = { repoRoot: '/nonexistent', scriptDir: '/nonexistent' };

/** A fake client whose every GraphQL answer is one open issue, or a refusal. */
const fakeClient = (requests: GithubRequest[], refuse = false): GithubApi => ({
  origin: { host: 'github.com', slug: 'o/r' },
  base: 'http://stub',
  graphql: 'http://stub/graphql',
  tokenSource: async () => 'GH_TOKEN',
  account: async () => 'census',
  request: async (request) => {
    requests.push(request);
    if (refuse) return { ok: false, refusal: { kind: 'secondary', said: 'You have exceeded a secondary rate limit.' }, reply: null };
    return {
      ok: true,
      reply: {
        status: 200,
        headers: {},
        body: {
          data: {
            repository: {
              hasIssuesEnabled: true,
              issues: { nodes: [{ number: 3, title: 'one', state: 'OPEN', url: 'u3' }], pageInfo: { hasNextPage: false } },
            },
          },
        },
      },
    };
  },
});

describe('trackerGitHost with a client', () => {
  it('reads the open issues in-process on a github git host', async () => {
    const requests: GithubRequest[] = [];
    const tracker = trackerGitHost('github', context, fakeClient(requests));
    const read = await tracker.issueListOpen(30);
    expect(read.ok && read.value.issues.map((i) => i.id)).toEqual(['3']);
    expect(requests).toHaveLength(1);
    expect(tracker.lastRefusal()).toBeNull();
  });

  it('records the refusal GitHub named for lastRefusal', async () => {
    const tracker = trackerGitHost('github', context, fakeClient([], true));
    const read = await tracker.issueListOpen(30);
    expect(read.ok).toBe(false);
    expect(tracker.lastRefusal()).toBe('You have exceeded a secondary rate limit.');
  });

  it('sends no request on a git host other than github', async () => {
    const requests: GithubRequest[] = [];
    const tracker = trackerGitHost('bitbucket', context, fakeClient(requests));
    await tracker.issueListOpen(30);
    expect(requests).toHaveLength(0);
  });

  it('passes the client through trackerOfSource to the git host and to a github-issues tracker', async () => {
    const viaHost: GithubRequest[] = [];
    await trackerOfSource({ ask: 'git-host' }, '', 'github', context, fakeClient(viaHost)).issueListOpen(30);
    expect(viaHost).toHaveLength(1);
    const viaTracker: GithubRequest[] = [];
    await trackerOfSource({ ask: 'tracker', scheme: 'github-issues' }, 'github-issues', 'github', context, fakeClient(viaTracker)).issueListOpen(30);
    expect(viaTracker).toHaveLength(1);
  });
});

describe('the issue listing per client', () => {
  it('asks the search-type introspection once per client, however many trackers are built over it', async () => {
    const requests: GithubRequest[] = [];
    const api = fakeClient(requests);
    await trackerGitHost('github', context, api).issueListChanged('2026-01-01T00:00:00Z', 30);
    await trackerGitHost('github', context, api).issueListChanged('2026-01-01T00:00:00Z', 30);
    expect(requests.filter((r) => r.label === 'graphql, search types')).toHaveLength(1);
  });
});
