// The Release delivery section follows the Delivery scope: title, plans and groups.
import { describe, it, expect } from 'vitest';
import { deliveryScope, parsePersonDirectory } from '@plot-pm/domain';
import type { AgentRow, Slice } from '../../src/contract/schema.js';
import { deliveryMapping } from '../../src/app/lib/agent-rows/delivery-readings.js';
import { placeMapping } from '../../src/app/lib/agent-rows/delivery-view.js';

const reader = { hostUser: 'me', directory: parsePersonDirectory('me = Me; them = Them') };
const sprint = (slug: string, owner: string, members: string[], release = '') => ({
  slug, title: `Title ${slug}`, release, ownerHandle: owner, members: members.map((m) => ({ slug: m })),
});
const alpha = sprint('alpha', 'me', ['p1', 'p2']);
const beta = sprint('beta', 'me', ['p2', 'p3']);
const theirs = sprint('theirs', 'them', ['p4']);
const ownerless = sprint('nobody', '', ['p5']);

const mergedSlice = (plan: string): Slice =>
  ({ plan, name: 'a', branches: [], verdict: 'complete', section: 'done', complete: true, planSliceCount: 1, merge: 'merged' }) as unknown as Slice;
const unreadSlice = (plan: string): Slice =>
  ({ plan, name: 'a', branches: [], verdict: 'eligible', section: 'building', complete: false, planSliceCount: 1 }) as unknown as Slice;
const mergedRow = (plan: string): AgentRow => ({
  branch: `feature/${plan}-a`, plan, wave: 'a', kind: 'branch', phase: 'Testing', planState: 'delivered', state: 'merged', group: 'done',
  pr: null, question: null, blockedBy: null, assignee: '', author: '', approver: '',
}) as unknown as AgentRow;

const slices = ['p1', 'p2', 'p3', 'p4', 'p5'].map(mergedSlice);
const place = (selected: string[], active = [alpha, beta, theirs, ownerless], who = reader, sl: Slice[] = slices) => {
  const scope = deliveryScope(selected, who, active);
  const mapping = deliveryMapping({
    rows: sl.map((s) => mergedRow(s.plan)), slices: sl, agents: [], drafts: [], reader: who, mode: 'all',
    config: { autoReview: true, correctionBudget: 2 },
  });
  const v = placeMapping(mapping, sl, active as never[], scope as never);
  return { v, label: v.sections.find((s) => s.key === 'release-delivery')!.label };
};

describe('the Release delivery section under the My sprint scope', () => {
  it('names the owned sprint and lists only its plans', () => {
    const { v, label } = place(['alpha'], [alpha, theirs]);
    expect(label).toBe('Sprint delivery · Title alpha');
    expect(v.releaseBlocks).toHaveLength(1);
    expect(v.releaseBlocks[0]!.plans.map((p) => p.plan)).toEqual(['p1', 'p2']);
    expect(v.releaseBlocks[0]!.header).toBe('2 plans · 2 of 2 slices delivered · 0 blocked · 0 at a gate · 0 being built · 0 not started');
    expect(v.releaseBlocks[0]!.cards).toEqual([]);
  });

  it('groups two owned sprints, each with its name and counts, and lists a shared plan under both', () => {
    const { v, label } = place(['alpha', 'beta']);
    expect(label).toBe('Sprint delivery');
    expect(v.releaseBlocks.map((b) => [b.sprint, b.plans.map((p) => p.plan), b.header])).toEqual([
      ['alpha', ['p1', 'p2'], 'Title alpha · 2 plans · 2 of 2 slices delivered · 0 blocked · 0 at a gate · 0 being built · 0 not started'],
      ['beta', ['p2', 'p3'], 'Title beta · 2 plans · 2 of 2 slices delivered · 0 blocked · 0 at a gate · 0 being built · 0 not started'],
    ]);
    expect(v.releasePlanCount).toBe(3);
  });

  it('gives the header line the one sprint as its scope and links each non-zero count to a plan row', () => {
    const { v } = place(['alpha'], [alpha, theirs]);
    expect(v.releaseHeader.scope).toBe('alpha');
    expect(v.releaseHeader.title).toBe('2 plans · 2 of 2 slices delivered · 0 blocked · 0 at a gate · 0 being built · 0 not started');
    expect(v.releaseHeader.counts.map((c) => [c.key, c.count, c.anchor])).toEqual([
      ['plans', 2, 'delivery-plan-p1'],
      ['delivered', 2, 'delivery-plan-p1'],
      ['blocked', 0, null],
      ['at-a-gate', 0, null],
      ['being-built', 0, null],
      ['not-started', 0, null],
    ]);
  });

  it('gives the header line no scope and the totals, each plan once, over two sprints', () => {
    const { v } = place(['alpha', 'beta']);
    expect(v.releaseHeader.scope).toBe('');
    expect(v.releaseHeader.title).toBe('');
    expect(v.releaseHeader.counts.slice(0, 2).map((c) => c.count)).toEqual([3, 3]);
  });

  it('keeps a plan with an unread merge answer at progress not read', () => {
    const { v } = place(['alpha'], [alpha], reader, [unreadSlice('p1'), mergedSlice('p2')]);
    const p1 = v.releaseBlocks[0]!.plans.find((p) => p.plan === 'p1')!;
    expect(p1.stripText).not.toMatch(/^0 \//);
  });
});

describe('the Release delivery section under the release scope', () => {
  it('reads Release delivery with every plan and the toggle off', () => {
    const { v, label } = place([], [alpha, beta, theirs]);
    expect(label).toBe('Release delivery');
    expect(v.releaseBlocks[0]!.plans.map((p) => p.plan)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('reads Release delivery for a sprint with no Owner and for a reader with no host login', () => {
    expect(place(['nobody'], [ownerless]).label).toBe('Release delivery');
    expect(place(['nobody'], [ownerless], { hostUser: '', directory: reader.directory }).label).toBe('Release delivery');
  });

  it('reads Release delivery for a reader who owns none of the sprints', () => {
    const { v, label } = place(['theirs'], [theirs]);
    expect(label).toBe('Release delivery');
    expect(v.releaseBlocks[0]!.plans.map((p) => p.plan)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });
});
