import { describe, expect, it } from 'vitest';
import { planFactsOf } from '../../src/server/plan-facts.js';
import type { Card } from '../../src/contract/schema.js';

describe('a card built from its summary never reads unmeasured progress as zero', () => {
  const summarised = (sliceSummary: Card['sliceSummary']) => planFactsOf({
    slug: 'p', title: 'P', type: 'feature', phase: 'Development', path: 'docs/plans/2026-11-06-p.md',
    prs: [], issues: [], phaseDate: '', controls: { approve: false, needsDesign: false, interrogate: false, roundsBadge: false, dispatch: true, readyToStart: true, approveSpike: false, confirmSlices: false, spikeState: null },
    sliceSummary,
  });

  it('a scanned summary reads its complete count as unasked, and still offers Start work', () => {
    const facts = summarised({ slices: 2, branches: 2, claimed: 0, eligible: 1, deferred: 0 });
    expect(facts.progress?.work).toEqual({ unit: 'slices', done: { unknown: 'unasked' }, total: 2 });
    expect(facts.next.primary?.enabled).toBe(true);
  });

});

describe('a story or sprint list that could not be read', () => {
  const fields = (over: Partial<Card> = {}) => ({
    slug: 'p', title: 'P', type: 'feature', phase: 'Development', path: 'docs/plans/2026-11-06-p.md',
    prs: [], issues: [], phaseDate: '',
    controls: { approve: false, needsDesign: false, interrogate: false, roundsBadge: false, dispatch: false, readyToStart: false, approveSpike: false, confirmSlices: false, spikeState: null },
    story: 's', sprint: 'sp', ...over,
  });

  it('reads as unknown, never as a story or sprint with no file', () => {
    const facts = planFactsOf(fields(), { stories: null, sprints: null });
    expect(facts.lineage.stories).toEqual({ unknown: 'failed' });
    expect(facts.lineage.sprints).toEqual({ unknown: 'failed' });
  });

  it('an absent list still reads as read and holding no file for the name', () => {
    const facts = planFactsOf(fields());
    expect(facts.lineage.stories).toEqual({ value: [{ kind: 'story', slug: 's', title: 's', status: null, archived: false }] });
  });
});
