import { describe, expect, it } from 'vitest';
import { decide, requestFrom } from '../../src/server/entry/transition.js';
import { isRefusal } from '@plot-pm/domain';

/**
 * The twelfth field, from the wire inward.
 *
 * `requestFrom` is the whole boundary: it refuses a line of the wrong width
 * rather than padding it, because a padded record field reads as *no record
 * written yet* and the transition would then overwrite a dated approval with
 * today's. So the width check is asserted as a refusal, not as a tolerance.
 */
const line = (over: Partial<Record<string, string>> = {}): string => {
  const f = {
    verb: 'approve',
    slug: 'a-plan',
    phase: 'Draft',
    review: 'in-session',
    approved: '',
    delivered: '',
    released: '',
    on: '2026-10-02',
    who: 'jwloka',
    channel: 'in-session',
    version: '',
    people: 'jwloka,eins78',
    ...over,
  };
  return [
    f.verb,
    f.slug,
    f.phase,
    f.review,
    f.approved,
    f.delivered,
    f.released,
    f.on,
    f.who,
    f.channel,
    f.version,
    f.people,
  ].join('\t');
};

describe('requestFrom reads a twelfth field', () => {
  it('refuses an eleven-field line rather than padding the missing column', () => {
    const eleven = line().split('\t').slice(0, 11).join('\t');
    expect(() => requestFrom(eleven)).toThrow(/expected 12 tab-separated fields, got 11/);
  });

  it('refuses a thirteen-field line too — the width is exact, not a floor', () => {
    expect(() => requestFrom(`${line()}\textra`)).toThrow(
      /expected 12 tab-separated fields, got 13/,
    );
  });

  it('splits the handles on commas', () => {
    expect(requestFrom(line()).people).toEqual(['jwloka', 'eins78']);
  });

  // `''` is a project that declares nobody, which is `[]` and not `['']` — a
  // list holding one empty handle would match an empty `who`.
  it('reads an empty people field as no declared handles', () => {
    expect(requestFrom(line({ people: '' })).people).toEqual([]);
  });

  it('tolerates a trailing newline, as every sender emits one', () => {
    expect(requestFrom(`${line()}\n`).people).toEqual(['jwloka', 'eins78']);
  });
});

describe('decide carries the handles to the rule', () => {
  it('approves an in-session plan whose reviewer the line declares', () => {
    const result = decide(requestFrom(line()));
    expect(isRefusal(result)).toBe(false);
    if (isRefusal(result)) return;
    expect(result.phase).toBe('approved');
    expect(result.record).toBe('2026-10-02, jwloka, in-session');
  });

  it('answers reviewer-undeclared for a handle the line never declared', () => {
    const result = decide(requestFrom(line({ who: 'someone-else' })));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('reviewer-undeclared');
  });

  it('answers review-human for an in-session line naming no reviewer', () => {
    const result = decide(requestFrom(line({ who: '' })));
    expect(isRefusal(result)).toBe(true);
    if (!isRefusal(result)) return;
    expect(result.reason).toBe('review-human');
  });

  // The column travels on every verb's line, and only `approve` reads it.
  it('ignores the handles on a deliver line', () => {
    const result = decide(
      requestFrom(line({ verb: 'deliver', phase: 'Approved', review: 'pr', people: '' })),
    );
    expect(isRefusal(result)).toBe(false);
    if (isRefusal(result)) return;
    expect(result.phase).toBe('delivered');
  });
});
