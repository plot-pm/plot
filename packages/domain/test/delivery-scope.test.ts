import { describe, it, expect } from 'vitest';
import { deliveryScope, MY_SPRINT_DISABLED, parsePersonDirectory, type Reader } from '../src/index.js';

const directory = parsePersonDirectory('jwloka = Jan Wloka; eins78 = Max Albrecht');
const jan: Reader = { hostUser: 'jwloka', directory };
const alpha = { slug: 'alpha', ownerHandle: 'jwloka' };
const beta = { slug: 'beta', ownerHandle: 'eins78' };
const ownerless = { slug: 'gamma', ownerHandle: '' };
const active = [alpha, beta, ownerless];

describe('deliveryScope', () => {
  it('scopes a toggle that is on to the owned sprint and shows the sprint card', () => {
    const s = deliveryScope(['alpha'], jan, [alpha, beta]);
    expect(s.kind).toBe('my-sprint');
    expect(s.sprints.map((x) => x.slug)).toEqual(['alpha']);
    expect(s.selection).toEqual(['alpha']);
    expect(s.statusCard).toBe('sprint');
    expect(s.disabledReason).toBeNull();
  });

  it('keeps every Active sprint for a toggle that is off and shows the release cards', () => {
    const s = deliveryScope([], jan, active);
    expect(s.kind).toBe('release');
    expect(s.sprints).toEqual(active);
    expect(s.owned).toEqual([alpha]);
    expect(s.selection).toEqual([]);
    expect(s.statusCard).toBe('release');
    expect(s.disabledReason).toBeNull();
  });

  it('puts a sprint with no Owner in the release scope and in no my-sprint scope', () => {
    expect(deliveryScope([], jan, active).sprints).toContain(ownerless);
    const on = deliveryScope(['alpha', 'gamma'], jan, active);
    expect(on.sprints).not.toContain(ownerless);
    expect(on.selection).toEqual(['alpha']);
    expect(deliveryScope(['gamma'], { directory }, active).owned).toEqual([]);
  });

  it('reads a selected slug the reader does not own as the release scope', () => {
    const s = deliveryScope(['beta'], jan, active);
    expect(s.kind).toBe('release');
    expect(s.selection).toEqual([]);
    expect(s.statusCard).toBe('release');
  });

  it.each([
    ['no host login', { directory } as Reader, active],
    ['a login that resolves to no Owner', { hostUser: 'nobody', directory } as Reader, active],
    ['zero Active sprints', jan, []],
  ])('disables the toggle for %s', (_name, reader, sprints) => {
    const s = deliveryScope(['alpha'], reader, sprints);
    expect(s.disabledReason).toBe(MY_SPRINT_DISABLED);
    expect(s.disabledReason).toBe('You own no active sprint');
    expect(s.kind).toBe('release');
  });
});
