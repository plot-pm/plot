import { describe, expect, it } from 'vitest';

import type { BitbucketApi } from '../src/adapters/host/bitbucket-api.js';
import type { GithubApi } from '../src/adapters/host/github-api.js';
import { hostFixture } from '../src/adapters/host/host-fixture.js';
import { bitbucketPrsOfCommit, githubPrsOfCommit, hostWithPrsOfCommit } from '../src/adapters/host/prs-of-commit.js';

type Reply =
  | { ok: true; reply: { status: number; body: unknown } }
  | { ok: false; refusal: { kind: 'failed'; said: string }; reply: { status: number; body: unknown } | null };
const ok = (body: unknown, status = 200): Reply => ({ ok: true, reply: { status, body } });
const refused = (said: string, status: number | null = null): Reply => ({
  ok: false,
  refusal: { kind: 'failed', said },
  reply: status === null ? null : { status, body: { message: said } },
});

const SHA = '0835e43b7'.padEnd(40, 'a');

const githubOver = (answer: Reply, slug: string | null = 'o/r') => {
  const asked: string[] = [];
  const api = {
    origin: { host: 'github.com', slug },
    request: async ({ path }: { path: string }) => {
      asked.push(path);
      return answer;
    },
  } as unknown as GithubApi;
  return { api, asked };
};

const githubPull = (over: Record<string, unknown> = {}) => ({
  number: 3478,
  state: 'closed',
  merged_at: '2026-11-20T10:00:00Z',
  merge_commit_sha: SHA,
  draft: false,
  html_url: 'https://github.com/o/r/pull/3478',
  user: { login: 'jwloka' },
  head: { ref: 'idea/templates-show-named-identifiers', sha: 'b'.repeat(40) },
  base: { ref: 'main' },
  ...over,
});

describe('githubPrsOfCommit', () => {
  it('asks the commit pulls endpoint once', async () => {
    const { api, asked } = githubOver(ok([githubPull()]));
    await githubPrsOfCommit(api).prsOfCommit(SHA);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.startsWith(`/repos/o/r/commits/${SHA}/pulls`)).toBe(true);
  });

  it('reads a closed row with merged_at as MERGED and maps head, head sha, merge commit and base', async () => {
    const { api } = githubOver(ok([githubPull()]));
    expect(await githubPrsOfCommit(api).prsOfCommit(SHA)).toEqual({
      ok: true,
      value: [
        {
          number: 3478,
          repo: '',
          head: 'idea/templates-show-named-identifiers',
          headSha: 'b'.repeat(40),
          base: 'main',
          state: 'MERGED',
          mergedAt: '2026-11-20T10:00:00Z',
          mergeCommit: SHA,
          draft: false,
          url: 'https://github.com/o/r/pull/3478',
          author: 'jwloka',
          mergeable: 'unknown',
          checks: 'unknown',
          review: '',
          failingChecks: [],
        },
      ],
    });
  });

  it('reads a closed row with merged_at null as CLOSED', async () => {
    const { api } = githubOver(ok([githubPull({ merged_at: null, merge_commit_sha: 'c'.repeat(40) })]));
    const read = await githubPrsOfCommit(api).prsOfCommit(SHA);
    expect(read.ok && read.value[0]).toMatchObject({ state: 'CLOSED', mergedAt: null, mergeCommit: '' });
  });

  it('reads an open row as OPEN', async () => {
    const { api } = githubOver(ok([githubPull({ state: 'open', merged_at: null, merge_commit_sha: null })]));
    const read = await githubPrsOfCommit(api).prsOfCommit(SHA);
    expect(read.ok && read.value[0]).toMatchObject({ state: 'OPEN', mergedAt: null });
  });

  it('answers an empty list as an answer', async () => {
    const { api } = githubOver(ok([]));
    expect(await githubPrsOfCommit(api).prsOfCommit(SHA)).toEqual({ ok: true, value: [] });
  });

  it('answers failed on an HTTP failure and keeps the refusal', async () => {
    const { api } = githubOver(refused('HTTP 422: No commit found', 422));
    const reader = githubPrsOfCommit(api);
    expect(await reader.prsOfCommit(SHA)).toEqual({ ok: false, why: 'failed' });
    expect(reader.lastRefusal()).toEqual({ kind: 'failed', said: 'HTTP 422: No commit found' });
  });

  it('answers failed, never an empty list, for a body that is not a list or a missing slug', async () => {
    expect(await githubPrsOfCommit(githubOver(ok({ message: 'x' })).api).prsOfCommit(SHA)).toEqual({ ok: false, why: 'failed' });
    const { api, asked } = githubOver(ok([]), null);
    expect(await githubPrsOfCommit(api).prsOfCommit(SHA)).toEqual({ ok: false, why: 'failed' });
    expect(asked).toEqual([]);
  });
});

