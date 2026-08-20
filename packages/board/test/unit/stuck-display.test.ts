import { describe, it, expect } from 'vitest';
import {
  stuckWord,
  stuckEvidence,
  offersAction,
  showsCue,
  actionReachable,
  changedFilesLabel,
  offersChangedFiles,
} from '../../src/app/components/AgentList.js';
import {
  StuckStateSchema, BOARD_ARTIFACT_PATH,
  type Card, type DispatchInfo, type Stuck, type StuckState,
} from '../../src/contract/schema.js';

/**
 * WHAT A STUCK ROW SAYS — the decision half, asserted without a page.
 *
 * Wave 1 landed the detection and put `stuck` on the row; measured on `main`,
 * `AgentList.tsx` rendered zero of it. This file owns the mapping from that
 * field to what the row states: which word, which evidence, whether an action
 * is offered, and whether the cue is showing. Vitest runs with
 * `environment: 'node'` here, and the recent waves' practice is to put the
 * decision in exported pure functions and assert those — the browser suite is
 * left the things that genuinely need a page (`motion-reduce`, `aria-hidden`,
 * the non-localhost refusal).
 */

const stuck = (over: Partial<Stuck> = {}): Stuck => ({
  state: 'conflict',
  conflicts: [],
  localAhead: 0,
  changedPaths: [],
  failingChecks: [],
  runHistory: [],
  ...over,
});

/** Every state the contract declares, so a fifth one cannot slip past. */
const ALL_STATES = StuckStateSchema.options as readonly StuckState[];

/**
 * The reference instant every age in this file is measured against.
 *
 * INJECTED rather than read from the clock, which is the whole reason
 * `stuckEvidence` takes a `now` at all: an age asserted against the real clock
 * either races it or has to be matched with a loose pattern, and a loose
 * pattern is what let a raw ISO string sit in the row unnoticed.
 */
const NOW = Date.parse('2026-08-20T05:55:23Z');

describe('stuckWord — four states, four words', () => {
  it('names all four distinctly', () => {
    // The defect this exists against: *stuck* as ONE label is the
    // one-label-many-states shape the board keeps removing. Two states sharing
    // a word passes any assertion that only checks "the row says something".
    const words = ALL_STATES.map(stuckWord);
    expect(new Set(words).size).toBe(ALL_STATES.length);
    expect(words.every((w) => w.length > 0)).toBe(true);
  });

  it('keeps artifact-conflict and conflict apart', () => {
    // Not degrees of one thing: the first has a resolution a rebuild and a CI
    // no-diff gate can prove, the second does not. A reader who cannot tell
    // them apart cannot tell which errand is theirs.
    expect(stuckWord('artifact-conflict')).not.toBe(stuckWord('conflict'));
  });
});

