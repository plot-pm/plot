import { describe, expect, it } from 'vitest';

import type { BitbucketApi } from '../src/adapters/host/bitbucket-api.js';
import type { GithubApi } from '../src/adapters/host/github-api.js';
import { hostFixture } from '../src/adapters/host/host-fixture.js';
import { bitbucketPrConversation, githubPrConversation, hostWithConversation } from '../src/adapters/host/pr-conversation.js';

type Reply = { ok: true; reply: { body: unknown } } | { ok: false; refusal: { kind: 'failed'; said: string }; reply: null };
const ok = (body: unknown): Reply => ({ ok: true, reply: { body } });
const refused = (said: string): Reply => ({ ok: false, refusal: { kind: 'failed', said }, reply: null });

const githubOver = (answers: Record<string, Reply>, slug: string | null = 'o/r') => {
  const asked: string[] = [];
  const api = {
    origin: { host: 'github.com', slug },
    request: async ({ path }: { path: string }) => {
      asked.push(path);
      return answers[path] ?? refused(`no answer for ${path}`);
    },
  } as unknown as GithubApi;
  return { api, asked };
};

const comment = (id: number, extra: Record<string, unknown> = {}) => ({
  id, user: { login: 'eins78', type: 'User' }, created_at: '2026-11-09T14:32:00Z', updated_at: '2026-11-10T09:00:00Z', body: `c${id}`, ...extra,
});

describe('githubPrConversation', () => {
  const pull = ok({ user: { login: 'jwloka' } });
  const empty = ok([]);
  const answers = (over: Record<string, Reply> = {}): Record<string, Reply> => ({
    '/repos/o/r/pulls/7': pull,
    '/repos/o/r/issues/7/comments?per_page=100&page=1': empty,
    '/repos/o/r/pulls/7/comments?per_page=100&page=1': empty,
    '/repos/o/r/pulls/7/reviews?per_page=100&page=1': empty,
    ...over,
  });

  it('reads the author from the pull request and a row from each of the three endpoints', async () => {
    const { api } = githubOver(
      answers({
        '/repos/o/r/issues/7/comments?per_page=100&page=1': ok([comment(1)]),
        '/repos/o/r/pulls/7/comments?per_page=100&page=1': ok([comment(2)]),
        '/repos/o/r/pulls/7/reviews?per_page=100&page=1': ok([{ id: 3, user: { login: 'eins78', type: 'User' }, submitted_at: '2026-11-09T15:00:00Z', body: '', state: 'CHANGES_REQUESTED' }]),
      }),
    );
    const read = await githubPrConversation(api).prConversation(7);
    expect(read).toEqual({
      ok: true,
      value: {
        prAuthor: 'jwloka',
        rows: [
          { kind: 'issue', id: 1, login: 'eins78', type: 'User', time: '2026-11-09T14:32:00Z', body: 'c1' },
          { kind: 'inline', id: 2, login: 'eins78', type: 'User', time: '2026-11-09T14:32:00Z', body: 'c2' },
          { kind: 'review', id: 3, login: 'eins78', type: 'User', time: '2026-11-09T15:00:00Z', body: '', state: 'CHANGES_REQUESTED' },
        ],
      },
    });
  });

  it('keeps created_at for an edited comment', async () => {
    const { api } = githubOver(answers({ '/repos/o/r/issues/7/comments?per_page=100&page=1': ok([comment(1)]) }));
    const read = await githubPrConversation(api).prConversation(7);
    expect(read.ok && read.value.rows[0]?.time).toBe('2026-11-09T14:32:00Z');
  });

  it('reads a deleted account as empty login and type', async () => {
    const { api } = githubOver(answers({ '/repos/o/r/issues/7/comments?per_page=100&page=1': ok([comment(1, { user: null })]) }));
    const read = await githubPrConversation(api).prConversation(7);
    expect(read.ok && read.value.rows[0]).toMatchObject({ login: '', type: '' });
  });

  it('follows a full page to the next page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => comment(i + 1));
    const { api, asked } = githubOver(
      answers({
        '/repos/o/r/issues/7/comments?per_page=100&page=1': ok(full),
        '/repos/o/r/issues/7/comments?per_page=100&page=2': ok([comment(101)]),
      }),
    );
    const read = await githubPrConversation(api).prConversation(7);
    expect(read.ok && read.value.rows).toHaveLength(101);
    expect(read.ok && read.value.rows[100]?.id).toBe(101);
    expect(asked).toContain('/repos/o/r/issues/7/comments?per_page=100&page=2');
  });

  it('answers failed, never a short list, when page 2 fails', async () => {
    const full = Array.from({ length: 100 }, (_, i) => comment(i + 1));
    const { api } = githubOver(
      answers({
        '/repos/o/r/issues/7/comments?per_page=100&page=1': ok(full),
        '/repos/o/r/issues/7/comments?per_page=100&page=2': refused('HTTP 502'),
      }),
    );
    const reader = githubPrConversation(api);
    expect(await reader.prConversation(7)).toEqual({ ok: false, why: 'failed' });
    expect(reader.lastRefusal()).toEqual({ kind: 'failed', said: 'HTTP 502' });
  });

  it('answers failed for a body that is not a list and for a missing slug', async () => {
    const { api } = githubOver(answers({ '/repos/o/r/pulls/7/reviews?per_page=100&page=1': ok({ message: 'x' }) }));
    expect(await githubPrConversation(api).prConversation(7)).toEqual({ ok: false, why: 'failed' });
    const none = githubOver({}, null);
    expect(await githubPrConversation(none.api).prConversation(7)).toEqual({ ok: false, why: 'failed' });
    expect(none.asked).toEqual([]);
  });
});

