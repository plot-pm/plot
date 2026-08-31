import { board, card, column, fleet, row, wave } from './build.js';
import type { Board, Fleet } from '../../src/contract/schema.js';

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

/** An empty estate — no plans, no rows. What the board shows a fresh repo. */
const anEmptyEstate = (): Scenario => ({ board: board(), fleet: fleet() });

/**
 * The catalogue itself.
 *
 * Each entry is a FUNCTION, so every `open()` gets a fresh payload and one
 * test's override cannot reach another's. A shared frozen object would be
 * cheaper and would couple every test in the suite to whichever ran first.
 */
export const SCENARIOS = {
  'a-done-wave': aDoneWave,
  'an-eligible-wave': anEligibleWave,
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
