import { describe, it, expect } from 'vitest';
import { deriveSlices } from '../../src/server/fleet.js';
import {
  FleetReadingSchema, FleetSchema, PlanMetaSchema, SliceSchema, SliceSummarySchema,
  type FleetReading,
} from '../../src/contract/schema.js';

// The wave the contract now carries. `the-wave-is-a-thing-the-board-can-hold`
// settles that a wave is a THING with identity, branches, a verdict, ONE
// section and a completeness — derived once on the server where the scan's
// verdicts already are, so no consumer re-derives it and disagrees. Every
// assertion here is about deriveSlices being that one answer.

/**
 * One wave, whatever branches it was given — the wave-summary.test.ts shape,
 * kept the same so both files describe a pulse the same way. `deferred` follows
 * the state unless a fourth tuple element overrides it (a merged-but-deferred
 * branch is not a real shape, but the override keeps the helper honest).
 */
const wave = (
  name: string,
  verdict: string,
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred']>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    claimed: '',
  })),
});

/** A pulse carrying one plan and its waves, PARSED — so the fixture proves the
 *  contract accepts it and deriveSlices gets a properly-typed FleetReading. */
const pulse = (file: string, waves: ReturnType<typeof wave>[]): FleetReading =>
  FleetReadingSchema.parse({
    main: 'main',
    head: 'abc1234',
    plans: [{ file, slices: waves }],
    summary: {
      plans: 1, waves: waves.length, branches: 0, claimed: 0,
      eligible: 0, blocked: 0, deferred: 0,
    },
  });

describe('deriveSlices — identity is plan plus name', () => {
  it('names the wave by the plan basename (date-stripped) and its own name', () => {
    // The pair `openSlices` keys on: a name alone does not identify a wave, since
    // names repeat across plans. `plan` is the DISPLAY name rowsFromPulse writes,
    // so a consumer joins a wave to its rows on one spelling.
    const [w] = deriveSlices(pulse('2026-08-20-a-wave-is-a-thing.md', [
      wave('Tracer', 'eligible', [['feature/a', 'open']]),
    ]));
    expect(w.plan).toBe('a-wave-is-a-thing');
    expect(w.name).toBe('Tracer');
  });

  it('gives every (plan, wave) its own entry', () => {
    const waves = deriveSlices(pulse('2026-08-20-p.md', [
      wave('Tracer', 'complete', [['feature/a', 'merged']]),
      wave('Implementation', 'eligible', [['feature/b', 'open']]),
    ]));
    expect(waves.map((w) => w.name)).toEqual(['Tracer', 'Implementation']);
  });
});

describe('deriveSlices — branches are the wave contents', () => {
  it('carries every branch of the wave, by name', () => {
    // The containment link, pointing DOWN: a wave holds branches. Five branches,
    // five names — this is the kind that uses the upper end of zero-or-more.
    const [w] = deriveSlices(pulse('2026-08-20-p.md', [
      wave('Big', 'blocked', [
        ['feature/a', 'open'], ['feature/b', 'wip'], ['feature/c', 'open'],
        ['feature/d', 'claimed'], ['feature/e', 'open'],
      ]),
    ]));
    expect(w.branches).toEqual([
      'feature/a', 'feature/b', 'feature/c', 'feature/d', 'feature/e',
    ]);
  });
});