describe('bitbucketPrConversation', () => {
  const base = 'https://api.bitbucket.org/2.0';
  const pr = '/repositories/{ws}/{repo}/pullrequests/7';
  const bbOver = (answers: Record<string, Reply>) => {
    const api = {
      request: async ({ path }: { path: string }) => answers[path] ?? refused(`no answer for ${path}`),
      nextPath: (next: string) => (next.startsWith(`${base}/`) ? { ok: true, path: next.slice(base.length) } : { ok: false, refusal: { kind: 'failed', said: 'outside' } }),
    } as unknown as BitbucketApi;
    return api;
  };
  const head = ok({ author: { nickname: 'jwloka' }, participants: [{ user: { nickname: 'eins78', type: 'user' }, approved: true, participated_on: '2026-11-09T16:00:00Z' }] });
  const bbComment = (id: number, extra: Record<string, unknown> = {}) => ({ id, user: { nickname: 'eins78', type: 'user' }, created_on: '2026-11-09T14:32:00Z', content: { raw: `c${id}` }, ...extra });

  it('folds the pull request and every comment page, following next', async () => {
    const api = bbOver({
      [pr]: head,
      [`${pr}/comments?pagelen=100`]: ok({ values: [bbComment(1)], next: `${base}${pr}/comments?pagelen=100&page=2` }),
      [`${pr}/comments?pagelen=100&page=2`]: ok({ values: [bbComment(2, { inline: { path: 'a.ts' } })] }),
    });
    const read = await bitbucketPrConversation(api).prConversation(7);
    expect(read.ok && read.value.prAuthor).toBe('jwloka');
    expect(read.ok && read.value.rows.map((r) => [r.kind, r.id, r.state])).toEqual([
      ['issue', 1, undefined],
      ['inline', 2, undefined],
      ['review', 0, 'APPROVED'],
    ]);
  });

  it('answers failed when a page fails or a next link leaves the base', async () => {
    const failing = bbOver({ [pr]: head, [`${pr}/comments?pagelen=100`]: refused('HTTP 500') });
    expect(await bitbucketPrConversation(failing).prConversation(7)).toEqual({ ok: false, why: 'failed' });
    const outside = bbOver({ [pr]: head, [`${pr}/comments?pagelen=100`]: ok({ values: [], next: 'https://elsewhere.example/x' }) });
    expect(await bitbucketPrConversation(outside).prConversation(7)).toEqual({ ok: false, why: 'failed' });
  });
});

describe('hostWithConversation', () => {
  it('answers prConversation from the reader and keeps every other call on the host', async () => {
    const reader = { prConversation: async () => ({ ok: true as const, value: { prAuthor: 'a', rows: [] } }), lastRefusal: () => null };
    const host = hostWithConversation(hostFixture({}), reader);
    expect(await host.prConversation(1)).toEqual({ ok: true, value: { prAuthor: 'a', rows: [] } });
    expect(typeof host.prReview).toBe('function');
  });

  it('reports the reader refusal after a conversation read and the host refusal after another call', async () => {
    const refusal = { kind: 'failed' as const, said: 'reader said' };
    const reader = { prConversation: async () => ({ ok: false as const, why: 'failed' as const }), lastRefusal: () => refusal };
    const host = hostWithConversation(hostFixture({}), reader);
    await host.prConversation(1);
    expect(host.lastRefusal()).toEqual(refusal);
    await host.prReview(1);
    expect(host.lastRefusal()).not.toEqual(refusal);
  });
});

describe('the fixture host', () => {
  it('answers failed for a PR it holds no conversation for', async () => {
    expect(await hostFixture({ conversations: { 1: { prAuthor: 'a', rows: [] } } }).prConversation(2)).toEqual({ ok: false, why: 'failed' });
  });
});
