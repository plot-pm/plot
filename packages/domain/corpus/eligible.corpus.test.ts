import { beforeAll, describe, expect, it } from 'vitest';

import { FleetReadingSchema, type FleetReading } from '../src/entities/fleet.js';
import { isClaimable, sliceVerdicts } from '../src/rules/eligible.js';
import { describeDisagreement, type Disagreement } from './compare.js';
import { readFleetScan, readListEligible, type Estate } from './production.js';

/**
 * THE CORPUS TIER FOR ELIGIBILITY: do `--next` and the board agree about every
 * slice in `docs/plans/`?
 *
 * **The estate, not a fixture.** This repository holds ~180 plans with multi-
 * branch slices, deferred branches, cross-repo PR annotations and files with no
 * `Phase:` at all. A fixture covers what someone thought of; the estate covers
 * what is there. Every case below was found by running this, not by inventing
 * it.
 *
 * ## What is compared against what
 *
 * `plot-fleet-scan.sh` now takes its verdicts from `sliceVerdicts` — so a test
 * that re-ran the same rule over the same readings would be comparing a
 * function with itself. The comparison that means something is between the two
 * SURFACES that act on the answer:
 *
 * | | reads | acts by |
 * |---|---|---|
 * | **the board** | the pulse's `verdict` per slice | rendering a row as startable |
 * | **`--next`** | `--list-eligible`'s branch list | pushing a claim ref |
 *
 * They are computed in one process from one rule, and that is the property
 * under test rather than an excuse not to test it: the pulse and the branch
 * list are two separate emissions, one per-slice and one flat, and nothing but
 * this stops them drifting the way they did before the rule was shared.
 *
 * The rule is also re-derived here from the pulse's own branch states, which is
 * the third leg: it proves the verdict the board renders follows from the
 * readings the board is shown, rather than from something the scan knew and did
 * not report.
 *
 * ## And it counts what it compared
 *
 * *N slices compared, N equal.* A comparison that silently skips an unparseable
 * plan passes vacuously — the defect this repository has now found four times —
 * so the count is asserted against the pulse's own `summary.waves` and against a
 * floor, and a zero-slice run fails.
 *
 * ## On a disagreement: stop, do not adjust
 *
 * Which side is wrong is judgement, exactly as the plan-store tier says. Every
 * failure prints the slice, the field and both readings.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

/**
 * The phases whose plans `--next` never offers, so the two surfaces are
 * compared over the population both can see.
 *
 * `--next`'s question is *what may a worker claim*, and a finished plan answers
 * nothing to it: even an `open` branch under one is work somebody decided was
 * not needed. `--json` reports those plans anyway — the board shows a DONE
 * column — so the flat list is legitimately a subset, and comparing the two
 * without this would report every delivered plan's leftovers as a disagreement.
 *
 * Written as the scan's own `is_terminal_phase`, not as a guess: those two
 * words are the whole of it.
 */
const TERMINAL_PHASES: ReadonlySet<string> = new Set(['delivered', 'released']);

/**
 * How many of a slice's branches have not settled, under the scan's DEFAULT
 * strictness.
 *
 * Only a merged branch is settled, and a deferred one is exempt. `--loose`
 * would also count pushed work whose PR verifiably passed — this tier runs the
 * scan without it, so the reading is the strict one and no host round trip is
 * re-taken here.
 *
 * @param slice - one slice as the pulse reports it.
 * @returns the count the rule takes.
 */
const outstandingIn = (slice: FleetReading['plans'][number]['slices'][number]): number =>
  slice.branches.filter((b) => !b.deferred && b.state !== 'merged').length;

let pulse: FleetReading;
let offered: string[];

beforeAll(() => {
  // ONE SCAN FOR THE PULSE AND ONE FOR THE LIST, and they must be this way
  // round rather than derived from each other: the whole question is whether
  // two emissions of one rule agree, and a list computed from the pulse in this
  // file would agree by construction.
  pulse = FleetReadingSchema.parse(readFleetScan(estate));
  offered = readListEligible(estate);
});

