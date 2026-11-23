import { describe, expect, it } from 'vitest';

import { pushSelectionBase } from '../src/rules/push-selection-base.js';

const sha = (n: number): string => n.toString(16).padStart(40, '0');
const line = (count: number): string[] => Array.from({ length: count }, (_, i) => sha(i + 1));

describe('pushSelectionBase', () => {
  it('answers a green head among the 50 as the base', () => {
    const firstParent = line(50);
    expect(pushSelectionBase({ greenHead: firstParent[7], firstParent })).toEqual({ base: firstParent[7] });
    expect(pushSelectionBase({ greenHead: firstParent[49], firstParent })).toEqual({ base: firstParent[49] });
  });

  it('answers a green head equal to HEAD as the base HEAD', () => {
    const firstParent = line(50);
    expect(pushSelectionBase({ greenHead: firstParent[0], firstParent })).toEqual({ base: firstParent[0] });
  });

  it('answers a failed call as api-failed', () => {
    expect(pushSelectionBase({ greenHead: null, firstParent: line(50) })).toEqual({ every: 'api-failed' });
  });

  it('answers no green run as no-green-run', () => {
    expect(pushSelectionBase({ greenHead: '', firstParent: line(50) })).toEqual({ every: 'no-green-run' });
  });

  it('answers a green head absent from the line as not-on-line', () => {
    expect(pushSelectionBase({ greenHead: sha(999), firstParent: line(10) })).toEqual({ every: 'not-on-line' });
  });

  it('answers a green head past a 50-entry line as not-on-line', () => {
    expect(pushSelectionBase({ greenHead: sha(51), firstParent: line(50) })).toEqual({ every: 'not-on-line' });
  });

  it('reads only the first 50 entries of a longer line', () => {
    expect(pushSelectionBase({ greenHead: sha(51), firstParent: line(51) })).toEqual({ every: 'not-on-line' });
  });

  it('matches by equality, never by prefix', () => {
    const firstParent = line(5);
    expect(pushSelectionBase({ greenHead: firstParent[2].slice(0, 12), firstParent })).toEqual({ every: 'not-on-line' });
  });
});