describe('deriveSlices — the verdict is the scan\'s, unchanged', () => {
  it('forwards complete, eligible and blocked verbatim', () => {
    const waves = deriveSlices(pulse('2026-08-20-p.md', [
      wave('A', 'complete', [['feature/a', 'merged']]),
      wave('B', 'eligible', [['feature/b', 'open']]),
      wave('C', 'blocked', [['feature/c', 'open']]),
    ]));
    expect(waves.map((w) => w.verdict)).toEqual(['complete', 'eligible', 'blocked']);
  });

  it('reports null where the scan verdict is unrecognised — absent is not a guess', () => {
    // The same gate the row uses (sliceVerdict): an unknown word is null, never
    // put on the wave as though the scan had said it. FleetSliceSchema's verdict
    // is a strict enum, so a parsed pulse cannot carry an unknown word — this
    // feeds deriveSlices a hand-built typed pulse to exercise the gate that
    // defends the day a newer scan emits a verdict this enum predates.
    const raw = {
      main: 'main', head: 'abc1234',
      plans: [{ file: '2026-08-20-p.md', phase: '', slices: [
        { name: 'A', verdict: 'in-flight', branches: [
          { branch: 'feature/a', state: 'open', deferred: false, claimed: '' },
        ] },
      ] }],
      summary: { plans: 1, waves: 1, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
    } as unknown as FleetReading;
    const [w] = deriveSlices(raw);
    expect(w.verdict).toBeNull();
  });
});

describe('deriveSlices — completeness is every non-deferred branch merged', () => {
  it('is complete when every branch is merged', () => {
    const [w] = deriveSlices(pulse('2026-08-20-p.md', [
      wave('A', 'complete', [['feature/a', 'merged'], ['feature/b', 'merged']]),
    ]));
    expect(w.complete).toBe(true);
  });

  it('exempts a deferred branch — {merged, deferred} is complete', () => {
    // plot-deliver skips deferred branches in its own completeness gate, so a
    // deferred branch is not outstanding work.
    const [w] = deriveSlices(pulse('2026-08-20-p.md', [
      wave('A', 'complete', [['feature/a', 'merged'], ['feature/gone', 'deferred']]),
    ]));
    expect(w.complete).toBe(true);
  });

  it('is complete when a wave holds only deferred branches — nothing to merge', () => {
    const [w] = deriveSlices(pulse('2026-08-20-p.md', [
      wave('A', 'complete', [['feature/gone', 'deferred']]),
    ]));
    expect(w.complete).toBe(true);
  });

  it('is NOT complete while any branch is unmerged', () => {
    const [w] = deriveSlices(pulse('2026-08-20-p.md', [
      wave('A', 'eligible', [['feature/a', 'merged'], ['feature/b', 'open']]),
    ]));
    expect(w.complete).toBe(false);
  });
});

describe('deriveSlices — one section, done or not-started', () => {
  it('puts a complete wave in done', () => {
    const [w] = deriveSlices(pulse('2026-08-20-p.md', [
      wave('A', 'complete', [['feature/a', 'merged']]),
    ]));
    expect(w.section).toBe('done');
  });

  it('puts an eligible wave in not-started', () => {
    const [w] = deriveSlices(pulse('2026-08-20-p.md', [
      wave('A', 'eligible', [['feature/a', 'open']]),
    ]));
    expect(w.section).toBe('not-started');
  });

  it('puts a blocked wave in not-started — a wave waits, it does not work', () => {
    // A wave never reaches working or waiting-on-machine; blocked is still where
    // its unfinished work is, which is not-started.
    const [w] = deriveSlices(pulse('2026-08-20-p.md', [
      wave('A', 'blocked', [['feature/a', 'open']]),
    ]));
    expect(w.section).toBe('not-started');
  });

  it('keeps a MIXED wave out of done — one merged, one open', () => {
    // The Inverted defect in miniature: a merged branch inside an unfinished
    // wave. Its state says merged; the WAVE is not done, and section must say so
    // whatever a per-branch reading would. Derived from completeness, so this
    // cannot report done however the verdict aggregates.
    const [w] = deriveSlices(pulse('2026-08-20-p.md', [
      wave('Inverted', 'eligible', [['feature/merged', 'merged'], ['feature/open', 'open']]),
    ]));
    expect(w.complete).toBe(false);
    expect(w.section).toBe('not-started');
    expect(w.section).not.toBe('done');
  });
});

describe('deriveSlices — completeness asked once, answered the same everywhere', () => {
  it('never lets section read done while complete is false', () => {
    // The whole point of one derivation: section follows from complete, so the
    // two cannot disagree across the estate. Asserted over every state a branch
    // can be in — a done section implies a complete wave, always.
    const waves = deriveSlices(pulse('2026-08-20-p.md', [
      wave('a', 'complete', [['x/1', 'merged']]),
      wave('b', 'eligible', [['x/2', 'open']]),
      wave('c', 'blocked', [['x/3', 'wip']]),
      wave('d', 'eligible', [['x/4', 'merged'], ['x/5', 'claimed']]),
      wave('e', 'complete', [['x/6', 'merged'], ['x/7', 'deferred']]),
    ]));
    for (const w of waves) {
      if (w.section === 'done') expect(w.complete).toBe(true);
      if (!w.complete) expect(w.section).not.toBe('done');
    }
  });

  it('is a pure function of the pulse — the same pulse yields the same waves', () => {
    // No host call, no clock, no second scan: deriveSlices reads only the pulse
    // it is handed. Two runs on one pulse are identical, which is what lets a
    // consumer trust the single answer.
    const p = pulse('2026-08-20-p.md', [
      wave('A', 'eligible', [['feature/a', 'merged'], ['feature/b', 'open']]),
    ]);
    expect(deriveSlices(p)).toEqual(deriveSlices(p));
  });
});

describe('deriveSlices — an unnamed wave is carried, not hidden', () => {
  it('renders an unnamed wave as (unnamed), the same spelling the row uses', () => {
    // Six such waves exist, all predating the naming convention. A board that
    // dropped them would make six real waves invisible; the wave is carried with
    // the value the row substitutes.
    const [w] = deriveSlices(pulse('2026-08-20-p.md', [
      wave('', 'eligible', [['feature/a', 'open']]),
    ]));
    expect(w.name).toBe('(unnamed)');
  });
});

describe('the Wave contract', () => {
  it('accepts a fully-formed wave', () => {
    expect(SliceSchema.parse({
      plan: 'a-plan', name: 'Tracer', branches: ['feature/a'],
      verdict: 'eligible', section: 'not-started', complete: false,
    })).toMatchObject({ name: 'Tracer', complete: false });
  });

  it('has no phase field — a wave inherits its plan\'s phase, never its own', () => {
    // Zero plans in the estate have waves reporting different phases, so a phase
    // on the wave would only ever repeat the plan's. It is deliberately absent.
    const w = SliceSchema.parse({
      plan: 'a-plan', name: 'Tracer', branches: [],
      verdict: null, section: 'done', complete: true,
    });
    expect(w).not.toHaveProperty('phase');
  });

  it('defaults slices to [] on the fleet payload for an older server', () => {
    // A payload from a server predating this wave still validates — the issues /
    // agents precedent. The default fires at PARSE time; a client that CASTS
    // gets undefined and must guard, which is why the server emits it always
    // (buildFleet returns [] on a cold cache rather than omitting the field).
    const parsed = FleetSchema.parse({
      generatedAt: '', ageSeconds: 0, ready: false, error: null,
      rows: [],
      summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
      prAgeSeconds: null, prError: null,
    });
    expect(parsed.slices).toEqual([]);
  });
});

/**
 * THE RENAME'S ONLY GUARD. `Wave` became `Slice` and the payload field followed;
 * a running client and a freshly deployed server therefore disagree for one
 * deploy, and `plot-plan-meta.sh` ships separately and emits `waves`
 * indefinitely. A field rename with no reader fails at RUNTIME and says
 * nothing — the schema simply finds no `slices`, applies the default, and every
 * slice silently disappears from the board.
 *
 * So the three schemas emit `slices` and accept `waves`. These assertions are
 * what stand between the rename and that silence.
 */
describe('the wire accepts both spellings', () => {
  it('parses a fleet payload carrying the OLD `waves` spelling', () => {
    const slice = {
      plan: 'a-plan', name: 'Tracer', branches: ['feature/x'],
      verdict: 'eligible', section: 'working', complete: false,
    };
    const parsed = FleetSchema.parse({
      generatedAt: '', ageSeconds: 0, ready: true, error: null,
      rows: [],
      waves: [slice],
      summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
      prAgeSeconds: null, prError: null,
    });
    // Read back under the NEW name: the reader resolves the spelling, it does
    // not merely tolerate it. A consumer sees one field, whichever arrived.
    expect(parsed.slices).toHaveLength(1);
    expect(parsed.slices[0].name).toBe('Tracer');
    expect(parsed.slices[0].branches).toEqual(['feature/x']);
    expect(parsed).not.toHaveProperty('waves');
  });

  it('parses a fleet payload carrying the NEW `slices` spelling', () => {
    const parsed = FleetSchema.parse({
      generatedAt: '', ageSeconds: 0, ready: true, error: null,
      rows: [],
      slices: [{
        plan: 'a-plan', name: 'Tracer', branches: ['feature/x'],
        verdict: 'eligible', section: 'working', complete: false,
      }],
      summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
      prAgeSeconds: null, prError: null,
    });
    expect(parsed.slices).toHaveLength(1);
  });

  it('prefers `slices` where a payload carries both', () => {
    // Not a shape any producer emits — the assertion pins WHICH wins, so a
    // future reader does not have to run it to find out.
    const parsed = FleetSchema.parse({
      generatedAt: '', ageSeconds: 0, ready: true, error: null,
      rows: [],
      slices: [{
        plan: 'a-plan', name: 'New', branches: [],
        verdict: null, section: 'done', complete: true,
      }],
      waves: [{
        plan: 'a-plan', name: 'Old', branches: [],
        verdict: null, section: 'done', complete: true,
      }],
      summary: { plans: 1, waves: 1, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
      prAgeSeconds: null, prError: null,
    });
    expect(parsed.slices[0].name).toBe('New');
  });

  it('parses plan-meta output carrying `waves`, which its script still emits', () => {
    // `plot-plan-meta.sh` is out of this rename's scope and emits `waves`
    // today. This is not a transitional case: it is the steady state until that
    // script changes, so the reader is permanent rather than a deploy-window
    // courtesy.
    const parsed = PlanMetaSchema.parse({
      file: 'a-plan.md', format: 'v2', phase: 'approved',
      waves: [{ name: 'Tracer', branches: [{ branch: 'feature/x' }] }],
    });
    expect(parsed.slices).toHaveLength(1);
    expect(parsed.slices[0].name).toBe('Tracer');
  });

  it('parses a slice summary carrying `waves`', () => {
    const parsed = SliceSummarySchema.parse({      waves: 3, branches: 7, deferred: 1,
    });
    expect(parsed.slices).toBe(3);
  });

  it('reports a malformed value under whichever key carried it', () => {
    // The reader RENAMES and validates nothing, so Zod still rejects bad data
    // that arrived under the old spelling. A preprocess that swallowed errors
    // would make the old spelling parse things the new one refuses.
    expect(() => FleetSchema.parse({
      generatedAt: '', ageSeconds: 0, ready: true, error: null,
      rows: [],
      waves: [{ plan: 'a-plan' }],
      summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
      prAgeSeconds: null, prError: null,
    })).toThrow();
  });

  it('leaves a non-object payload to the schema behind it', () => {
    // `null`, arrays and primitives pass through untouched so the type error
    // comes from Zod rather than from the reader.
    expect(() => FleetSchema.parse(null)).toThrow();
    expect(() => FleetSchema.parse([])).toThrow();
  });
});