const bitbucketOver = (answer: Reply) => {
  const asked: string[] = [];
  const api = {
    nextPath: () => ({ ok: false, refusal: { kind: 'failed', said: 'no next' } }),
    request: async ({ path }: { path: string }) => {
      asked.push(path);
      return answer;
    },
  } as unknown as BitbucketApi;
  return { api, asked };
};

const bitbucketPull = (over: Record<string, unknown> = {}) => ({
  id: 12,
  state: 'MERGED',
  draft: false,
  updated_on: '2026-11-20T10:00:00.123456+00:00',
  merge_commit: { hash: SHA },
  links: { html: { href: 'https://bitbucket.org/w/r/pull-requests/12' } },
  author: { nickname: 'dev' },
  source: { branch: { name: 'idea/x' }, commit: { hash: 'b'.repeat(12) } },
  destination: { branch: { name: 'main' } },
  ...over,
});

describe('bitbucketPrsOfCommit', () => {
  it('asks the commit pullrequests endpoint and maps merge_commit.hash', async () => {
    const { api, asked } = bitbucketOver(ok({ values: [bitbucketPull()] }));
    const read = await bitbucketPrsOfCommit(api).prsOfCommit(SHA);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.startsWith(`/repositories/{ws}/{repo}/commit/${SHA}/pullrequests`)).toBe(true);
    expect(read.ok && read.value).toEqual([
      expect.objectContaining({ number: 12, state: 'MERGED', mergeCommit: SHA, head: 'idea/x', headSha: 'b'.repeat(12), base: 'main', author: 'dev' }),
    ]);
  });

  it('reads DECLINED as CLOSED', async () => {
    const { api } = bitbucketOver(ok({ values: [bitbucketPull({ state: 'DECLINED' })] }));
    const read = await bitbucketPrsOfCommit(api).prsOfCommit(SHA);
    expect(read.ok && read.value[0]).toMatchObject({ state: 'CLOSED', mergedAt: null, mergeCommit: '' });
  });

  it('answers HTTP 202 as unaskable and names the reason, never an empty list', async () => {
    const { api } = bitbucketOver(ok({}, 202));
    const read = await bitbucketPrsOfCommit(api).prsOfCommit(SHA);
    expect(read).toMatchObject({ ok: false, why: 'unaskable' });
    expect(!read.ok && read.why === 'unaskable' && read.reason).toMatch(/HTTP 202.*indexing/);
  });

  it('answers HTTP 404 as unaskable and names the reason', async () => {
    const { api } = bitbucketOver(refused('HTTP 404: not found', 404));
    const read = await bitbucketPrsOfCommit(api).prsOfCommit(SHA);
    expect(read).toMatchObject({ ok: false, why: 'unaskable' });
    expect(!read.ok && read.why === 'unaskable' && read.reason).toMatch(/HTTP 404/);
  });

  it('answers any other failure as failed and keeps the refusal', async () => {
    const { api } = bitbucketOver(refused('HTTP 500: boom', 500));
    const reader = bitbucketPrsOfCommit(api);
    expect(await reader.prsOfCommit(SHA)).toEqual({ ok: false, why: 'failed' });
    expect(reader.lastRefusal()).toEqual({ kind: 'failed', said: 'HTTP 500: boom' });
  });

  it('answers an empty values list as an answer', async () => {
    const { api } = bitbucketOver(ok({ values: [] }));
    expect(await bitbucketPrsOfCommit(api).prsOfCommit(SHA)).toEqual({ ok: true, value: [] });
  });
});

describe('hostWithPrsOfCommit', () => {
  it("reports the reader's refusal after prsOfCommit and the host's after any other call", async () => {
    const base = { ...hostFixture({}), lastRefusal: () => ({ kind: 'failed' as const, said: 'the host said no' }) };
    const host = hostWithPrsOfCommit(base, githubPrsOfCommit(githubOver(refused('reader said no')).api));
    await host.prsOfCommit(SHA);
    expect(host.lastRefusal()).toEqual({ kind: 'failed', said: 'reader said no' });
    await host.prState('feature/x');
    expect(host.lastRefusal()).toEqual({ kind: 'failed', said: 'the host said no' });
  });
});
