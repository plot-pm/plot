import { beforeAll, describe, expect, it } from 'vitest';

import { planStoreShell } from '../src/adapters/plan-store/plan-store-shell.js';
import { shellContext } from '../src/adapters/scripts.js';
import type { PlanRecord } from '../src/ports/plan-store.js';
import { isAnswered } from '../src/port-result.js';
import { compareField, describeDisagreement, type Disagreement } from './compare.js';
import { listPlanFiles, readPlanMeta, type Estate } from './production.js';

/**
 * THE CORPUS TIER FOR `PlanStore`: does the adapter feed the domain the same
 * readings production reads, over this repository's real plans?
 *
 * Not whether the RULES hold — there is no second implementation of those to
 * disagree with, because the board imports the domain's. What can disagree is
 * an adapter that drops a field or renames one wrongly, and that failure would
 * otherwise surface as a domain correct about the wrong facts.
 *
 * ON A DISAGREEMENT THE BRANCH STOPS. Which side is wrong is judgement: the
 * adapter may be wrong, or this may have found a production bug that gets its
 * own plan. The one move forbidden here is adjusting the adapter to match, so
 * the failure prints the field, the plan and both readings — the three things
 * `PLOT-BLOCKED` has to carry — and a person decides.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const estate: Estate = { root: ROOT };

/**
 * The port's field beside the wire's, and this table IS the claim under test.
 *
 * Written out rather than derived, because a derivation would have to encode
 * the same snake-to-camel rule the adapter encodes and would then agree with it
 * by construction — the fixture problem, one layer up.
 */
