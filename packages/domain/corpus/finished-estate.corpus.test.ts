import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readFleetScan, type Estate } from './production.js';
import { sandboxWith, type SandboxPlan } from './sandbox.js';

/**
 * THE FINISHED ESTATE, BUILT RATHER THAN WAITED FOR.
 *
 * Every other file in this tier reads the repository it runs in, which is the
 * point of a corpus: the shell and the domain are compared over real data
 * nobody shaped for the test. The cost is that WHICH CASES EXIST is decided by
 * whatever the estate happens to hold that day.
 *
 * Measured 2026-09-08: `the-board-serves-a-team` delivered all 19 of its plans,
 * so no plan was non-terminal, the scan reported `plans: []`, and SIX vacuity
 * floors failed at once on the release PR's own CI — `expected 0 to be greater
 * than 0`. A sprint finishing is the success case, and the guards read it as
 * the scan being broken.
 *
 * The estate could not be asked to reproduce that: an estate with a backlog
 * cannot demonstrate what happens when the backlog empties, and one without a
 * backlog is a state the project passes through rather than sits in. So this
 * builds the shape instead — two sandboxes, one finished and one not — and
 * pins what the scan answers for each.
 *
 * IT COMPARES THE SCAN AGAINST ITSELF, not against the domain, which is why it
 * belongs beside the comparisons rather than inside one. The claim is about the
 * INPUT the other files assume: that an empty pulse means a finished estate and
 * not a broken scan.
 */

const dirs: string[] = [];
const build = (plans: ReadonlyArray<SandboxPlan>): Estate => {
  const sandbox = sandboxWith(plans, 'plot-finished-');
  dirs.push(sandbox.dir);
  return sandbox;
};

let finished: Record<string, unknown>;
let working: Record<string, unknown>;

beforeAll(() => {
  finished = readFleetScan(build([['a-done-thing', 'Released', 'feature/done']]));
  working = readFleetScan(build([
    ['a-done-thing', 'Released', 'feature/done'],
    ['a-live-thing', 'Approved', 'feature/live'],
  ]));
}, 120_000);

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('a finished estate is a reading, not a broken scan', () => {
  it('reports no plans when every plan is terminal', () => {
    // THE SHAPE THAT FAILED CI. `plans` carries every plan not yet released — a
    // Delivered plan stays until /plot-release records it — so an estate whose
    // work is all released reports an empty one, and the summary counts agree
    // rather than disagreeing with it.
    expect(finished.plans).toEqual([]);
    const summary = finished.summary as Record<string, number>;
    expect(summary.plans).toBe(0);
    expect(summary.branches).toBe(0);
    expect(summary.waves).toBe(0);
  });

  it('reports the backlog as soon as one plan is live', () => {
    // THE CONTROL, and it is what makes the emptiness above a measurement. The
    // two estates differ by one Approved plan; if the empty answer came from a
    // scan that could not read the sandbox at all, this would be empty too.
    const summary = working.summary as Record<string, number>;
    expect((working.plans as unknown[]).length).toBe(1);
    expect(summary.branches).toBe(1);
    expect(summary.eligible).toBe(1);
  });

  it('reports the same shape either way, so a reader need not special-case it', () => {
    // AN EMPTY PULSE IS WELL-FORMED. The floors elsewhere in this tier exist
    // because a comparison over nothing passes vacuously — but they must fail
    // on a BROKEN scan, never on a finished one, and telling those apart needs
    // the empty answer to still carry every field.
    for (const pulse of [finished, working]) {
      expect(Array.isArray(pulse.plans)).toBe(true);
      expect(pulse.main).toBe('main');
      expect(pulse.fetch_failed).toBe(false);
      const summary = pulse.summary as Record<string, unknown>;
      for (const key of ['plans', 'waves', 'branches', 'claimed', 'eligible', 'blocked']) {
        expect(typeof summary[key]).toBe('number');
      }
    }
  });
});
