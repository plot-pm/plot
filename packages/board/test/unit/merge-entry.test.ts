import { describe, it, expect } from 'vitest';
import type { Pr } from '@plot-pm/domain';
import type { DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import { mergeAt, type MergePorts } from '../../src/server/entry/merge.js';

const HEAD = 'a'.repeat(40);
const NOW = Date.parse('2026-10-11T12:00:00Z');
const WAIT_MS = 3_600_000;

const settled = (state: 'red' | 'green', askedAt: string): DefaultBranchReading => ({
  v: 1, branch: 'main', headSha: 'c'.repeat(40), head: state,
  settled: { sha: 'c'.repeat(40), state }, failingRuns: [],
  headSince: askedAt, askedAt, at: askedAt,
});
const red = (askedAt: string): DefaultBranchReading => settled('red', askedAt);

type Read = { ok: true; value: DefaultBranchReading | null } | { ok: false; refusal: string; said: string };

const pr = (over: Partial<Pr> = {}): Pr => ({
  number: 7, repo: '', head: 'feature/x', state: 'OPEN', mergedAt: null, mergeCommit: '',
  draft: false, mergeable: 'mergeable', review: '', checks: 'green', failingChecks: [],
  url: '', author: '', headSha: HEAD, checksSha: HEAD, ...over,
});

/** Ports that answer as given and record every script call. */
const ports = (lookup: Pr | 'unaskable', answer: 'answered' | 'failed' = 'answered', read: Read = { ok: true, value: null }) => {
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
    defaultBranch: { read: async () => read },
    checksWaitMs: WAIT_MS,
    now: () => NOW,
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

  it('refuses unaskable when the default-branch read fails, and merges nothing', async () => {
    const { p, calls } = ports(pr(), 'answered', { ok: false, refusal: 'failed', said: 'EACCES' });
    expect(await mergeAt(p, 7, HEAD)).toMatchObject({ merged: false, reason: 'unaskable' });
    expect(calls).toEqual([]);
  });

  it('merges when no default-branch reading exists', async () => {
    const { p, calls } = ports(pr(), 'answered', { ok: true, value: null });
    expect(await mergeAt(p, 7, HEAD)).toMatchObject({ merged: true, defaultBranchRead: false });
    expect(calls).toHaveLength(1);
  });

  it('refuses on a red reading within Checks wait', async () => {
    const fresh = new Date(NOW - WAIT_MS + 60_000).toISOString();
    const { p, calls } = ports(pr(), 'answered', { ok: true, value: red(fresh) });
    expect(await mergeAt(p, 7, HEAD)).toMatchObject({ merged: false, reason: 'default-branch-red' });
    expect(calls).toEqual([]);
  });

  it('refuses a red reading older than Checks wait as stale, and merges nothing', async () => {
    const old = new Date(NOW - WAIT_MS - 60_000).toISOString();
    const { p, calls } = ports(pr(), 'answered', { ok: true, value: red(old) });
    expect(await mergeAt(p, 7, HEAD)).toMatchObject({ merged: false, reason: 'default-branch-stale' });
    expect(calls).toEqual([]);
  });

  it('refuses a days-old green reading as stale, and merges nothing', async () => {
    const old = new Date(NOW - 3 * 24 * WAIT_MS).toISOString();
    const { p, calls } = ports(pr(), 'answered', { ok: true, value: settled('green', old) });
    expect(await mergeAt(p, 7, HEAD)).toMatchObject({ merged: false, reason: 'default-branch-stale' });
    expect(calls).toEqual([]);
  });

  it('merges on a green reading within Checks wait', async () => {
    const fresh = new Date(NOW - WAIT_MS + 60_000).toISOString();
    const { p, calls } = ports(pr(), 'answered', { ok: true, value: settled('green', fresh) });
    expect(await mergeAt(p, 7, HEAD)).toMatchObject({ merged: true, defaultBranchRead: true });
    expect(calls).toHaveLength(1);
  });
});
