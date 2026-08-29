import { describe, it, expect } from 'vitest';
import {
  SprintStateSchema, MoscowTierSchema, ItemStatusSchema,
  scoreItem, isPromised, sprintMembers, type Sprint, type SprintItem,
} from '../src/index.js';

/**
 * A timebox committing to a set of plans against a release.
 *
 * Sprint is the only entity with a DOUBLE link to Plan — plans declare their
 * sprint and the sprint file lists them — and that double record is what makes
 * `disputed` expressible: the checkbox says *we said we would*, the plan's
 * state says *we did*.
 */

const item = (over: Partial<SprintItem> = {}): SprintItem => ({
  tier: 'must', checked: false, plan: 'a-plan', text: 'do the thing', annotation: '', ...over,
});

const sprint: Sprint = {
  slug: '2026-W35-the-board-serves-an-enterprise-stack',
  title: 'The board serves an enterprise stack',
  state: 'Active', start: '2026-08-25', plannedEnd: '2026-08-31', actualEnd: null,
  release: 'v2.9.0', goal: 'the board tells the truth', items: [],
};

describe('the sprint vocabularies are closed sets', () => {
  it('names four states, four tiers and three item statuses', () => {
    expect(SprintStateSchema.options).toEqual(['Planning', 'Committed', 'Active', 'Closed']);
    expect(MoscowTierSchema.options).toEqual(['must', 'should', 'could', 'deferred']);
    expect(ItemStatusSchema.options).toEqual(['done', 'open', 'disputed']);
  });
});

describe('only a Must is a promise', () => {
  it('promises a Must and not the rest', () => {
    // The release gate refuses on an open Must, prompts on an open Should, and
    // reports a Could without blocking. A timebox with one priority level is a
    // queue with a date on it.
    expect(isPromised(item())).toBe(true);
    for (const tier of ['should', 'could', 'deferred'] as const) {
      expect(isPromised(item({ tier }))).toBe(false);
    }
  });
});

describe('the plan estate outranks the checkbox, in one direction only', () => {
  it('scores an unchecked box over a delivered plan as done', () => {
    // Delivering a plan moves it and nobody re-ticks the box, so the estate
    // wins here.
    expect(scoreItem(item({ checked: false }), true)).toBe('done');
  });

  it('scores a checked box over an undelivered plan as disputed', () => {
    // The other direction does NOT resolve to done: the file claims work that
    // the estate cannot confirm, and that disagreement is the finding.
    expect(scoreItem(item({ checked: true }), false)).toBe('disputed');
  });

  it('scores an unchecked box over an undelivered plan as open', () => {
    expect(scoreItem(item({ checked: false }), false)).toBe('open');
  });

  it('scores a checked box over a delivered plan as done', () => {
    expect(scoreItem(item({ checked: true }), true)).toBe('done');
  });
});

describe('a sprint’s membership is its distinct plans', () => {
  it('counts a plan once however many slices name it', () => {
    // 22 item lines, 19 distinct members: a plan cut into slices is listed once
    // per slice, so counting lines overstates the membership.
    const waved: Sprint = {
      ...sprint,
      items: [item({ plan: 'a-plan' }), item({ plan: 'a-plan' }), item({ plan: 'b-plan' })],
    };
    expect(sprintMembers(waved)).toEqual(['a-plan', 'b-plan']);
  });

  it('excludes the items that name no plan', () => {
    // Measured across four sprint files, 81 items: 72 name a plan, 6 are a
    // malformed line that still names one, and 3 are genuinely not plans —
    // housekeeping, a decision, and a plan not yet written.
    const mixed: Sprint = { ...sprint, items: [item({ plan: 'a-plan' }), item({ plan: '' })] };
    expect(sprintMembers(mixed)).toEqual(['a-plan']);
  });

  it('reports no members for a sprint with no items', () => {
    expect(sprintMembers(sprint)).toEqual([]);
  });
});

describe('an end date carries one fact each', () => {
  it('keeps a planned end apart from an actual one', () => {
    // One sprint reads `End: 2026-08-26 (closed 2026-08-23)` — an author
    // needing to record actual against planned had nowhere to put it, so it
    // went into the date as prose. A field that must hold two facts eventually
    // holds one of them as a comment.
    const closed: Sprint = { ...sprint, state: 'Closed', plannedEnd: '2026-08-26', actualEnd: '2026-08-23' };
    expect(closed.plannedEnd).toBe('2026-08-26');
    expect(closed.actualEnd).toBe('2026-08-23');
    expect(sprint.actualEnd).toBeNull();
  });
});
