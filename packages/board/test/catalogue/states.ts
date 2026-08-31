import { board, card, column, fleet, row, wave } from './build.js';
import {
  BOARD_PHASES, ELIGIBLE_NOTE, RowKindSchema,
  type Board, type Fleet, type RowKind,
} from '../../src/contract/schema.js';

/**
 * THE CATALOGUE — every state a test can ask for, by name.
 *
 * A scenario is a `{ board, fleet }` pair and a name. The name is the point: it
 * carries the intent that today lives in forty lines of inline assembly at the
 * top of each browser test, where the only way to learn what a fixture is FOR is
 * to read it.
 *
 * ## What belongs here
 *
 * A state worth naming is one more than one test could want, or one whose shape
 * takes explanation. A state only one test cares about is better expressed as an
 * override on a named one — `open('a-done-wave', { … })` — so the test still
 * says which family it is in.
 *
 * ## What does NOT belong here
 *
 * Assertions, selectors, and anything read from the estate. A scenario is data.
 *
 * ## The fidelity problem, stated where it is felt
 *
 * A catalogue is a CLAIM about what the server emits, and a claim can drift.
 * Nothing here proves the real board would ever produce these payloads — that is
 * what the six remaining end-to-end browser tests are for, and it is why the
 * plan keeps them. If a scenario here stops resembling a real pulse, this file
 * is not what will notice.
 */
export interface Scenario {
  /** What `/api/board` answers. */
  board: Board;
  /** What `/api/fleet` answers. */
  fleet: Fleet;
}

const GH = 'https://github.com/tiny/garden/tree/';

/**
 * The plan FILES the scenarios below refer to, named once.
 *
 * A row carries `planFile` and a card carries `path`, and the board joins a row
 * to its card by the two agreeing. Written twice they drift, and the symptom is
 * a row that renders its plain `/plan/` link instead of opening the card — which
 * is a REAL state (`feature/ghost` below is exactly it), so the bug and the
 * intended state are indistinguishable on the page.
 */
const BEANS_FILE = '2026-03-01-beans.md';
const TOMS_FILE = '2026-03-01-plant-tomatoes.md';
const GHOST_FILE = '2099-01-01-ghost-plan.md';
const SIX_WAVES_FILE = '2026-08-24-six-waves.md';
const KINDS_FILE = '2026-08-24-every-kind.md';

/**
 * Every row kind the scan can emit, read FROM the schema rather than listed.
 *
 * A kind added to `RowKindSchema` joins `one-row-per-kind` without anyone
 * remembering to add it here — which is the whole claim that scenario makes.
 */
const KINDS: readonly RowKind[] = RowKindSchema.options;

/**
 * A DONE wave of two merged branches.
 *
 * The wave's own verdict is `complete`, and both its branches are `merged`. That
 * pairing is the whole point of the state: the row's status must speak the
 * WAVE's verdict (`complete`) rather than a word chosen by the section it landed
 * in (`delivered`), and only a wave whose branches carry the other word can tell
 * the two apart.
 */
const aDoneWave = (): Scenario => {
  const rows = [
    row({
      plan: 'six-waves', planFile: '2026-08-24-six-waves.md',
      branch: 'feature/done-one', wave: 'Complete', verdict: 'complete',
      branchUrl: `${GH}feature/done-one`,
      state: 'merged', group: 'done', ageMinutes: 10,
    }),
    row({
      plan: 'six-waves', planFile: '2026-08-24-six-waves.md',
      branch: 'feature/done-two', wave: 'Complete', verdict: 'complete',
      branchUrl: `${GH}feature/done-two`,
      state: 'merged', group: 'done', ageMinutes: 10,
    }),
  ];
  return {
    board: board({
      columns: [column({ phase: 'Development', cards: [card({ slug: 'six-waves', title: 'Six waves', path: 'docs/plans/2026-08-24-six-waves.md' })] })],
    }),
    fleet: fleet({
      rows,
      waves: [wave({
        plan: 'six-waves', name: 'Complete', section: 'done',
        branches: ['feature/done-one', 'feature/done-two'],
        verdict: 'complete', complete: true,
      })],
    }),
  };
};

