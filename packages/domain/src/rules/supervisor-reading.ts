/**
 * Whether anything supervises this fleet, and whether that is worth an alarm.
 *
 * The defect this answers, measured 2026-09-07: `plot-fleetctl.sh --status`
 * reported `supervisor=down` while six workers ran 23–25 hours against an
 * 8-hour `Worker bound`. All six were spent — PR merged, tree clean,
 * `PLOT-BLOCKED.md` written — and the board showed six rows that looked exactly
 * like six healthy ones, because it carried no supervisor field at all.
 *
 * `plot-fleetctl.sh --status` is the ONE source. Its exit code is the contract
 * — 0 loaded, 1 not — and a second implementation reading a pidfile, a process
 * name or `launchctl` would drift toward *looks fine*, which is the direction
 * nobody notices and the whole defect.
 */

/**
 * What the board knows about the supervisor.
 *
 * THREE STATES, AND `unknown` IS THE ONE THIS RULE EXISTS FOR. A board that
 * could not ask must render neither: `down` is an alarm nobody can act on, and
 * `up` is the failure being removed. `plot-board-probe.sh` already takes this
 * shape for auth — `ok`/`failed`/`unknown`, where an unrecognised output reads
 * as *cannot verify*, never as authenticated.
 *
 * - `up` — the script answered that the supervisor is loaded.
 * - `down` — the script answered that it is not.
 * - `unknown` — the script could not be asked, or did not finish answering.
 */
export type SupervisorState = 'up' | 'down' | 'unknown';

/**
 * What one run of `plot-fleetctl.sh --status` left behind.
 *
 * SEPARATE FROM THE AGENT COUNT, and the split follows the two clocks. Asking
 * the script costs 0.46–1.42 s measured on this machine, so it happens once per
 * refresh; the agent count is re-derived on every render. Folding them into one
 * record would pin the count to whenever the script was last asked, and a
 * warning is exactly the combination of a stale state with a current count.
 */
export interface SupervisorRun {
  /**
   * Whether the script could be run at all.
   *
   * `false` where the file is absent, the process could not be spawned, or the
   * call timed out. It is a separate reading from {@link SupervisorRun.exitCode}
   * because a killed process reports a code that is indistinguishable from a
   * real answer: `execFile` maps a `SIGTERM` timeout to code 1, which is the
   * script's own word for *not loaded*. Deriving the state from the code alone
   * would render `down` from a call that never completed.
   */
  asked: boolean;
  /**
   * The script's exit code, or `null` where it produced none.
   *
   * 0 and 1 are answers; anything else is not. A missing script exits 127
   * through `bash`, and no code at all is a spawn that failed.
   */
  exitCode: number | null;
  /**
   * Whether the run reached its own `summary:` line.
   *
   * `--status` prints `summary: ... supervisor=up|down` last, so its presence
   * is what separates a script that finished from one killed at a bounded wait.
   * Read as the CORROBORATION of the exit code and never as a substitute for
   * it: the code is the contract, this says the code was the script's and not
   * a signal's.
   */
  summarised: boolean;
}

/**
 * What the whole rule reads — the run, plus how many agents are running.
 *
 * The agent count is already on the board, and it is the second half of the
 * prominence rule. The state alone is decoration; the combination is what makes
 * it actionable.
 */
export interface SupervisorReadings extends SupervisorRun {
  /** How many agents this fleet is running, counted on the render clock. */
  agentsRunning: number;
}

/**
 * How loudly the board should say what it read.
 *
 * FOUR LEVELS, AND `alert` IS THE ONE A CHIP CANNOT CARRY. Measured
 * 2026-09-09: the fleet was stopped, three agents sat idle 44–57 minutes with
 * merged PRs, an eligible slice went untaken, and the board printed the correct
 * sentence in a grey chip appended to a stepper's status line. A person read it
 * for an hour and did not act. The words were right; the weight was not.
 *
 * - `quiet` — nothing is being neglected. `up` at any agent count, and `down`
 *   with none.
 * - `note` — `unknown`. Worth saying and never an alarm, because the board's
 *   own inability to ask is not a fact about the fleet.
 * - `warn` — a chip's worth of concern. No supervisor reading produces it
 *   today; it stays because prominence is a scale and the level between a note
 *   and an alert is a real one a later state may need.
 * - `alert` — `down` while agents run. Every one of them is unreapable, so this
 *   is work not happening, and it earns the top of the section rather than the
 *   end of a status line.
 *
 * SEPARATE FROM `ChecksProminence`, which has the same three original members
 * and its own five states (`rules/checks-reading.ts`). Widening this one does
 * not touch that one, and unifying them would tie a build's badge to a fleet's
 * alert.
 */
export type SupervisorProminence = 'quiet' | 'note' | 'warn' | 'alert';

/**
 * What the board renders about the supervisor.
 *
 * The state, its prominence and its sentence travel together, so a caller
 * cannot pair one reading's word with another's styling. That pairing is what
 * a `.tsx` would re-derive, and re-deriving it is how a view state comes to be
 * testable only by rendering it.
 */
export interface SupervisorVerdict {
  /** What the supervisor is. */
  state: SupervisorState;
  /** How loudly to say it. */
  prominence: SupervisorProminence;
  /** Whether it is worth saying at all. */
  shown: boolean;
  /** The label a badge prints. */
  label: string;
  /** The sentence a title attribute carries. */
  detail: string;
}

