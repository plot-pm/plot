import { describe, it, expect } from 'vitest';
import { agentPr, type PrRecord } from '../../src/server/fleet.js';
import { AgentRowSchema } from '../../src/contract/schema.js';

/**
 * A section row's PR says whose it is, the way a card's PR does.
 *
 * WAITING ON YOU holds branch and slice rows, not cards. A row whose PR object
 * dropped the author would answer `unknown` for every PR in that section.
 */

const record = (over: Partial<PrRecord> = {}): PrRecord => ({
  number: 7, head: 'feature/x', state: 'OPEN', draft: false, checks: 'green',
  mergeable: 'mergeable', review: '', url: 'https://example.invalid/pull/7', failing_checks: [],
  ...over,
});

describe('a row\'s PR carries its author', () => {
  it('carries the host\'s author', () => {
    expect(agentPr(record({ author: 'jwloka' })).author).toBe('jwloka');
  });

  it('carries \'\' where the record holds none', () => {
    expect(agentPr(record()).author).toBe('');
  });

  it('parses an older row with no author as \'\'', () => {
    const pr = AgentRowSchema.shape.pr.parse({ number: 7 });
    expect(pr?.author).toBe('');
  });
});