describe('stuckEvidence — the evidence travels WITH the state', () => {
  it('gives a conflict its conflicting paths', () => {
    // A row that says *conflict* and makes the reader go find out where has
    // moved the ten minutes of log-reading rather than removed it.
    const lines = stuckEvidence(stuck({
      state: 'conflict',
      conflicts: ['packages/board/src/app/App.tsx', 'docs/plans/a.md'],
    }));
    expect(lines.join(' ')).toContain('packages/board/src/app/App.tsx');
    expect(lines.join(' ')).toContain('docs/plans/a.md');
  });

  it('carries the artifact path on an artifact conflict', () => {
    // The set travels with the answer so a reader can COUNT it rather than
    // trust the classification — *exactly the artifact* is a claim about a set.
    const lines = stuckEvidence(stuck({
      state: 'artifact-conflict', conflicts: [BOARD_ARTIFACT_PATH],
    }));
    expect(lines.join(' ')).toContain(BOARD_ARTIFACT_PATH);
  });

  it('says the host reported no file list when the conflict set is empty', () => {
    // A host-declared conflict carries no set — see `stuckState`. Rendering
    // nothing there would leave the row saying *conflict* with no evidence at
    // all, which is exactly the shape the contract forbids.
    const lines = stuckEvidence(stuck({ state: 'conflict', conflicts: [] }));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(' ')).toMatch(/does not merge/);
  });

  it('gives a CI failure TWO lines: the step, and the run history', () => {
    // TWO, not three. The changed-file list left the row for the menu — see
    // the block below. What stays is what a reader ACTS on: which step failed,
    // and how the branch has fared lately. Nothing here compares them — a
    // heuristic mapping failing steps to changed paths was rejected as a table
    // nobody maintains.
    const lines = stuckEvidence(stuck({
      state: 'ci-failing',
      failingChecks: ['Install Playwright browser'],
      changedPaths: ['docs/plans/a.md'],
      runHistory: [
        { workflow: 'validate', conclusion: 'failure', startedAt: '2026-08-20T03:55:23Z', url: 'u2' },
        { workflow: 'validate', conclusion: 'success', startedAt: '2026-08-20T03:53:23Z', url: 'u1' },
      ],
    }), NOW);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Install Playwright browser');
    // Both runs, so the reader can see the same branch was green two minutes
    // earlier — the line that decided the 2026-08-17 case.
    expect(lines[1]).toContain('success');
    expect(lines[1]).toContain('failure');
  });

  it('NAMES THE STEP on the row — the fact that often ends the investigation', () => {
    // *CI failed* sends a reader to the Actions tab; *CI failed — step: Install
    // Playwright browser* often ends it there. This is the one line the spec
    // keeps on the row by name, so it is asserted on its own rather than only
    // as `lines[0]` of a shape assertion that a reordering would still pass.
    const lines = stuckEvidence(stuck({
      state: 'ci-failing', failingChecks: ['validate'],
    }), NOW);
    expect(lines.some((l) => /step: validate/.test(l))).toBe(true);
  });

  describe('the run time is an AGE, never an ISO string', () => {
    // The measured defect: `#266` carried a raw `2026-08-20T03:55:23Z` in the
    // row, as prose. A reader deciding whether a failure is fresh has to do
    // date arithmetic to use it — and the row already prints every other
    // duration as an age, so this one read as a foreign element.
    it('renders the run time as an age', () => {
      const lines = stuckEvidence(stuck({
        state: 'ci-failing',
        runHistory: [
          { workflow: 'validate', conclusion: 'failure', startedAt: '2026-08-20T03:55:23Z', url: 'u' },
        ],
      }), NOW);
      // Two hours before NOW, so the age is the carrier and the instant is not.
      expect(lines.join(' ')).toContain('2h ago');
    });

    it('prints no ISO 8601 anywhere in the evidence', () => {
      // The GATE, and the reason it is separate from the assertion above: an
      // implementation that appends an age BESIDE the raw timestamp passes
      // "contains 2h ago" while still dumping the string the defect is about.
      const lines = stuckEvidence(stuck({
        state: 'ci-failing',
        failingChecks: ['validate'],
        changedPaths: ['packages/board/src/app/components/AgentList.tsx'],
        runHistory: [
          { workflow: 'validate', conclusion: 'failure', startedAt: '2026-08-20T03:55:23Z', url: 'u2' },
          { workflow: 'validate', conclusion: 'success', startedAt: '2026-08-20T01:55:23Z', url: 'u1' },
        ],
      }), NOW);
      expect(lines.join(' ')).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('omits the time rather than printing Invalid Date where it cannot be read', () => {
      // An unparseable timestamp is one more unrecognised field. The run still
      // reports its conclusion — that fact WAS given — and only the time it
      // could not read goes missing.
      const lines = stuckEvidence(stuck({
        state: 'ci-failing',
        runHistory: [{ workflow: 'validate', conclusion: 'failure', startedAt: 'not a date', url: 'u' }],
      }), NOW);
      expect(lines.join(' ')).toContain('failure');
      expect(lines.join(' ')).not.toContain('Invalid Date');
      expect(lines.join(' ')).not.toContain('NaN');
    });
  });

  describe('the changed-file list is BEHIND THE MENU, not in the row', () => {
    // The measured defect: `#266` carried a wrapped list of six changed files
    // in the row, as prose — every reader scrolling past it so the one reader
    // who wanted it did not have to click. The spec moves it to the menu, where
    // it costs a click instead of a column.
    it('keeps the changed paths out of the row evidence', () => {
      const lines = stuckEvidence(stuck({
        state: 'ci-failing',
        failingChecks: ['validate'],
        changedPaths: ['packages/board/src/server/fleet.ts', 'docs/plans/a.md'],
      }), NOW);
      expect(lines.join(' ')).not.toContain('packages/board/src/server/fleet.ts');
      expect(lines.join(' ')).not.toContain('docs/plans/a.md');
    });

    it('does not report the paths as UNAVAILABLE either', () => {
      // The line went to the menu; it did not become a placeholder. A row
      // saying *changed paths unavailable* would be the same width of prose
      // making a weaker statement — and it would be false, since the paths are
      // right there in the menu.
      const lines = stuckEvidence(stuck({ state: 'ci-failing' }), NOW);
      expect(lines.join(' ')).not.toContain('changed paths');
    });

    it('offers the menu item where there are paths to show', () => {
      expect(offersChangedFiles(stuck({
        state: 'ci-failing', changedPaths: ['a.ts'],
      }))).toBe(true);
    });

    it('offers NO item where the host gave no paths', () => {
      // `changedPaths: []` is *no list available* — an older adapter, or a host
      // carrying none. An item opening onto nothing is the empty menu this
      // board keeps removing, so the absence is the honest answer.
      expect(offersChangedFiles(stuck({ state: 'ci-failing', changedPaths: [] }))).toBe(false);
    });

    it('offers no item on a state that has no changed-path evidence', () => {
      // `changedPaths` is populated on `ci-failing` alone. The other three
      // carry `[]` by construction (`noCiEvidence`), and an item keyed on the
      // array alone would be right today and wrong the first time a conflict
      // row gained one.
      for (const state of ALL_STATES.filter((s) => s !== 'ci-failing')) {
        expect(offersChangedFiles(stuck({ state, changedPaths: ['a.ts'] })),
          `${state} offered a changed-file list`).toBe(false);
      }
    });

    it('COUNTS the files in its label rather than listing them', () => {
      // The menu item is one line, so it says how many there are and the panel
      // says which — the same split the row and the menu already use. A label
      // that listed them would put the dump back one click away.
      expect(changedFilesLabel(2)).toContain('2');
      expect(changedFilesLabel(1)).toMatch(/1 file(?!s)/);
      expect(changedFilesLabel(6)).toMatch(/6 files/);
    });
  });

  it('reports an empty CI evidence field as unavailable, never as nothing failed', () => {
    // `failingChecks: []` is *no names available* (an older adapter, a host
    // with no rollup) and `runHistory: []` is *Bitbucket has no run listing* —
    // never *this branch has never failed before*. Silence would be the row
    // asserting a fact it was never given.
    //
    // TWO of these now, not three: the changed-path line left for the menu, and
    // it took its own *unavailable* with it — see the block below for why that
    // absence is not the same omission this test guards against.
    const lines = stuckEvidence(stuck({ state: 'ci-failing' }), NOW);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => /unavailable/.test(l))).toBe(true);
  });

  it('gives unpushed work its commit count', () => {
    expect(stuckEvidence(stuck({ state: 'unpushed', localAhead: 3 })).join(' '))
      .toContain('3 commits');
    // One commit is not "1 commits".
    expect(stuckEvidence(stuck({ state: 'unpushed', localAhead: 1 })).join(' '))
      .toContain('1 commit only');
  });

  it('leaves no state without evidence', () => {
    // The pairing that matters: an implementation that names the state and
    // stops passes every "is the state visible" assertion and pays off none of
    // the cost this detection exists to remove.
    for (const state of ALL_STATES) {
      expect(stuckEvidence(stuck({ state, localAhead: 1 })).length,
        `${state} rendered no evidence`).toBeGreaterThan(0);
    }
  });
});