/**
 * What the readings say the supervisor is.
 *
 * THE EXIT CODE IS THE CONTRACT AND THE SUMMARY LINE PROVES IT WAS THE
 * SCRIPT'S. Exit 0 is `up`, exit 1 is `down`, and every other outcome —
 * a code that is neither, no code at all, a call that could not be made, or a
 * run that stopped before its own last line — is `unknown`.
 *
 * The asymmetry is deliberate and is the plan's central rule: silence must not
 * become `down`. A bounded call that times out reports code 1 through
 * `execFile`, so a rule reading the code alone would render an alarm from a
 * board that never got an answer.
 *
 * @param readings - what one run of the script left behind.
 * @returns which of the three states this was.
 */
export const supervisorState = (readings: SupervisorRun): SupervisorState => {
  if (!readings.asked) return 'unknown';
  if (!readings.summarised) return 'unknown';
  if (readings.exitCode === 0) return 'up';
  if (readings.exitCode === 1) return 'down';
  return 'unknown';
};

/**
 * How loudly to say it — the rule that combines the state with the agent count.
 *
 * `down` WITH NO AGENTS IS A QUIET FACT. Nothing is being neglected, and a
 * board that shouted about it would train its reader to ignore the case that
 * matters. `down` with one or more agents running is the measured failure: six
 * spent workers nobody was going to reap.
 *
 * That case answers `alert` and not `warn`, and the difference is the level a
 * chip cannot carry. `unknown` stays a `note` however many agents run: *I could
 * not ask* is a reading about the board, and alerting on it teaches an operator
 * to dismiss the alert that matters.
 *
 * @param readings - what was read of the script and of the fleet.
 * @returns quiet, a note, or an alert.
 */
export const supervisorProminence = (readings: SupervisorReadings): SupervisorProminence => {
  const state = supervisorState(readings);
  if (state === 'unknown') return 'note';
  if (state === 'down' && readings.agentsRunning > 0) return 'alert';
  return 'quiet';
};

/**
 * Whether the board says anything at all about the supervisor.
 *
 * SILENT WHEN THE NEWS IS GOOD, the shape the `registry` annotation beside it
 * already uses: it renders only when the manifest count is zero or something
 * was synthesized. A supervisor that is up is the ordinary state and needs no
 * word; `down` and `unknown` are both worth one, because both mean an agent
 * that finishes will sit there.
 *
 * @param readings - what one run of the script left behind.
 * @returns true when there is something worth saying.
 */
export const supervisorShown = (readings: SupervisorRun): boolean =>
  supervisorState(readings) !== 'up';

/**
 * The whole verdict — state, prominence, and the two pieces of text.
 *
 * ONE CALL RATHER THAN FOUR, so a renderer takes the word and the styling from
 * one reading of one set of facts. A component that asked for the state and
 * then decided its own colour would be the decision-in-a-`.tsx` this package's
 * layering rule forbids.
 *
 * EVERY LABEL SAYS FLEET, AND THAT IS THE VOCABULARY THE ESTATE TEACHES.
 * A person types `/plot-fleet --start`, `/plot-fleet --status` and
 * `/plot-fleet --stop`. There is no `/plot-supervisor` command, no skill by
 * that name, and nothing a reader can address — so a badge reading
 * `unsupervised` named a component its own repair sentence did not.
 * `plot-registryd.mjs`, the launchd label `com.plot-pm.registryd` and the
 * internal state `up` describe one process in three machine-side vocabularies,
 * and the board is the one surface where a reader should meet none of them.
 * Those words stay correct where a machine reads them — `plot-fleetctl.sh` and
 * `DESIGN-process.md` are unchanged.
 *
 * THE LABEL NAMES THE CONSEQUENCE, NOT THE CONDITION. *Fleet stopped — no
 * slice will be picked up* is what a reader decides about; `unsupervised` named
 * a component and left the consequence to be derived, which is what a person
 * failed to do for an hour on 2026-09-09.
 *
 * The `unknown` sentence names the board rather than the fleet: *could not be
 * asked* is a fact about this reading, and phrasing it as a fact about the
 * supervisor is exactly the confusion the third state exists to prevent. Its
 * label says so too — *fleet status unknown* is a question the board could not
 * answer, and it is deliberately not the same words as *fleet stopped*.
 *
 * @param readings - what was read of the script and of the fleet.
 * @returns what to render, and whether to render it.
 */
export const supervisorVerdict = (readings: SupervisorReadings): SupervisorVerdict => {
  const state = supervisorState(readings);
  const prominence = supervisorProminence(readings);
  const agents = readings.agentsRunning;
  if (state === 'up') {
    return {
      state,
      prominence,
      shown: false,
      label: 'fleet running',
      detail: 'The fleet is supervised — finished desks are reaped and spent agents are marked.',
    };
  }
  if (state === 'unknown') {
    return {
      state,
      prominence,
      shown: true,
      label: 'fleet status unknown',
      detail:
        'The board could not ask `/plot-fleet --status`, so whether the fleet is running was never established. This is not the same fact as it being stopped.',
    };
  }
  return {
    state,
    prominence,
    shown: true,
    label: 'FLEET STOPPED',
    detail:
      agents > 0
        ? `The fleet is stopped, and ${agents} agent${agents === 1 ? '' : 's'} ${agents === 1 ? 'is' : 'are'} running. No slice will be picked up, and nothing reaps a finished desk or marks a spent one. Start it: /plot-fleet --start`
        : 'The fleet is stopped. No agent is running, so nothing is being neglected, but no slice will be picked up either. Start it: /plot-fleet --start',
  };
};