/**
 * One eligible wave nobody has started.
 *
 * `state: 'open'` is load-bearing rather than incidental: NOT STARTED groups
 * only `isUnbegun` rows (`group === 'not-started' && state === 'open'`), so a
 * wave left at the builder's `wip` default renders no wave row at all and every
 * assertion against it times out. That failure is indistinguishable from a
 * selector typo, and it has been paid for once already in this suite.
 */
const anEligibleWave = (): Scenario => {
  const rows = [
    row({
      plan: 'a-wave-is-a-thing-not-a-label',
      planFile: '2026-08-24-a-wave-is-a-thing-not-a-label.md',
      branch: 'feature/anchor-the-wave', branchUrl: `${GH}feature/anchor-the-wave`,
      kind: 'wave', wave: 'Anchored', state: 'open', group: 'not-started',
      verdict: 'eligible', waitingDays: 2, ageMinutes: null,
      note: 'approved — nobody has taken it',
    }),
  ];
  return {
    board: board({
      columns: [column({
        phase: 'Development',
        cards: [card({
          slug: 'a-wave-is-a-thing-not-a-label', title: 'A wave is a thing, not a label',
          path: 'docs/plans/2026-08-24-a-wave-is-a-thing-not-a-label.md',
        })],
      })],
    }),
    fleet: fleet({
      rows,
      waves: [wave({
        plan: 'a-wave-is-a-thing-not-a-label', name: 'Anchored',
        branches: ['feature/anchor-the-wave'],
        verdict: 'eligible', section: 'not-started', complete: false,
      })],
    }),
  };
};

/**
 * THE TEN-ROW ESTATE — one scenario, not ten.
 *
 * Every waiting-group at once, each row carrying a distinguishable case. It is
 * the state `agents-tab.browser.test.ts` builds inline today (its `fleet()`,
 * lines 24–170), lifted onto the shared builders so the two stop drifting.
 *
 * ## Why one rich estate rather than ten thin ones
 *
 * The plan's first Open Question asks how many scenarios are right, and the
 * Survey answers it from the file that needs the most: *"these ten rows are one
 * scenario, not ten. The right shape is a small number of rich named estates
 * plus per-test overrides."* A test about a merged branch's missing link does
 * not want an estate containing only a merged branch — it wants the estate, and
 * one row in it.
 *
 * Ten thin scenarios would also make the ratio gate unmeasurable: a test whose
 * scenario holds exactly its own row overrides nothing and proves nothing, which
 * is the fixture sprawl the plan exists to remove wearing a catalogue's name.
 *
 * ## What each row is for
 *
 * | row | group | carries |
 * |---|---|---|
 * | `feature/beans-a`, `-b` | working | two plans in one group → sub-headings; ages 200 / 10 fix the order |
 * | `feature/toms-a` | working | the second plan |
 * | `feature/reviewed` | waiting-on-you | a PR as FIELDS (`number`, `url`, `draft`, `state`), never prose |
 * | `feature/untaken` | not-started | the only startable row |
 * | `feature/blocked` | not-started | `blockedBy` as a FIELD; not startable |
 * | `feature/shelved` | not-started | `deferred` with recent commits — phase fell back, badge says why |
 * | `feature/undated` | not-started | `waitingDays: null` — a plan predating `Approved:` |
 * | `feature/landed` | done | `merged` with `branchUrl: ''` — no branch link |
 * | `feature/ghost` | quiet | a plan with NO board card |
 * | `feature/ghost-ready` | not-started | startable AND cardless → no button rather than a broken one |
 *
 * The board carries cards for `beans` and `plant-tomatoes` and deliberately NOT
 * for `ghost-plan`: the last two rows are about what a row renders when its plan
 * has no card, and a card would erase the state.
 */
