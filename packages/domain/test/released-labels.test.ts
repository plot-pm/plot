import { describe, expect, it } from 'vitest';
import { releasedLabelTargets } from '../src/rules/released-labels.js';

describe('releasedLabelTargets', () => {
  it('partitions the fixture with named skip reasons', () => {
    const plans = [
      { phase: 'released', issues: [1, 2, 3, 4, 333] },
      { phase: 'approved', issues: [3] },
      { phase: 'rejected', issues: [333] },
    ];
    const issues = [
      { id: '1', status: 'closed', labels: [] },
      { id: '2', status: 'closed', labels: ['plan:released'] },
      { id: '3', status: 'closed', labels: [] },
      { id: '4', status: 'open', labels: [] },
      { id: '333', status: 'closed', labels: ['plan:approved'] },
    ];
    expect(releasedLabelTargets(plans, issues)).toEqual({
      write: ['1', '333'],
      skip: [
        { issue: '2', reason: 'already-labelled' },
        { issue: '3', reason: 'live-plan' },
        { issue: '4', reason: 'open' },
      ],
    });
  });

  it('skips an issue the read returned no row for', () => {
    expect(releasedLabelTargets([{ phase: 'released', issues: ['9'] }], []).skip).toEqual([
      { issue: '9', reason: 'unread' },
    ]);
  });
});
