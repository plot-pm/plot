import { describe, expect, it } from 'vitest';

import { answered, failed } from '@plot-pm/domain';
import type { Trees } from '@plot-pm/domain/ports/trees';

import { freshDeskHold, holdDeskReads } from '../../src/shared/desk-hold.js';

const counting = () => {
  const calls: string[] = [];
  let quiet = 10;
  const trees = {
    locked: async (path: string) => (calls.push(`locked ${path}`), answered(false)),
    dirtyPaths: async (path: string) => (calls.push(`dirty ${path}`), answered(['a'])),
    quietSeconds: async (path: string) => (calls.push(`quiet ${path}`), answered(quiet)),
    unpushedCommits: async (path: string) => (calls.push(`unpushed ${path}`), answered(['c1'])),
  } as unknown as Trees;
  return { trees, calls, setQuiet: (n: number) => void (quiet = n) };
};

describe('holdDeskReads', () => {
  it('reads every desk on the first scan and answers the unnamed desks from the hold after it', async () => {
    const { trees, calls } = counting();
    const hold = freshDeskHold();
    const all = { status: 'all', unpushed: true } as const;
    await holdDeskReads(trees, hold, all, 0).dirtyPaths('/d1');
    await holdDeskReads(trees, hold, all, 0).dirtyPaths('/d2');
    calls.length = 0;
    const named = holdDeskReads(trees, hold, { status: new Set(['/d1']), unpushed: false }, 5_000);
    await named.dirtyPaths('/d1');
    await named.dirtyPaths('/d2');
    expect(calls).toEqual(['dirty /d1']);
  });

  it('ages the held quiet time by the seconds since it was read', async () => {
    const { trees, calls } = counting();
    const hold = freshDeskHold();
    await holdDeskReads(trees, hold, { status: 'all', unpushed: true }, 0).quietSeconds('/d1');
    calls.length = 0;
    const later = await holdDeskReads(trees, hold, { status: new Set(), unpushed: false }, 30_000).quietSeconds('/d1');
    expect(later).toEqual(answered(40));
    expect(calls).toEqual([]);
  });

  it('reads every desk\'s unpushed commits again where a ref moved, and never holds a failed answer', async () => {
    const { trees, calls } = counting();
    const hold = freshDeskHold();
    await holdDeskReads(trees, hold, { status: 'all', unpushed: true }, 0).unpushedCommits('/d1', []);
    calls.length = 0;
    await holdDeskReads(trees, hold, { status: new Set(), unpushed: true }, 1_000).unpushedCommits('/d1', []);
    expect(calls).toEqual(['unpushed /d1']);
    const broken = { ...trees, locked: async () => failed('boom') } as unknown as Trees;
    await holdDeskReads(broken, hold, { status: 'all', unpushed: false }, 0).locked('/d1');
    calls.length = 0;
    await holdDeskReads(trees, hold, { status: new Set(), unpushed: false }, 1_000).locked('/d1');
    expect(calls).toEqual(['locked /d1']);
  });
});