const aFullEstate = (): Scenario => {
  const rows = [
    row({ branch: 'feature/beans-a', plan: 'beans', planFile: BEANS_FILE, ageMinutes: 200, startability: 'someone-is-on-it' }),
    row({ branch: 'feature/beans-b', plan: 'beans', planFile: BEANS_FILE, ageMinutes: 10, startability: 'someone-is-on-it' }),
    row({ branch: 'feature/toms-a', plan: 'plant-tomatoes', planFile: TOMS_FILE, ageMinutes: 50, startability: 'someone-is-on-it' }),
    // A branch WITH a PR. The two links must differ, each landing where its own
    // text points, and the row's cell is built from these FIELDS — never from
    // the sentence in `note`.
    row({
      branch: 'feature/reviewed', plan: 'beans', planFile: BEANS_FILE,
      group: 'waiting-on-you', ageMinutes: 20, note: 'PR #130 green',
      pr: { number: 130, url: 'https://github.com/tiny/garden/pull/130', draft: false, state: 'green' },
      branchUrl: `${GH}feature/reviewed`, startability: 'someone-is-on-it',
    }),
    // The ONE row a person can pick up, so the one that carries Start work.
    row({
      branch: 'feature/untaken', plan: 'plant-tomatoes', planFile: TOMS_FILE,
      group: 'not-started', state: 'open', phase: 'Design', ageMinutes: null,
      waitingOn: 'click', note: ELIGIBLE_NOTE, verdict: 'eligible',
      branchUrl: `${GH}feature/untaken`, waitingDays: 22, startability: 'start-work',
    }),
    // The other half of not-started, and the one that must NOT get a button:
    // `plot-dispatch.sh` refuses it, so a button would invite a refused action.
    // THE FIELD, not the sentence — a grouped row drops its note by design.
    row({
      branch: 'feature/blocked', plan: 'plant-tomatoes', planFile: TOMS_FILE,
      group: 'not-started', state: 'open', phase: 'Design', ageMinutes: null,
      waitingOn: 'time', blockedBy: 'Truth', verdict: 'blocked',
      branchUrl: `${GH}feature/blocked`, waitingDays: 22, startability: null,
    }),
    // Handed back: real commits inside the quiet window, under an APPROVED plan.
    // Both halves must show — the phase has fallen back AND the badge says why.
    row({
      branch: 'feature/shelved', plan: 'beans', planFile: BEANS_FILE,
      group: 'not-started', state: 'deferred', phase: 'Design', ageMinutes: 2,
      note: 'last commit 2 min ago', branchUrl: `${GH}feature/shelved`, startability: null,
    }),
    // A plan recording no approval date — every plan predating `Approved:`.
    // It must show no waiting age at all.
    row({
      branch: 'feature/undated', plan: 'beans', planFile: BEANS_FILE,
      group: 'not-started', state: 'open', phase: 'Design', ageMinutes: null,
      waitingOn: 'click', note: ELIGIBLE_NOTE, verdict: 'eligible',
      branchUrl: `${GH}feature/undated`, waitingDays: null, startability: 'start-work',
    }),
    // Merged: its remote page is gone, so no branch link.
    row({
      branch: 'feature/landed', plan: 'plant-tomatoes', planFile: TOMS_FILE,
      group: 'done', state: 'merged', ageMinutes: 300, note: 'merged',
      branchUrl: '', startability: null,
    }),
    // A plan with NO board card — the row must keep its plain /plan/ link
    // rather than open an empty modal.
    row({
      branch: 'feature/ghost', plan: 'ghost-plan', planFile: GHOST_FILE,
      group: 'quiet', ageMinutes: 999, note: 'no commit for 16 hours',
      branchUrl: `${GH}feature/ghost`, startability: null,
    }),
    // The same missing card on an otherwise perfectly startable row.
    // `StartWorkButton` takes a Card and a row is not one, so: NO button.
    row({
      branch: 'feature/ghost-ready', plan: 'ghost-plan', planFile: GHOST_FILE,
      group: 'not-started', state: 'open', phase: 'Design', ageMinutes: null,
      waitingOn: 'click', note: ELIGIBLE_NOTE, verdict: 'eligible',
      branchUrl: `${GH}feature/ghost-ready`, startability: 'start-work',
    }),
  ];
  return {
    board: board({
      columns: [column({
        phase: 'Development',
        cards: [
          card({ slug: 'beans', title: 'Beans', path: `docs/plans/${BEANS_FILE}` }),
          card({ slug: 'plant-tomatoes', title: 'Plant tomatoes', path: `docs/plans/${TOMS_FILE}` }),
        ],
      })],
      // The estate can dispatch, so a startable row's button is enabled rather
      // than disabled for a reason the test did not ask for.
      dispatch: { available: true, reason: '' },
    }),
    fleet: fleet({ rows }),
  };
};

