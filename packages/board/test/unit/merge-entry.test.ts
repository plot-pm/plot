import { describe, it, expect } from 'vitest';
import type { Pr } from '@plot-pm/domain';
import { mergeAt, type MergePorts } from '../../src/server/entry/merge.js';

const HEAD = 'a'.repeat(40);

const pr = (over: Partial<Pr> = {}): Pr => ({
  number: 7, repo: '', head: 'feature/x', state: 'OPEN', mergedAt: null, mergeCommit: '',
  draft: false, mergeable: 'mergeable', review: '', checks: 'green', failingChecks: [],
  url: '', author: '', headSha: HEAD, checksSha: HEAD, ...over,
});

/** Ports that answer as given and record every script call. */
const ports = (lookup: Pr | 'unaskable', answer: 'answered' | 'failed' = 'answered') => {
  const calls: string[][] = [];
  const p = {
    host: {
      prState: async () => (lookup === 'unaskable'
        ? { ok: false, refusal: 'unaskable', said: 'down' }
        : { ok: true, value: lookup }),
    },
    scripts: {
      hostSaid: async (args: string[]) => {
        calls.push(args);
        return { answer, said: answer === 'answered' ? '' : 'GraphQL: head moved' };
      },
    },
    defaultBranch: { read: async () => ({ ok: true, value: null }) },
  } as unknown as MergePorts;
  return { p, calls };
};

describe('mergeAt', () => {
  it('passes the caller’s sha to the host as --match-head', async () => {
    const { p, calls } = ports(pr());
    const out = await mergeAt(p, 7, HEAD);
    expect(out).toMatchObject({ merged: true, pr: 7, sha: HEAD, defaultBranchRead: false });
    expect(calls).toEqual([['pr-merge', '7', '--match-head', HEAD]]);
  });

  it('calls no script when the domain refuses', async () => {
    const { p, calls } = ports(pr({ headSha: 'b'.repeat(40) }));
    expect(await mergeAt(p, 7, HEAD)).toMatchObject({ merged: false, reason: 'head-moved' });
    expect(calls).toEqual([]);
  });

  it('refuses unaskable when the host lookup fails', async () => {
    const { p, calls } = ports('unaskable');
    expect(await mergeAt(p, 7, HEAD)).toMatchObject({ merged: false, reason: 'unaskable' });
    expect(calls).toEqual([]);
  });

  it('reports host-refused with the host’s words and never retries without the pin', async () => {
    const { p, calls } = ports(pr(), 'failed');
    expect(await mergeAt(p, 7, HEAD)).toMatchObject({
      merged: false, reason: 'host-refused', detail: 'GraphQL: head moved',
    });
    expect(calls).toHaveLength(1);
  });
});
