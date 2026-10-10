import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { branchOf, planStoreShell } from '../src/adapters/plan-store/plan-store-shell.js';
import { shellContext } from '../src/adapters/scripts.js';
import { isAnswered } from '../src/port-result.js';

const REPO_ROOT = new URL('../../..', import.meta.url).pathname;

describe('planStoreShell — deferred_prs maps to deferredPrs', () => {
  it('carries the PR a deferred slice names, and keeps it in prs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-deferred-prs-'));
    try {
      const file = join(dir, '2026-10-09-deferred.md');
      writeFileSync(
        file,
        [
          '# Deferred',
          '',
          '## Status',
          '',
          '- **State:** Delivered',
          '',
          '## Slices',
          '',
          '### Shipped',
          '',
          '- `feature/alpha` — the work → #1423',
          '',
          '### Given up',
          '',
          '- `feature/beta` — not built <!-- deferred: closed on purpose --> → #1425',
          '',
        ].join('\n'),
      );
      const plan = await planStoreShell(shellContext(REPO_ROOT)).readPlan(file);
      if (!isAnswered(plan)) throw new Error('the adapter could not read the plan');
      expect(plan.value.prs).toEqual([1423, 1425]);
      expect(plan.value.deferredPrs).toEqual([1425]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

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
