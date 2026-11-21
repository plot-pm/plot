import { describe, expect, it } from 'vitest';

import { DEFAULT_PREDICTED_HOST_LIMIT, declaredHostLimit } from '../src/rules/declared-host-limit.js';

describe('declaredHostLimit', () => {
  it('reads a positive whole number as the hourly limit', () => {
    expect(declaredHostLimit('2000')).toBe(2000);
  });

  it('answers 800 where the key is unset', () => {
    expect(declaredHostLimit('')).toBe(DEFAULT_PREDICTED_HOST_LIMIT);
    expect(DEFAULT_PREDICTED_HOST_LIMIT).toBe(800);
  });

  it.each(['0', '010', '-5', '10,000', '10000/h', ' 10000', '1e4', 'many'])('answers 800 for %j', (value) => {
    expect(declaredHostLimit(value)).toBe(800);
  });
});
