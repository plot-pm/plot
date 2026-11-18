// The sprint card's plan key comes out of a slice item's id, not out of a payload field.
import { describe, it, expect } from 'vitest';
import { parsePersonDirectory } from '@plot-pm/domain';
import type { AgentRow, DraftPlan, Slice } from '../../src/contract/schema.js';
import { countedSlicesByPlan, sliceItemId, sprintCardViewOf, type DeliveryMapInput } from '../../src/app/lib/agent-rows/delivery-readings.js';

describe('countedSlicesByPlan', () => {
  it('groups slice items by the plan before the NUL and reads delivered as merged', () => {
    const items = [
      { id: sliceItemId('plan-a', 'One'), kind: 'slice' as const, ownership: 'mine' as const, delivered: true },
      { id: sliceItemId('plan-a', 'Two'), kind: 'slice' as const, ownership: 'mine' as const },
      { id: 'branch:x', kind: 'branch' as const, ownership: 'mine' as const },
    ];
    const by = countedSlicesByPlan(items);
    expect([...by.keys()]).toEqual(['plan-a']);
    expect(by.get('plan-a')!.map((s) => s.merge)).toEqual(['merged', 'open']);
  });
  it('gives a Draft plan and a plan with only branch rows an empty entry', () => {
    const by = countedSlicesByPlan(
      [{ id: 'plan:draft-p', kind: 'plan' as const, ownership: 'mine' as const }],
      {
        rows: [{ plan: 'branch-only' }, { plan: '' }] as never,
        drafts: [{ plan: 'draft-p' }] as never,
      },
    );
    expect(by.get('draft-p')).toEqual([]);
    expect(by.get('branch-only')).toEqual([]);
    expect(by.has('')).toBe(false);
  });
  it('has no entry for a plan with no slice item', () => {
    expect(countedSlicesByPlan([]).get('plan-z')).toBeUndefined();
  });
});

describe('sprintCardViewOf', () => {
  const reader = { hostUser: 'jwloka', directory: parsePersonDirectory('jwloka = Jan Wloka') };
  const row = (plan: string, wave: string, branch: string): AgentRow => ({
    branch, plan, wave, kind: 'branch', phase: 'Testing', state: 'merged', group: 'done', pr: null,
    question: null, blockedBy: null, assignee: '', author: '', approver: '',
  }) as unknown as AgentRow;
  const slice = (plan: string, name: string): Slice => ({
    plan, name, branches: [], verdict: 'complete', section: 'done', complete: true, planSliceCount: 1,
  }) as unknown as Slice;
  const draft = (plan: string): DraftPlan => ({ plan, planFile: `${plan}.md`, title: '', issues: [], assignee: '', author: '', approver: '' }) as unknown as DraftPlan;
  const input = (over: Partial<DeliveryMapInput>): DeliveryMapInput => ({
    rows: [], slices: [], agents: [], drafts: [], reader, mode: 'all', config: { autoReview: true, correctionBudget: 2 }, ...over,
  });
  const sprint = (slug: string, members: { slug: string; tier: 'must' | 'should' }[]) => ({
    slug, title: slug, release: '', end: '', ownerHandle: 'jwloka', members: members.map((m) => ({ ...m, checked: false, known: true })),
  });

  it('reads a sprint with a Draft Must among delivered plans: the bar and the tiers stay present', () => {
    const view = sprintCardViewOf(
      [sprint('s1', [{ slug: 'a', tier: 'must' }, { slug: 'b', tier: 'must' }, { slug: 'd', tier: 'must' }])],
      reader,
      input({
        rows: [row('a', 'One', 'feature/a'), row('b', 'One', 'feature/b')],
        slices: [slice('a', 'One'), slice('b', 'One')],
        drafts: [draft('d')],
      }),
    );
    const card = view.cards[0]!;
    expect(card.readingMissing).toBe(false);
    expect(card.bar).not.toBeNull();
    expect(card.tierLine).toBe('Must 2/3');
  });

  it('reads every owned sprint from the rows given, whatever the Mine mode', () => {
    const view = sprintCardViewOf(
      [sprint('s1', [{ slug: 'a', tier: 'must' }]), sprint('s2', [{ slug: 'b', tier: 'must' }])],
      reader,
      input({
        rows: [row('a', 'One', 'feature/a'), row('b', 'One', 'feature/b')],
        slices: [slice('a', 'One'), slice('b', 'One')],
        mode: 'mine',
      }),
    );
    expect(view.cards.map((c) => [c.readingMissing, c.tierLine])).toEqual([[false, 'Must 1/1'], [false, 'Must 1/1']]);
  });
});
