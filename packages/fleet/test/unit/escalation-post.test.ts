import { describe, expect, it } from 'vitest';

import { postEscalation, type EscalationPostWorld } from '../../src/shared/escalation-post.js';

const post = { branch: 'feature/x', askedAt: '2026-11-05T10:00:00.000Z', question: 'which?', reason: 'test' };

const worldWith = (issue: string | null, answer: { ok: true; value: 'commented' } | { ok: false; why: 'unaskable' | 'failed' }) => {
  const calls: { id: string; body: string; marker?: string }[] = [];
  const world: EscalationPostWorld = {
    issueOf: async () => issue,
    tracker: async () => ({
      issueComment: async (id, body, marker) => {
        calls.push({ id, body, marker });
        return answer as never;
      },
      lastRefusal: () => null,
    }),
  };
  return { world, calls };
};

describe('postEscalation', () => {
  it('makes one issueComment call on the plan issue, and a second pass uses the same marker', async () => {
    const { world, calls } = worldWith('3064', { ok: true, value: 'commented' });
    expect(await postEscalation(world, post)).toEqual({ posted: true });
    expect(await postEscalation(world, post)).toEqual({ posted: true });
    expect(calls.map((call) => call.id)).toEqual(['3064', '3064']);
    expect(calls[0].marker).toBeDefined();
    expect(calls[1].marker).toBe(calls[0].marker);
    expect(calls[0].body).toContain('escalated: test');
  });

  it('uses another marker for a question asked at another time', async () => {
    const { world, calls } = worldWith('3064', { ok: true, value: 'commented' });
    await postEscalation(world, post);
    await postEscalation(world, { ...post, askedAt: '2026-11-05T12:00:00.000Z' });
    expect(calls[1].marker).not.toBe(calls[0].marker);
  });

  it('posts an answer-cap escalation with its reason', async () => {
    const { world, calls } = worldWith('3064', { ok: true, value: 'commented' });
    await postEscalation(world, { ...post, reason: 'answer-cap' });
    expect(calls[0].body).toContain('escalated: answer-cap');
  });

  it('makes no call for a plan with no Issue line, and says why', async () => {
    const { world, calls } = worldWith(null, { ok: true, value: 'commented' });
    expect(await postEscalation(world, post)).toEqual({ posted: false, why: 'the plan names no issue' });
    expect(calls).toEqual([]);
  });

  it('reports an unaskable tracker as not posted', async () => {
    const { world } = worldWith('3064', { ok: false, why: 'unaskable' });
    expect(await postEscalation(world, post)).toEqual({ posted: false, why: 'tracker unaskable' });
  });

  it('reports a failed tracker as not posted', async () => {
    const { world } = worldWith('3064', { ok: false, why: 'failed' });
    expect(await postEscalation(world, post)).toEqual({ posted: false, why: 'tracker failed' });
  });

  it('does not throw where the tracker throws', async () => {
    const world: EscalationPostWorld = {
      issueOf: async () => '1',
      tracker: async () => {
        throw new Error('no token');
      },
    };
    expect(await postEscalation(world, post)).toEqual({ posted: false, why: 'no token' });
  });
});
