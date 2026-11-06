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