describe('offersAction — only two of the four', () => {
  it('offers nothing for unpushed work', () => {
    // The fix is a push, and pushing someone else's uncommitted judgement is
    // not a mechanical act. Reported in words, and that is the whole treatment.
    expect(offersAction('unpushed')).toBe(false);
  });

  it('offers nothing for an artifact conflict in this wave', () => {
    // Wave 3 resolves it — the only automatic write this plan ever grants.
    // Offering an action here would be this wave building what it is fenced
    // away from.
    expect(offersAction('artifact-conflict')).toBe(false);
  });

  it('offers an action for a conflict and for a failing check', () => {
    expect(offersAction('conflict')).toBe(true);
    expect(offersAction('ci-failing')).toBe(true);
  });
});

describe('showsCue — motion marks an unanswered request', () => {
  // `showsCue` takes REACHABILITY rather than a state, because a state that
  // usually offers an action is not the same claim as a row that actually does
  // — see `actionReachable` and the suite below it. These helpers say which row
  // each assertion is about, and keep every claim this block already made.
  const CARD = {} as Card;
  const DISPATCH = {} as DispatchInfo;
  const reachable = (state: StuckState) =>
    actionReachable(
      stuck({ state, runHistory: [{ workflow: 'CI', conclusion: 'failure', startedAt: '', url: 'https://run' }] }),
      CARD,
      DISPATCH,
    );

  it('shows no cue where no action is offered', () => {
    // A cue on every row makes the stuck ones invisible, and a branch with
    // nothing to offer has made no request.
    expect(showsCue(reachable('unpushed'), false)).toBe(false);
    expect(showsCue(reachable('artifact-conflict'), false)).toBe(false);
  });

  it('shows the cue on a row with a waiting action', () => {
    expect(showsCue(reachable('conflict'), false)).toBe(true);
    expect(showsCue(reachable('ci-failing'), false)).toBe(true);
  });

  it('clears the cue when the action is TAKEN, not when the branch unsticks', () => {
    // The request has been answered; whether the answer worked is what the
    // row's other marks report. A cue tied to the branch's own recovery keeps
    // moving through the whole repair, at the reader who already did the one
    // thing it was asking for — and it passes every "the cue animates"
    // assertion while doing so.
    expect(showsCue(reachable('conflict'), true)).toBe(false);
    expect(showsCue(reachable('ci-failing'), true)).toBe(false);
  });

  it('never lets a taken action revive a state that offers none', () => {
    // Both bounds hold independently: taking is not what suppresses `unpushed`.
    expect(showsCue(reachable('unpushed'), true)).toBe(false);
  });
});

