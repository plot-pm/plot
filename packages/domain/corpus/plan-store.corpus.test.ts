import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { planOf, planStoreShell, type RawPlan } from '../src/adapters/plan-store/plan-store-shell.js';
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
  ['deferredPrs', 'deferred_prs'],
  ['tracer', 'tracer'],
  ['review', 'review'],
  ['impl', 'impl'],
  ['approvedRaw', 'approved_raw'],
  ['spikeApprovedRaw', 'spike_approved_raw'],
  ['designRaw', 'design_raw'],
  ['verifiedRaw', 'verified_raw'],
  ['deliveredRaw', 'delivered_raw'],
  ['releasedRaw', 'released_raw'],
  ['startedRaw', 'started_raw'],
  ['unreadBranchItems', 'unread_branch_items'],
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
  // Read by sprint-release-gate's own input, not through PlanStore; no PlanStore reader decides on it.
  'ticket',
  'malformed_prs',
  'changelog',
  'long_wave_names',
  'unread_branch_headings',
  // Read by reconcile's section 24a from the shell; no domain rule decides on it.
  'unread_waits',
  // Read by reconcile's section 24b from the shell; no domain rule decides on it.
  'unread_heading_items',
];

/**
 * The wire keys `planOf` reads that the per-field comparison cannot compare as
 * a plain copy. Each has its own test below.
 *
 * - `issues`: numbers on the wire, strings on the port.
 * - `rounds`: present on the port only where the wire carries a number.
 * - `error`: present only on a parse failure.
 * - `slices`, `waves`: the slice list under either wire spelling (`WIRE_SLICES`).
 */
const COMPARED_APART = ['issues', 'rounds', 'error', 'slices', 'waves'];

/**
 * Calls `planOf` on a proxy that answers `undefined` for every key.
 *
 * @returns the wire keys the adapter reads, observed from its behaviour.
 */
const keysPlanOfReads = (): Set<string> => {
  const read = new Set<string>();
  const recorder = new Proxy({} as RawPlan, {
    get: (_target, key) => {
      if (typeof key === 'string') read.add(key);
      return undefined;
    },
  });
  planOf(recorder);
  return read;
};

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

/**
 * One plan whose slice list carries an unread branch item: a non-claim list
 * item naming a token with a configured branch prefix.
 *
 * The estate may legitimately carry none of this field — reconcile 24c blocks
 * delivery on such an item, so a plan's author removes it. This synthetic plan
 * keeps the comparison of `unreadBranchItems` non-vacuous for that case. Both
 * readers still parse the same file, so the fixture problem does not arise:
 * the plan states no expected reading, and the two sides must agree on it.
 */
const UNREAD_BRANCH_ITEM_PLAN = `# An unread branch item

## Status

- **State:** Approved
- **Type:** bug

## Slices

### Absorbing (Branch: bug/the-absorbing-slice, PR: #1)
- the slice's work. Absorbs bug/the-absorbed-slice from another plan.
`;

/**
 * Reads one synthetic plan through both readers and lists where they disagree.
 *
 * @returns the adapter's records and every field disagreement.
 */
