import { describe, it, expect } from 'vitest';
import { clearHolds } from '../src/rules/hold-clear.js';

describe('clearHolds', () => {
  it('removes an entry for each named branch, and no others', () => {
    const content = 'feature/alpha review pending\nfeature/beta review pending\nfeature/unrelated someone else is reviewing this\n';
    const { kept, removed } = clearHolds(content, ['feature/alpha', 'feature/beta']);
    expect(removed).toBe(2);
    expect(kept).toBe('feature/unrelated someone else is reviewing this\n');
  });

  it('matches the first field by exact string equality, never as a pattern', () => {
    const content = 'feature/alpha2 review pending\n';
    const { kept, removed } = clearHolds(content, ['feature/alpha']);
    expect(removed).toBe(0);
    expect(kept).toBe(content);
  });

  it('a missing file is not a failure', () => {
    const { kept, removed } = clearHolds(undefined, ['feature/alpha']);
    expect(kept).toBeUndefined();
    expect(removed).toBe(0);
  });

  it('an empty branch list removes nothing', () => {
    const content = 'feature/alpha review pending\n';
    const { kept, removed } = clearHolds(content, []);
    expect(removed).toBe(0);
    expect(kept).toBe(content);
  });

  it('removing every entry leaves an empty file, not a missing one', () => {
    const content = 'feature/alpha review pending\n';
    const { kept, removed } = clearHolds(content, ['feature/alpha']);
    expect(removed).toBe(1);
    expect(kept).toBe('');
  });

  it('preserves a file with no trailing newline', () => {
    const content = 'feature/alpha review pending\nfeature/unrelated still here';
    const { kept, removed } = clearHolds(content, ['feature/alpha']);
    expect(removed).toBe(1);
    expect(kept).toBe('feature/unrelated still here');
  });
});
