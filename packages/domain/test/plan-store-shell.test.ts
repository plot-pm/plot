import { describe, it, expect } from 'vitest';
import { branchOf } from '../src/adapters/plan-store/plan-store-shell.js';

/**
 * `branchOf` renames one branch line from `plot-plan-meta.sh`'s wire shape into
 * the port's. `waits_on` is the field under test: the parser emits it only on a
 * branch line carrying a `<!-- waits: ... -->` annotation
 * (`plot-plan-meta.sh:677-688`), so a declared-none branch's line carries no key
 * at all rather than an empty string.
 */
describe('branchOf — waits_on maps to waitsOn', () => {
  it('carries the list as-is, in order, when the line declares several prerequisites', () => {
    expect(branchOf({ branch: 'feature/two', waits_on: ['bug/a', 'bug/b'] }).waitsOn).toEqual([
      'bug/a',
      'bug/b',
    ]);
  });

  it('wraps a legacy bare string from an older parser into a one-item list', () => {
    expect(branchOf({ branch: 'feature/two', waits_on: 'feature/one' }).waitsOn).toEqual([
      'feature/one',
    ]);
  });

  it('defaults to the empty list for a branch line that declares none', () => {
    expect(branchOf({ branch: 'feature/two' }).waitsOn).toEqual([]);
  });
});
