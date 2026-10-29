import { describe, expect, it } from 'vitest';

import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext } from '../src/adapters/scripts.js';
import { isAnswered } from '../src/port-result.js';
import { describingAs, type Disagreement, type Sides } from './compare.js';
import { readRemoteRefs, type Estate } from './production.js';

/**
 * A DECLARED DUPLICATE: `readBitbucketListing` (`packages/fleet/src/shared/
 * fleet-scan.ts`) asks `Refs.listBranches(true)` for the branches a Bitbucket
 * sweep asks the host about — the same question `plot-fleet-scan.sh`'s
 * `TRACKED_BRANCHES` has always answered for the shell's own sweep
 * (`skills/plot/scripts/plot-fleet-scan.sh:786`). `docs/shell-and-domain.md`
 * sanctions the duplication and requires exactly this: a test that fails
 * loudly on disagreement, with neither side authoritative.
 *
 * ON A DISAGREEMENT THE BRANCH STOPS. Adjusting either side to make the
 * comparison pass is the one move this tier forbids.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

describe('Refs.listBranches(true) agrees with TRACKED_BRANCHES', () => {
  it('names the same branch set the shell\'s sweep would ask about', async () => {
    // Both reads are taken back to back, against the same `ROOT` — a branch
    // created or deleted between them would show up as a one-sided name, which
    // the comparison below reports rather than hides.
    const refs = refsGit(shellContext(ROOT));
    const adapterRead = await refs.listBranches(true);
    if (!isAnswered(adapterRead)) {
      throw new Error(`the adapter could not list remote branches: ${adapterRead.why}`);
    }
    const adapterBranches = new Set(adapterRead.value);

    // `TRACKED_BRANCHES` is `REMOTE_REFS` (the same `for-each-ref` production
    // reads via `readRemoteRefs`) with `HEAD` and blank lines dropped — see
    // `plot-fleet-scan.sh:786`. `readRemoteRefs` does not filter `HEAD` itself,
    // because other callers key it by oid; this test applies the shell's own
    // filter rather than widen `readRemoteRefs` for one caller.
    const shellBranches = new Set(
      [...readRemoteRefs(estate).keys()].filter((name) => name !== 'HEAD' && name !== ''),
    );

    const found: Disagreement[] = [];
    const union = new Set([...adapterBranches, ...shellBranches]);
    for (const branch of union) {
      const inAdapter = adapterBranches.has(branch);
      const inShell = shellBranches.has(branch);
      if (inAdapter !== inShell) {
        found.push({
          subject: branch,
          field: 'tracked',
          adapter: JSON.stringify(inAdapter),
          production: JSON.stringify(inShell),
        });
      }
    }
    expect(found.map(report)).toEqual([]);
  });

  it('reads a set worth comparing, so agreement is not vacuous', () => {
    // A FLOOR, for the reason every corpus tier states one: a universal claim
    // over an empty set is true regardless of whether either side works.
    const shellBranches = [...readRemoteRefs(estate).keys()].filter(
      (name) => name !== 'HEAD' && name !== '',
    );
    expect(shellBranches.length).toBeGreaterThan(0);
  });

  it('never carries HEAD, which both sides filter deliberately', async () => {
    const refs = refsGit(shellContext(ROOT));
    const adapterRead = await refs.listBranches(true);
    if (!isAnswered(adapterRead)) {
      throw new Error(`the adapter could not list remote branches: ${adapterRead.why}`);
    }
    expect(adapterRead.value).not.toContain('HEAD');
  });
});