/**
 * The same estate, on a board that can do NOTHING.
 *
 * Every act left at the schema's `available: false`, which the board's own
 * default already is — so this scenario states it rather than inheriting it,
 * because the claim *"no action before the board has said whether it can
 * dispatch"* is about a board that answered NO, not about one that has not
 * answered yet. Those render the same and mean different things.
 *
 * A test asserting an ABSENT board — one that aborts `/api/board` — layers
 * `page.route` over this, the way `unreachable-overlay` does. The catalogue
 * cannot serve a board that will not answer; that is the one thing it cannot do
 * and the plan says so.
 */
const anEstateThatCannotAct = (): Scenario => {
  const built = aFullEstate();
  return { board: board({ columns: built.board.columns }), fleet: built.fleet };
};

/**
 * A plan whose branches divide into waves, one wave per section.
 *
 * `a-done-wave` and `an-eligible-wave` each hold ONE wave, so neither can state
 * what a plan with several looks like — which wave heads which group, and
 * whether a wave's own verdict survives the section it lands in. This holds
 * three at once: complete, eligible, blocked.
 *
 * `planWaveCount` is 3 on every wave here rather than the builder's default of
 * 2, because a wave row renders *"wave 1 of N"* from it, and a scenario whose
 * waves disagree with their own count is a fixture bug rather than a state.
 */
const aPlanInWaves = (): Scenario => {
  const rows = [
    row({
      plan: 'six-waves', planFile: SIX_WAVES_FILE, branch: 'feature/first-wave',
      kind: 'wave', wave: 'Foundations', verdict: 'complete', state: 'merged',
      group: 'done', ageMinutes: 400, branchUrl: '',
    }),
    row({
      plan: 'six-waves', planFile: SIX_WAVES_FILE, branch: 'feature/second-wave',
      kind: 'wave', wave: 'Building', verdict: 'eligible', state: 'open',
      group: 'not-started', ageMinutes: null, waitingOn: 'click',
      note: ELIGIBLE_NOTE, waitingDays: 3, startability: 'start-work',
      branchUrl: `${GH}feature/second-wave`,
    }),
    row({
      plan: 'six-waves', planFile: SIX_WAVES_FILE, branch: 'feature/third-wave',
      kind: 'wave', wave: 'Finishing', verdict: 'blocked', state: 'open',
      group: 'not-started', ageMinutes: null, waitingOn: 'time',
      blockedBy: 'Building', waitingDays: 3, startability: null,
      branchUrl: `${GH}feature/third-wave`,
    }),
  ];
  return {
    board: board({
      columns: [column({
        phase: 'Development',
        cards: [card({ slug: 'six-waves', title: 'Six waves', path: `docs/plans/${SIX_WAVES_FILE}` })],
      })],
      dispatch: { available: true, reason: '' },
    }),
    fleet: fleet({
      rows,
      waves: [
        wave({ plan: 'six-waves', name: 'Foundations', branches: ['feature/first-wave'], verdict: 'complete', section: 'done', complete: true, planWaveCount: 3 }),
        wave({ plan: 'six-waves', name: 'Building', branches: ['feature/second-wave'], verdict: 'eligible', section: 'not-started', complete: false, planWaveCount: 3 }),
        wave({ plan: 'six-waves', name: 'Finishing', branches: ['feature/third-wave'], verdict: 'blocked', section: 'not-started', complete: false, planWaveCount: 3 }),
      ],
    }),
  };
};

/**
 * One row of every KIND the scan can emit.
 *
 * `RowKindSchema` has eight members and the tab renders each differently. The
 * state exists because `wave-leaves-the-kind-alone.browser.test.ts` reads the
 * real mock pulse for exactly this — the one file in the Survey's lift-and-shift
 * group that routes no `/api/fleet` and so needs a NAMED state rather than a
 * swapped opener.
 *
 * Every row sits in `working`, so the kinds are compared under one section
 * rather than scattered across six: the claim is that the WAVE kind leaves the
 * others alone, and a difference between two sections cannot show that.
 */
