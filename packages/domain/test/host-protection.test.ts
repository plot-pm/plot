import { describe, expect, it } from 'vitest';

import { bitbucketProtection, githubProtection } from '../src/adapters/host/host-protection.js';
import { hostShell } from '../src/adapters/host/host-shell.js';

const refusal = { kind: 'auth', said: 'HTTP 403' } as const;

const github = (answer: unknown, slug: string | null = 'o/r') =>
  githubProtection({ origin: { host: 'github.com', slug }, request: async () => answer } as never);

const bitbucket = (pages: unknown[]) => {
  let at = 0;
  return bitbucketProtection({
    request: async () => pages[at++],
    nextPath: (next: string) => ({ ok: true, path: next }),
  } as never);
};

const page = (values: unknown[], next?: string) => ({ ok: true, reply: { status: 200, headers: {}, body: { values, ...(next === undefined ? {} : { next }) } } });

describe('githubProtection', () => {
  it('reads protected as the word and unprotected as an empty list', async () => {
    expect(await github({ ok: true, reply: { status: 200, headers: {}, body: { protected: true } } }).branchRestrictions('main')).toEqual({ ok: true, value: ['protected'] });
    expect(await github({ ok: true, reply: { status: 200, headers: {}, body: { protected: false } } }).branchRestrictions('main')).toEqual({ ok: true, value: [] });
  });

  it('reads a refusal, a body with no flag and a missing slug as failed, never as empty', async () => {
    const refused = github({ ok: false, refusal, reply: null });
    expect((await refused.branchRestrictions('main')).ok).toBe(false);
    expect(refused.lastRefusal()).toEqual(refusal);
    expect((await github({ ok: true, reply: { status: 200, headers: {}, body: {} } }).branchRestrictions('main')).ok).toBe(false);
    expect((await github({ ok: true, reply: { status: 200, headers: {}, body: { protected: true } } }, null).branchRestrictions('main')).ok).toBe(false);
  });
});

describe('bitbucketProtection', () => {
  it('collects the kinds on the branch and on the production branch, across pages', async () => {
    const read = bitbucket([
      page([{ pattern: 'main', kind: 'push' }, { pattern: 'dev', kind: 'delete' }], 'https://x/next'),
      page([{ branch_match_kind: 'branching_model', branch_type: 'production', kind: 'require_passing_builds_to_merge' }]),
    ]);
    expect(await read.branchRestrictions('main')).toEqual({ ok: true, value: ['push', 'require_passing_builds_to_merge'] });
  });

  it('answers an empty list only for an answered page with no restriction', async () => {
    expect(await bitbucket([page([])]).branchRestrictions('main')).toEqual({ ok: true, value: [] });
  });

  it('reads a 403 and a page without values as failed', async () => {
    const denied = bitbucket([{ ok: false, refusal, reply: null }]);
    expect((await denied.branchRestrictions('main')).ok).toBe(false);
    expect(denied.lastRefusal()).toEqual(refusal);
    expect((await bitbucket([{ ok: true, reply: { status: 200, headers: {}, body: {} } }]).branchRestrictions('main')).ok).toBe(false);
  });
});

describe('the shell host', () => {
  it('cannot be asked about branch restrictions', async () => {
    const read = await hostShell({ repoRoot: '/nowhere', scriptDir: '/nowhere' }).branchRestrictions('main');
    expect(read.ok).toBe(false);
  });
});