describe('the estate is really being read', () => {
  it('parses a pulse with plans and slices in it', () => {
    // THE VACUITY GUARD, first, because every assertion below is over these
    // collections. A scan that failed to read the estate reports zero plans and
    // every comparison then passes having compared nothing.
    expect(pulse.plans.length).toBeGreaterThan(20);
    expect(pulse.summary.waves).toBeGreaterThan(20);
  });
});

describe('every slice the board renders follows from the readings it is shown', () => {
  it('re-derives the pulse verdict for every slice of every plan', () => {
    const found: Disagreement[] = [];
    let compared = 0;

    for (const plan of pulse.plans) {
      const derived = sliceVerdicts(
        plan.slices.map((slice) => ({
          outstanding: outstandingIn(slice),
          phase: plan.phase,
        })),
      );
      plan.slices.forEach((slice, i) => {
        compared += 1;
        if (derived[i] !== slice.verdict) {
          found.push({
            subject: `${plan.file} :: ${slice.name || '(unnamed)'}`,
            field: 'verdict',
            adapter: derived[i] ?? 'undefined',
            production: slice.verdict,
          });
        }
      });
    }

    // COUNTED, NOT ASSUMED. The two numbers come from different places — one
    // from walking the slices, one from the scan's own footer — so a walk that
    // silently visited fewer than the scan reported fails here rather than
    // passing with a shorter list.
    expect(compared).toBe(pulse.summary.waves);
    expect(compared).toBeGreaterThan(20);
    expect(found.map(describeDisagreement)).toEqual([]);
  });
});

describe('--next and the board offer the same branches', () => {
  it('names exactly the claimable branches of every non-terminal plan', () => {
    const found: Disagreement[] = [];
    let compared = 0;

    const fromPulse: string[] = [];
    for (const plan of pulse.plans) {
      // Terminal plans are the population `--next` never enumerates, so they
      // are excluded from BOTH sides rather than tolerated on one.
      if (TERMINAL_PHASES.has(plan.phase)) continue;
      for (const slice of plan.slices) {
        for (const branch of slice.branches) {
          compared += 1;
          if (isClaimable(slice.verdict, branch.state)) fromPulse.push(branch.branch);
        }
      }
    }

    const listed = new Set(offered);
    const rendered = new Set(fromPulse);
    for (const branch of fromPulse) {
      if (!listed.has(branch)) {
        found.push({
          subject: branch, field: 'claimable',
          adapter: 'the board offers it', production: '--next does not',
        });
      }
    }
    for (const branch of offered) {
      if (!rendered.has(branch)) {
        found.push({
          subject: branch, field: 'claimable',
          adapter: 'the board does not offer it', production: '--next does',
        });
      }
    }

    // N BRANCHES COMPARED. The floor is the vacuity guard: an estate whose
    // plans all failed to parse would report zero branches and agree perfectly.
    expect(compared).toBeGreaterThan(20);
    expect(found.map(describeDisagreement)).toEqual([]);
  });

  it('offers nothing that is not open, and nothing outside an eligible slice', () => {
    // The conjunction, checked from the OTHER direction: every branch the scan
    // offered must be findable in the pulse as an `open` branch of an
    // `eligible` slice. A branch named by `--list-eligible` and absent from the
    // pulse entirely would pass the set comparison above only if the pulse also
    // failed to report it — this fails on it either way.
    const states = new Map<string, { verdict: string; state: string }>();
    for (const plan of pulse.plans) {
      for (const slice of plan.slices) {
        for (const branch of slice.branches) {
          states.set(branch.branch, { verdict: slice.verdict, state: branch.state });
        }
      }
    }
    const wrong = offered.filter((branch) => {
      const found = states.get(branch);
      return !found || found.verdict !== 'eligible' || found.state !== 'open';
    });
    expect(wrong).toEqual([]);
  });
});
