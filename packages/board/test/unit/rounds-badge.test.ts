import { describe, it, expect } from 'vitest';
import { roundsBadgeText } from '../../src/app/components/PlanCard.js';
import { AgentRowSchema, CardSchema, type Card } from '../../src/contract/schema.js';

// What a card SAYS about how hard its plan has been questioned. The interesting
// cases are the ones where the honest answer is nothing at all — an absent
// count and a settled plan both render no badge, for different reasons.

const card = (over: Partial<Card> = {}): Card => ({
  slug: 'x', title: 'X', type: 'feature', phase: 'Discovery',
  path: 'docs/plans/2026-08-17-x.md', prs: [], phaseDate: '', ...over,
});

describe('roundsBadgeText', () => {
  it('shows the round on a Draft card', () => {
    expect(roundsBadgeText(card({ rounds: 2 }))).toBe('2 rounds');
  });

  it('says nothing at all when no interrogation is recorded', () => {
    // ABSENT, not zero. "0 rounds" would read as interrogated-and-found-nothing;
    // the truth is that nobody has looked, and those want opposite reactions
    // from a reader. The badge must not appear — not appear saying zero.
    expect(roundsBadgeText(card())).toBe('');
    expect(roundsBadgeText(card({ rounds: undefined }))).toBe('');
  });

  it('renders a RECORDED zero, which is a different statement', () => {
    // The block exists, so the plan has been through the skill. Saying so is
    // true, and it is not what an absent count says.
    expect(roundsBadgeText(card({ rounds: 0 }))).toBe('0 rounds');
  });

  it('appears only on Draft cards', () => {
    // Past Discovery the count is history: the design question it answers was
    // settled by approval, and a number nobody acts on is the crowding this
    // board keeps removing.
    for (const phase of ['Design', 'Development', 'Testing', 'Released'] as const) {
      expect(roundsBadgeText(card({ phase, rounds: 3 }))).toBe('');
    }
    // …and every Draft card with a count does carry it.
    expect(roundsBadgeText(card({ phase: 'Discovery', rounds: 3 }))).toBe('3 rounds');
  });

  it('says "1 round", not "1 rounds"', () => {
    expect(roundsBadgeText(card({ rounds: 1 }))).toBe('1 round');
  });
});

describe('the agent row does NOT gain the count', () => {
  it('is not part of the row contract', () => {
    // The pairing that matters: most rows name a plan whose design phase closed
    // long ago, so putting a design-time count on the row would attach it to
    // every one of them. This is a card-only badge, the same split sliceSummary
    // already follows.
    expect('rounds' in AgentRowSchema.shape).toBe(false);
    expect('rounds' in CardSchema.shape).toBe(true);
  });

  it('drops a rounds field if one is ever sent on a row', () => {
    // Zod strips unknown keys, so a row can never start carrying this by
    // accident from a widened server payload.
    const parsed = AgentRowSchema.parse({
      repo: 'plot', branch: 'feature/x', plan: 'a-plan', wave: 'w',
      state: 'wip', group: 'quiet', ageMinutes: 10, note: '',
      rounds: 4,
    });
    expect((parsed as Record<string, unknown>).rounds).toBeUndefined();
  });
});