const FIELDS: ReadonlyArray<readonly [keyof PlanRecord, string]> = [
  ['file', 'file'],
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

/**
 * The wire keys the port deliberately does not carry.
 *
 * NAMED RATHER THAN IGNORED, and that is the point of the list. A port is
 * allowed to be a narrower view than the wire, but "narrower on purpose" and
 * "a field the adapter forgot" look identical from inside the adapter. Listing
 * them makes the omission a decision somebody wrote down, and the test below
 * fails when the wire grows a key that is on neither list — so a new field
 * arrives as a question rather than as silence.
 */
const KNOWN_UNCARRIED = [
  'phase_alt',
  'phase_alt_raw',
  'review_raw',
  'impl_raw',
  'design_raw',
  'issues',
  'malformed_prs',
  'changelog',
  'long_wave_names',
  'rounds',
  'waves',
  'slices',
  'error',
];

/** The wire's spelling of a plan's slice list; the parser still emits this one. */
const WIRE_SLICES = ['slices', 'waves'];

interface RawBranch {
  branch?: string;
  deferred?: boolean;
  deferred_reason?: string;
  claimed?: string;
}

interface RawSlice {
  name?: string;
  branches?: RawBranch[];
}

const wireSlices = (raw: Record<string, unknown>): RawSlice[] => {
  for (const key of WIRE_SLICES) {
    const value = raw[key];
    if (Array.isArray(value)) return value as RawSlice[];
  }
  return [];
};

let files: string[];
let adapted: readonly PlanRecord[];
let production: Record<string, unknown>[];
let byFile: Map<string, Record<string, unknown>>;

beforeAll(async () => {
  files = listPlanFiles(estate);
  production = readPlanMeta(estate, files);
  byFile = new Map(production.map((raw) => [String(raw.file), raw]));

  const store = planStoreShell(shellContext(ROOT));
  const read = await store.readPlans(files);
  if (!isAnswered(read)) throw new Error(`the adapter could not read the corpus: ${read.why}`);
  adapted = read.value;
});

describe('the PlanStore adapter agrees with plot-plan-meta.sh', () => {
  it('reads a corpus worth comparing, and both sides read all of it', () => {
    // A FLOOR, because every assertion below is universally quantified and a
    // universal claim over an empty set is true. Measured 2026-08-30: 172
    // plans. The plan quoted 158 and the brief 170 — the number is a
    // measurement, so this asserts an order of magnitude rather than a
    // constant that a merged plan would falsify.
    expect(files.length).toBeGreaterThan(100);
    expect(production).toHaveLength(files.length);
    expect(adapted).toHaveLength(production.length);
  });

  it('reports the same value for every field it carries, on every plan', () => {
    const found: Disagreement[] = [];
    for (const plan of adapted) {
      const raw = byFile.get(plan.file);
      if (raw === undefined) {
        found.push({
          subject: plan.file,
          field: 'file',
          adapter: JSON.stringify(plan.file),
          production: 'absent',
        });
        continue;
      }
      for (const [portField, wireField] of FIELDS) {
        compareField(found, plan.file, `${String(portField)}/${wireField}`, plan[portField], raw[wireField]);
      }
    }
    // ONE comparison rather than an assertion per field: a failure has to name
    // every disagreeing plan, because one plan disagreeing and all 172
    // disagreeing are different findings.
    expect(found.map(describeDisagreement)).toEqual([]);
  });

  it('reports the same slices, branch for branch, under either wire spelling', () => {
    const found: Disagreement[] = [];
    for (const plan of adapted) {
      const raw = byFile.get(plan.file);
      if (raw === undefined) continue;
      const wire = wireSlices(raw);
      compareField(found, plan.file, 'slices.length', plan.slices.length, wire.length);
      wire.forEach((slice, index) => {
        const mine = plan.slices[index];
        const where = `${plan.file} slice[${index}]`;
        compareField(found, where, 'name', mine?.name, slice.name ?? '');
        const branches = slice.branches ?? [];
        compareField(found, where, 'branches.length', mine?.branches.length, branches.length);
        branches.forEach((branch, at) => {
          const ours = mine?.branches[at];
          const subject = `${where}.branch[${at}]`;
          compareField(found, subject, 'branch', ours?.branch, branch.branch ?? '');
          compareField(found, subject, 'deferred', ours?.deferred, branch.deferred ?? false);
          compareField(found, subject, 'deferredReason', ours?.deferredReason, branch.deferred_reason ?? '');
          compareField(found, subject, 'claimed', ours?.claimed, branch.claimed ?? '');
        });
      });
    }
    expect(found.map(describeDisagreement)).toEqual([]);
  });

  it('reads the estate through the one-plan path too, not only the batch', () => {
    // `readPlan` is a DIFFERENT code path from `readPlans` — it takes the batch's
    // first record and answers `failed` on an empty result — so a batch that
    // agrees says nothing about it. Sampled rather than run 172 times: this
    // asserts the two paths agree, and the batch above already asserted the
    // corpus.
    const sample = [files[0], files[Math.floor(files.length / 2)], files[files.length - 1]];
    return Promise.all(
      sample.filter((file): file is string => file !== undefined).map(async (file) => {
        const store = planStoreShell(shellContext(ROOT));
        const one = await store.readPlan(file);
        expect(isAnswered(one)).toBe(true);
        if (!isAnswered(one)) return;
        const batched = adapted.find((plan) => plan.file === file);
        expect(one.value).toEqual(batched);
      }),
    );
  });

  it('names every wire field, so a new one arrives as a question', () => {
    // THE OTHER DIRECTION, and the one an adapter cannot fail by itself. Every
    // test above compares fields the port declares; none of them notices a
    // field production reports that the port never carried. That is how a
    // reading gets dropped silently — the adapter keeps agreeing about what it
    // reads, while the domain stops being told something it needs.
    //
    // So: every key the wire emits is either mapped or listed as deliberately
    // uncarried. A key on neither list fails, and the fix is a decision — carry
    // it, or write it down.
    const mapped = new Set<string>(FIELDS.map(([, wire]) => wire));
    const unexpected = new Set<string>();
    for (const raw of production) {
      for (const key of Object.keys(raw)) {
        if (!mapped.has(key) && !KNOWN_UNCARRIED.includes(key)) unexpected.add(key);
      }
    }
    expect([...unexpected].sort()).toEqual([]);
  });

  it('carries the fields the estate actually populates, so this is not vacuous', () => {
    // Every comparison above passes if both sides read `''` everywhere. These
    // assert the corpus exercises the fields: a plan with slices, a plan with
    // PRs, a plan with each transition record.
    expect(adapted.some((plan) => plan.slices.length > 0)).toBe(true);
    expect(adapted.some((plan) => plan.prs.length > 0)).toBe(true);
    expect(adapted.some((plan) => plan.branches.length > 0)).toBe(true);
    expect(adapted.some((plan) => plan.approvedRaw !== '')).toBe(true);
    expect(adapted.some((plan) => plan.deliveredRaw !== '')).toBe(true);
    expect(adapted.some((plan) => plan.releasedRaw !== '')).toBe(true);
    expect(adapted.some((plan) => plan.startedRaw.length > 0)).toBe(true);
    expect(adapted.some((plan) => plan.sprint !== '')).toBe(true);
    expect(adapted.some((plan) => plan.story !== '')).toBe(true);
    // And the legacy spelling really is what the parser emits, which is why the
    // adapter's tolerance for it is load-bearing rather than defensive.
    expect(production.some((raw) => Array.isArray(raw.waves))).toBe(true);
  });
});
