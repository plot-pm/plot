import { basename } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { planStoreRef } from '../src/adapters/plan-store/plan-store-ref.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext } from '../src/adapters/scripts.js';
import { isAnswered } from '../src/port-result.js';
import { namedSlices } from '../src/rules/branch-state.js';
import { readEstate, type Estate as WalkEstate } from '../src/workflows/plan-walk-estate.js';
import { compareField, describeDisagreement, type Disagreement } from './compare.js';
import { readEstatePlanMeta, readMainBranch, readSliceNames, type Estate } from './production.js';

/**
 * THE PLAN WALK'S ESTATE STAGE AGAINST THE SHELL SCAN: does `readEstate` find
 * the plans, and read them, as `plot-fleet-scan.sh`'s `enumerate_estate` does?
 *
 * Production side: `readEstatePlanMeta` (the plan directory of `origin/<main>`
 * plus branch-only plans, parsed by `plot-plan-meta.sh`) and `readSliceNames`
 * (`plot-fleet-scan.sh --slice-names`). Stage side: `readEstate` over the real
 * `Refs` adapter and the ref-backed `PlanStore`, reading by object name.
 *
 * ON A DISAGREEMENT THE BRANCH STOPS. Adjusting either side to make the
 * comparison pass is the one move forbidden; the failure names the plan, the
 * field and both readings.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

/** The wire field beside the port's, for the fields the estate stage must carry. */
const FIELDS: ReadonlyArray<readonly [keyof WalkEstate['plans'][number]['record'], string]> = [
  ['format', 'format'],
  ['phase', 'phase'],
  ['phaseRaw', 'phase_raw'],
  ['type', 'type'],
  ['title', 'title'],
  ['sprint', 'sprint'],
  ['story', 'story'],
  ['assignee', 'assignee'],
  ['branches', 'branches'],
  ['prs', 'prs'],
  ['review', 'review'],
  ['impl', 'impl'],
  ['approvedRaw', 'approved_raw'],
  ['deliveredRaw', 'delivered_raw'],
  ['releasedRaw', 'released_raw'],
  ['startedRaw', 'started_raw'],
];

let walked: WalkEstate;
let production: Record<string, unknown>[];
let sliceNames: string[];

beforeAll(async () => {
  const main = readMainBranch(estate);
  production = readEstatePlanMeta(estate, main);
  sliceNames = readSliceNames(estate);

  const context = shellContext(ROOT);
  const refs = refsGit(context);
  const store = planStoreRef(refs, context, `origin/${main}`);
  const read = (key: string, fallback: string) => store.config(key, fallback);
  const planDir = await read('Plan directory', 'docs/plans/');
  const active = await read('Active index', 'docs/plans/active/');
  const delivered = await read('Delivered index', 'docs/plans/delivered/');
  const prefixes = await read('Branch prefixes', 'idea/, feature/, bug/, docs/, infra/');
  if (!isAnswered(planDir) || !isAnswered(active) || !isAnswered(delivered) || !isAnswered(prefixes)) {
    throw new Error('the corpus could not read the repository config');
  }
  const walk = await readEstate(refs, store, {
    mainBranch: main,
    planDir: planDir.value,
    activeDir: active.value,
    deliveredDir: delivered.value,
    prefixes: prefixes.value
      .split(',')
      .map((p) => p.trim().replace(/\/$/, ''))
      .filter((p) => p !== ''),
  });
  if (!isAnswered(walk)) throw new Error(`the estate stage could not read the corpus: ${walk.why}`);
  walked = walk.value;
}, 500_000);

describe('the estate stage agrees with the shell scan', () => {
  it('reads a corpus worth comparing', () => {
    // A FLOOR: every assertion below is universally quantified over this set.
    expect(production.length).toBeGreaterThan(100);
    expect(walked.plans).toHaveLength(production.length);
  });

  it('finds the same plans in the same order', () => {
    expect(walked.plans.map((p) => basename(p.record.file))).toEqual(
      production.map((raw) => basename(String(raw.file))),
    );
  });

  it('reads the same value for every field it carries, on every plan', () => {
    const found: Disagreement[] = [];
    walked.plans.forEach(({ record }, at) => {
      const raw = production[at];
      if (raw === undefined) return;
      for (const [portField, wireField] of FIELDS) {
        compareField(found, record.file, `${String(portField)}/${wireField}`, record[portField], raw[wireField]);
      }
    });
    expect(found.map(describeDisagreement)).toEqual([]);
  });

  it('names the same slices as plot-fleet-scan.sh --slice-names', () => {
    const rule = namedSlices(
      walked.plans.map(({ record }) => ({
        phase: record.phase,
        slices: record.slices.flatMap((slice) =>
          slice.branches.map((b) => ({ branch: b.branch, deferred: b.deferred })),
        ),
      })),
    );
    expect([...rule].sort()).toEqual([...sliceNames].sort());
  });

  it('reads the active and delivered indexes from the same snapshot', () => {
    // Not vacuous: this repository keeps both indexes as symlinks.
    expect(walked.indexes.some((link) => link.index === 'active')).toBe(true);
    expect(walked.indexes.some((link) => link.index === 'delivered')).toBe(true);
    expect(walked.indexes.every((link) => link.target !== '')).toBe(true);
    expect(walked.dangling).toEqual([]);
  });
});