const readSyntheticPlan = async (
  body: string,
): Promise<{ plans: readonly PlanRecord[]; found: Disagreement[] }> => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-plan-store-corpus-'));
  try {
    const file = join(dir, '2026-11-20-an-unread-branch-item.md');
    writeFileSync(file, body);
    const wire = readPlanMeta(estate, [file]);
    const read = await planStoreShell(shellContext(ROOT)).readPlans([file]);
    if (!isAnswered(read)) throw new Error(`the adapter could not read the synthetic plan: ${read.why}`);
    const found: Disagreement[] = [];
    compareField(found, file, 'records', read.value.length, wire.length);
    for (const plan of read.value) {
      const raw = wire.find((one) => String(one.file) === plan.file) ?? {};
      for (const [portField, wireField] of FIELDS) {
        compareField(found, plan.file, `${String(portField)}/${wireField}`, plan[portField], raw[wireField]);
      }
    }
    return { plans: read.value, found };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    // So: every key the wire emits is mapped, compared apart, or listed as
    // deliberately uncarried. A key on none of the lists fails, and the fix is
    // a decision — carry it, or write it down.
    const mapped = new Set<string>([...FIELDS.map(([, wire]) => wire), ...COMPARED_APART]);
    const unexpected = new Set<string>();
    for (const raw of production) {
      for (const key of Object.keys(raw)) {
        if (!mapped.has(key) && !KNOWN_UNCARRIED.includes(key)) unexpected.add(key);
      }
    }
    expect([...unexpected].sort()).toEqual([]);
  });

  it('reports the same issues, as strings, on every plan', () => {
    const found: Disagreement[] = [];
    for (const plan of adapted) {
      const raw = byFile.get(plan.file);
      if (raw === undefined) continue;
      const wire = Array.isArray(raw.issues) ? (raw.issues as unknown[]) : [];
      compareField(found, plan.file, 'issues/issues', plan.issues, wire.map(String));
    }
    expect(found.map(describeDisagreement)).toEqual([]);
    expect(adapted.some((plan) => plan.issues.length > 0)).toBe(true);
  });

  it('carries rounds exactly where the wire carries a number', () => {
    const found: Disagreement[] = [];
    for (const plan of adapted) {
      const raw = byFile.get(plan.file);
      if (raw === undefined) continue;
      const wireHas = typeof raw.rounds === 'number';
      compareField(found, plan.file, 'rounds present', 'rounds' in plan, wireHas);
      if (wireHas) compareField(found, plan.file, 'rounds/rounds', plan.rounds, raw.rounds);
    }
    expect(found.map(describeDisagreement)).toEqual([]);
    expect(adapted.some((plan) => 'rounds' in plan)).toBe(true);
  });

  it('carries error only on a parse failure, with the wire value', () => {
    const parsed = production[0];
    expect(parsed).toBeDefined();
    expect('error' in (parsed ?? {})).toBe(false);
    expect('error' in planOf((parsed ?? {}) as RawPlan)).toBe(false);

    // The parser reports a failure only for a file it cannot read.
    const dir = mkdtempSync(join(tmpdir(), 'plot-plan-store-corpus-'));
    try {
      const missing = join(dir, '2026-11-23-a-plan-that-is-not-there.md');
      const [failed] = readPlanMeta(estate, [missing]);
      expect(failed).toBeDefined();
      expect(typeof failed?.error).toBe('string');
      const plan = planOf((failed ?? {}) as RawPlan);
      expect('error' in plan).toBe(true);
      expect(plan.error).toBe(failed?.error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names every key planOf reads on FIELDS or COMPARED_APART', () => {
    const read = keysPlanOfReads();
    // A check over an empty recording passes for every list.
    expect(read.size).toBeGreaterThan(0);
    const named = new Set<string>([...FIELDS.map(([, wire]) => wire), ...COMPARED_APART]);
    expect([...read].filter((key) => !named.has(key)).sort()).toEqual([]);
  });

  it('puts no key on two of FIELDS, COMPARED_APART and KNOWN_UNCARRIED', () => {
    const lists: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['FIELDS', FIELDS.map(([, wire]) => wire)],
      ['COMPARED_APART', COMPARED_APART],
      ['KNOWN_UNCARRIED', KNOWN_UNCARRIED],
    ];
    const owners = new Map<string, string[]>();
    for (const [name, keys] of lists) {
      for (const key of keys) owners.set(key, [...(owners.get(key) ?? []), name]);
    }
    const twice = [...owners].filter(([, names]) => names.length > 1).map(([key, names]) => `${key}: ${names.join(', ')}`);
    expect(twice.sort()).toEqual([]);
  });

  it('lists as uncarried no key planOf reads', () => {
    const read = keysPlanOfReads();
    expect(read.size).toBeGreaterThan(0);
    expect(KNOWN_UNCARRIED.filter((key) => read.has(key)).sort()).toEqual([]);
  });

  it('carries the fields the estate actually populates, so this is not vacuous', async () => {
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
    if (adapted.some((plan) => plan.unreadBranchItems.length > 0)) {
      expect(adapted.some((plan) => plan.unreadBranchItems.length > 0)).toBe(true);
    } else {
      const synthetic = await readSyntheticPlan(UNREAD_BRANCH_ITEM_PLAN);
      expect(synthetic.found.map(describeDisagreement)).toEqual([]);
      expect(synthetic.plans.some((plan) => plan.unreadBranchItems.length > 0)).toBe(true);
    }
    // And the legacy spelling really is what the parser emits, which is why the
    // adapter's tolerance for it is load-bearing rather than defensive.
    expect(production.some((raw) => Array.isArray(raw.waves))).toBe(true);
  });
});