describe('actionReachable — the ROW, not the state', () => {
  const CARD = {} as Card;
  const DISPATCH = {} as DispatchInfo;
  const withRun = (state: StuckState) => stuck({
    state,
    runHistory: [{ workflow: 'CI', conclusion: 'failure', startedAt: '', url: 'https://run' }],
  });

  // THE DEFECT THIS EXISTS AGAINST, found in a screenshot of the running board:
  // the amber `animate-ping` dot sat immediately before the words *no dispatch
  // available for this plan*. Motion marks an UNANSWERED REQUEST, and where
  // nothing can be asked there is no request — so the cue must follow what the
  // row can actually ask, not what its state usually offers. An implementation
  // keyed on the state alone passes every assertion in the block above.
  it('a conflict row with no dispatch shows the words and NO cue', () => {
    expect(actionReachable(stuck({ state: 'conflict' }), null, DISPATCH)).toBe(false);
    expect(actionReachable(stuck({ state: 'conflict' }), CARD, undefined)).toBe(false);
    expect(actionReachable(stuck({ state: 'conflict' }), null, undefined)).toBe(false);
    // And therefore no cue, which is the assertion that would have caught it.
    expect(showsCue(actionReachable(stuck({ state: 'conflict' }), null, DISPATCH), false))
      .toBe(false);
  });

  it('a failing-CI row with no run URL shows the words and NO cue', () => {
    // `[]` is *no run listing available* (Bitbucket has none), never *this
    // branch has never failed* — the row says so in words, and there is no
    // address to navigate to.
    const noUrl = stuck({ state: 'ci-failing', runHistory: [] });
    expect(actionReachable(noUrl, CARD, DISPATCH)).toBe(false);
    expect(showsCue(actionReachable(noUrl, CARD, DISPATCH), false)).toBe(false);
  });

  it('still reaches the action where the row really offers one', () => {
    expect(actionReachable(withRun('conflict'), CARD, DISPATCH)).toBe(true);
    expect(actionReachable(withRun('ci-failing'), CARD, DISPATCH)).toBe(true);
  });

  // A REFUSAL IS NOT AN ABSENCE, and this is the half that must not regress.
  // Over a non-localhost binding the row still has a card and a dispatch
  // verdict: `StartWorkButton` renders disabled and NAMES the reason, so the
  // request is real and still unanswered. Hiding the cue there would let a
  // phone report a healthy fleet while branches sit stuck.
  it('keeps the cue where the action is present but REFUSED', () => {
    const refusing = { available: false, reason: 'bound to 0.0.0.0' } as unknown as DispatchInfo;
    expect(actionReachable(withRun('conflict'), CARD, refusing)).toBe(true);
    expect(showsCue(actionReachable(withRun('conflict'), CARD, refusing), false)).toBe(true);
  });

  it('never reaches an action for the two states that offer none', () => {
    expect(actionReachable(withRun('unpushed'), CARD, DISPATCH)).toBe(false);
    expect(actionReachable(withRun('artifact-conflict'), CARD, DISPATCH)).toBe(false);
  });
});