const oneRowPerKind = (): Scenario => ({
  board: board({
    columns: [column({
      phase: 'Development',
      cards: [card({ slug: 'every-kind', title: 'Every kind', path: `docs/plans/${KINDS_FILE}` })],
    })],
  }),
  fleet: fleet({
    rows: KINDS.map((kind) => row({
      kind,
      plan: 'every-kind', planFile: KINDS_FILE,
      branch: `feature/${kind}-row`, branchUrl: `${GH}feature/${kind}-row`,
      wave: 'Kinds', ageMinutes: 30,
    })),
    waves: [wave({
      plan: 'every-kind', name: 'Kinds', section: 'working',
      branches: KINDS.map((kind) => `feature/${kind}-row`),
      verdict: 'eligible', complete: false,
    })],
  }),
});

/**
 * A board of cards across every phase, and nothing on the fleet.
 *
 * The BOARD-side counterpart to `a-full-estate`: five columns, a card in each,
 * a sprint and a story — enough that a layout assertion has something to lay
 * out and a filter has something to filter. The fleet is empty on purpose, so a
 * test about the Plans tab is not also asserting an estate it never mentions.
 *
 * This is the state the four `/api/board` readers in the Survey's third table
 * need: `tiny-garden` (layout at phone width, the sprint filter),
 * `story-overlay` (a card carrying a story), `plan-source` and `branch-served`
 * (which override one field each, and are the ratio gate's easiest cases).
 */
const aBoardOfPlans = (): Scenario => ({
  board: board({
    columns: BOARD_PHASES.map((phase, i) => column({
      phase,
      cards: [card({
        slug: `plan-${i}`, title: `Plan ${i} in ${phase}`,
        path: `docs/plans/2026-08-24-plan-${i}.md`,
        phase, phaseDate: '2026-08-24',
        sprint: i % 2 === 0 ? 'a-sprint' : undefined,
        story: i === 0 ? 'a-story' : undefined,
      })],
    })),
  }),
  fleet: fleet(),
});

/** An empty estate — no plans, no rows. What the board shows a fresh repo. */
const anEmptyEstate = (): Scenario => ({ board: board(), fleet: fleet() });

/**
 * The catalogue itself.
 *
 * Each entry is a FUNCTION, so every `open()` gets a fresh payload and one
 * test's override cannot reach another's. A shared frozen object would be
 * cheaper and would couple every test in the suite to whichever ran first.
 *
 * ## Reading the list
 *
 * Two families, and a name says which it is in. The FLEET states — `a-done-wave`
 * through `one-row-per-kind` — describe an estate; the BOARD state describes
 * what the Plans tab shows. `an-empty-estate` is both, and is what a fresh repo
 * looks like.
 *
 * ## The ratio gate reads this list against the tests that use it
 *
 * The plan makes the count a gate: after the second migrating slice, if the
 * average test overrides more than half the payload, these names mean nothing
 * and the catalogue is re-cut before the third slice starts. That measurement
 * needs the overrides VISIBLE PER TEST — `open('a-full-estate', { over: … })`
 * at the call site, never folded into a local helper that hides how much of the
 * state a test replaced.
 */
export const SCENARIOS = {
  'a-done-wave': aDoneWave,
  'an-eligible-wave': anEligibleWave,
  'a-full-estate': aFullEstate,
  'an-estate-that-cannot-act': anEstateThatCannotAct,
  'a-plan-in-waves': aPlanInWaves,
  'one-row-per-kind': oneRowPerKind,
  'a-board-of-plans': aBoardOfPlans,
  'an-empty-estate': anEmptyEstate,
} satisfies Record<string, () => Scenario>;

/** Every name the catalogue serves. */
export type ScenarioName = keyof typeof SCENARIOS;

/**
 * Build a named scenario, with optional overrides applied to the top-level
 * payloads.
 *
 * The override is deliberately SHALLOW and deliberately typed as the parsed
 * payloads: a test that wants a different row list supplies one built from the
 * same `row()` builder, rather than patching a field into a payload nobody
 * re-validates. Deep-merging would let a test write a shape the schema has never
 * seen, which is the drift this catalogue exists to stop.
 */
export const scenario = (
  name: ScenarioName,
  over: Partial<Scenario> = {},
): Scenario => {
  const built = SCENARIOS[name]();
  return { board: over.board ?? built.board, fleet: over.fleet ?? built.fleet };
};
