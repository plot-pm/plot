import { describe, expect, it } from 'vitest';

import { supervisorMigrates } from '../src/rules/supervisor-migration.js';

describe('supervisorMigrates', () => {
  it('migrates when the served path equals the repository root', () => {
    expect(supervisorMigrates({ servedPath: '/home/dev/plot', repoRoot: '/home/dev/plot' })).toBe(
      true,
    );
  });

  it('never migrates a unit serving another checkout', () => {
    expect(
      supervisorMigrates({ servedPath: '/home/dev/other', repoRoot: '/home/dev/plot' }),
    ).toBe(false);
  });

  // An empty served path reads as "no working directory", which is
  // indistinguishable from another checkout at this rule's input — not a
  // licence to migrate just because the comparison trivially "matches".
  it('never migrates an empty served path, even against an empty repo root', () => {
    expect(supervisorMigrates({ servedPath: '', repoRoot: '' })).toBe(false);
    expect(supervisorMigrates({ servedPath: '', repoRoot: '/home/dev/plot' })).toBe(false);
  });
});
