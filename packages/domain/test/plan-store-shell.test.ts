import { describe, it, expect } from 'vitest';
import { branchOf } from '../src/adapters/plan-store/plan-store-shell.js';

/**
 * `branchOf` renames one branch line from `plot-plan-meta.sh`'s wire shape into
 * the port's. `waits_on` is the field under test: the parser emits it only on a
 * branch line carrying a `<!-- waits: ... -->` annotation
 * (`plot-plan-meta.sh:619-623`), so a declared-none branch's line carries no key
 * at all rather than an empty string.
 */
describe('branchOf — waits_on maps to waitsOn', () => {
  it('carries the prerequisite when the line declares one', () => {
    expect(branchOf({ branch: 'feature/two', waits_on: 'feature/one' }).waitsOn).toBe(
      'feature/one',
    );
  });

  it('defaults to the empty string for a branch line that declares none', () => {
    expect(branchOf({ branch: 'feature/two' }).waitsOn).toBe('');
  });
});
