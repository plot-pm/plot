import { describe, expect, it } from 'vitest';

import { GENERATION_MS, rotationDue } from '../src/rules/budget-rotation.js';
import { FALLBACK_WINDOW_MS } from '../src/rules/budget-record.js';

const line = (at: string): string => `b1\tgithub\tsomeone\tgraphql\t${at}\t1\t5000\t4999\t-\tactual`;

describe('rotationDue', () => {
  it('is due once the first line is one generation old', () => {
    expect(rotationDue(line('1000'), 1000 + GENERATION_MS)).toBe(true);
    expect(rotationDue(line('1000'), 1000 + GENERATION_MS + 1)).toBe(true);
  });

  it('is not due inside the generation', () => {
    expect(rotationDue(line('1000'), 1000 + GENERATION_MS - 1)).toBe(false);
  });

  it('is never due for a missing generation, a short line or a non-numeric timestamp', () => {
    expect(rotationDue(null, Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(rotationDue('b1\tgithub', Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(rotationDue(line('12x'), Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(rotationDue(line('-5'), Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('keeps a generation longer than every spend window', () => {
    expect(GENERATION_MS).toBe(86_400_000);
    expect(GENERATION_MS).toBeGreaterThan(FALLBACK_WINDOW_MS);
  });
});
