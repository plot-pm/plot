import type { ClaimHolderAnswer } from '../rules/claim.js';
import type { ChecksFromRuns, RemoteTipReading } from '../rules/checks-verdict.js';
import type { LoopRegistration } from '../rules/desk-manifest.js';
import type { PromptExit } from '../rules/prompt-exit.js';
import type { ResetRefusal } from '../rules/reapable.js';
import type { MonitorVerdict } from '../rules/sample.js';
import type { EndingActor, EndingReason } from '../entities/ending.js';
import { type Decision, type Write, decide } from './decision.js';

/**
 * What ONE PASS of the loop asks: given what it measured, what does it write
 * next, and does it end.
 *
 * NO STATE IS CARRIED BETWEEN PASSES. Every field is re-derived by the
 * caller from the manifest, the desk and the host on every pass — the
 * property `workflows/supervise.ts` keeps, so that `kill -9` costs one pass
 * rather than a decision. `agentLoop` reads this and nothing else; it opens
 * no file, spawns no process and remembers nothing from the call before.
 *
 * **THE READINGS ARE FILLED TO MATCH WHERE THE PASS IS**, and
 * {@link agentLoop} finds out which by reading them in the table's own
 * order: an assignment first, then whether a prompt is running, then its
 * exit, then whether the CI wait has started. A reading for a place the pass
 * is not in is simply never consulted — it is read only once an earlier
 * reading has already said that place applies.
 */
export interface AgentLoopReadings {
  /**
   * Whether the manifest hands this loop a branch; `''` when it is free.
   *
   * Read first because every other reading is about a slice the agent holds,
   * and a free loop holds none.
   */
  readonly assignedBranch: string;
  /** Seconds this free wait, or this `Worker bound` window, has run so far. */
  readonly waitedSeconds: number;
  /** `Worker bound` in seconds; `0` disables the floor. */
  readonly boundSeconds: number;
  /**
   * Whether this loop's own manifest still names it, read only while
   * {@link assignedBranch} is `''` — a held slice does not ask this.
   */
  readonly registration: LoopRegistration;

  /**
   * What the branch's remote ref says about the claim, read once an
   * assignment is found and the loop is about to push it. Carried through to
   * the decision's own `detail`, the way `claimAnswer` reports it elsewhere;
   * the push itself is unconditional; whether it lands is a later pass's and
   * a performer's question.
   */
  readonly claim: ClaimHolderAnswer | null;
  /**
   * The ref a desk reset cuts the branch from when it does not exist locally:
   * `origin/<default branch>`, as the shell's `reset_desk` uses. Read at
   * take-up only.
   */
  readonly base: string;

  /**
   * Whether a prompt is running this pass, and if so, what the idle watch
   * found. `null` once the prompt has exited — the caller skips the idle
   * watch entirely rather than asking it of nothing.
   */
  readonly running: {
    /** What `idleNow` answered this pass. */
    readonly verdict: MonitorVerdict;
    /** Whether a transcript could be read at all, for the `unreadable`/`bound` split. */
    readonly transcriptReadable: boolean;
  } | null;

  /**
   * What the prompt's last exit was, once it is no longer running. `null`
   * while {@link running} is non-null, or before any prompt has run yet.
   */
  readonly exit: PromptExit | null;
  /**
   * The manifest's `attempts` field, as the shell reads it. The supervisor's
   * relaunches raise the same field, so it is not a per-slice count: an
   * `unstarted` retry writes this value plus one through `agent-attempt`, and
   * a caller that passes anything but the manifest's own value moves the
   * supervisor's `MAX_ATTEMPTS` budget with it.
   */
  readonly startRetries: number;
  /** How many start retries are allowed before the loop gives up and blocks. */
  readonly maxStartRetries: number;
  /** Whether the exit's prompt wrote its own `PLOT-BLOCKED` marker. */
  readonly markerWritten: boolean;
  /** The marker's own text, for the `declaration` and `blocked-marker` writes. */
  readonly markerText: string;
  /**
   * Why this desk may not be reset — empty when nothing holds it. Read at
   * take-up and after a `ran` exit. At either point, `uncommitted-changes` or
   * `unpushed-commits` ends the loop `holding-work`. At take-up, a list that
   * names only `blocked-marker` withholds the `desk-reset` write.
   */
  readonly resetRefusals: readonly ResetRefusal[];
  /**
   * Whether the desk's `HEAD` is on the remote, read after a `ran` exit and
   * before the CI wait starts. With `false` no CI answer can come, so the
   * slice is sealed and freed with no checks wait. Once {@link checks} is
   * non-null this reading is not consulted.
   */
  readonly pushed: boolean;
  /**
   * Whether an open pull request carries the branch, read after a `ran` exit
   * and before the CI wait starts. With `false` no CI answer can come, so the
   * slice is sealed and freed with no checks wait. Once {@link checks} is
   * non-null this reading is not consulted.
   */
  readonly prOpen: boolean;

  /**
   * What the build connector and the tip reading answer for the pushed
   * commit, once a PR is open and the CI wait has started. `null` before the
   * wait has asked at all (the pass right after the push, row 12). `'none'`
   * when `Checks wait` disables the wait, which seals and frees the slice.
   */
  readonly checks: ChecksFromRuns | null;
  /** Whether the settled run passed, read only where {@link checks} is `'settled'`. */
  readonly checksPassed: boolean | null;
  /** The branch's remote tip, read every poll of the CI wait. */
  readonly tip: RemoteTipReading;
  /** How many corrections this slice has been handed. */
  readonly correctionAttempts: number;
  /** The correction budget — `Correction budget` from `## Plot Config`. */
  readonly correctionBudget: number;
  /** The PR number the checks are about, for a `blocked-marker` naming it. */
  readonly pr: number | null;
  /** The correction text to hand the agent on a failed build, already built by the caller. */
  readonly correctionText: string;
  /** The session to resume the correction in, or `''` to start a fresh worker. */
  readonly resumeId: string;

  /** The worktree this loop runs in, absolute. */
  readonly worktree: string;
  /** The session id the dispatcher minted for this agent — the manifest `assignment-clear` lands in. */
  readonly session: string;
}

/** What `agentLoop` reports beyond its writes. */
export interface AgentLoopDetail {
  /** The branch this pass decided about; `''` for a free loop. */
  readonly branch: string;
  /** The exit code a performer gives the process on this decision, or `null` while it only waits. */
  readonly exitCode: number | null;
  /** One sentence naming what this pass decided, for the log. */
  readonly note: string;
}

/** A decision that only waits: no writes, no ending. */
const wait = (branch: string, note: string): Decision<AgentLoopDetail> =>
  decide('agent-loop', [], { branch, exitCode: null, note });

/** A decision that ends the loop, with its `loop-end` write appended last. */
const end = (
  worktree: string,
  branch: string,
  reason: EndingReason,
  actor: EndingActor,
  detail: string,
  exitCode: number,
  writes: readonly Write[] = [],
): Decision<AgentLoopDetail> =>
  decide(
    'agent-loop',
    [...writes, { kind: 'loop-end', worktree, branch, reason, actor, detail, exitCode }],
    { branch, exitCode, note: detail },
  );

/** A `declaration` write with `status: 'blocked'`, as every person-waiting ending also writes. */
const blockedDeclaration = (worktree: string, branch: string, summary: string): Write => ({
  kind: 'declaration',
  worktree,
  branch,
  status: 'blocked',
  summary,
});

/**
 * A decision that seals the slice and frees the loop: `declaration` ok, the
 * slice's spend, and the manifest's assignment cleared.
 */
const seal = (worktree: string, branch: string, session: string, note: string): Decision<AgentLoopDetail> =>
  decide(
    'agent-loop',
    [
      { kind: 'declaration', worktree, branch, status: 'ok', summary: '' },
      { kind: 'slice-spend', branch, worktree },
      { kind: 'assignment-clear', session },
    ],
    { branch, exitCode: null, note },
  );

/**
 * ROWS 13-15 — the CI wait settled. `checksPassed` is read only here, where
 * `checksFromRuns` has already answered `'settled'`.
 *
 * @param readings - this pass's readings.
 * @param branch - the branch the slice is on.
 * @returns the seal on a pass, a correction while budget is left, and a
 *   `blocked` ending once it is spent.
 */
const settled = (readings: AgentLoopReadings, branch: string): Decision<AgentLoopDetail> => {
  const { worktree } = readings;
  if (readings.checksPassed === true) {
    // ROW 13 — checks pass: declare ok, record the spend, clear the
    // assignment, then the loop is free again.
    return seal(worktree, branch, readings.session, 'checks passed');
  }

  if (readings.correctionAttempts < readings.correctionBudget) {
    // ROW 14 — checks fail, correction budget left.
    return decide(
      'agent-loop',
      [
        {
          kind: 'agent-resume',
          branch,
          worktree,
          resumeId: readings.resumeId,
          correction: readings.correctionText,
        },
        { kind: 'correction-count', worktree, correctionAttempts: readings.correctionAttempts + 1 },
      ],
      { branch, exitCode: null, note: `correction ${readings.correctionAttempts + 1}` },
    );
  }

  // ROW 15 — checks fail, budget spent.
  const prText = readings.pr === null ? 'its PR' : `PR #${readings.pr}`;
  const question = `PLOT-BLOCKED: \`${branch}\`'s checks failed after ${readings.correctionAttempts} corrections against ${prText} — a person decides what to do next.`;
  return end(worktree, branch, 'blocked', 'agent', 'correction budget spent', 0, [
    { kind: 'blocked-marker', worktree, branch, question },
    blockedDeclaration(worktree, branch, `${readings.correctionAttempts} corrections spent, checks still failing`),
  ]);
};

/**
 * Decides one pass of an agent's loop: what it writes next, and whether it
 * ends.
 *
 * THE TABLE, IN ORDER. Each guard below is one row of
 * `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md`'s Design › Approach
 * table, read top to bottom exactly as the table lists them — the order
 * matters because later rows assume the readings earlier rows already ruled
 * out: a prompt that is running is read before its exit, because an exit
 * reading means no prompt is running; an assignment is read before anything
 * about a prompt, because a free loop runs none.
 *
 * CARRIES NO STATE. Every branch below reads only {@link AgentLoopReadings};
 * nothing here is remembered from a previous call, which is what makes
 * `kill -9` between two passes cost exactly one pass. A test asserts that no
 * write this function ever returns carries a loop state.
 *
 * **EVERY ENDING THAT WAITS FOR A PERSON ALSO WRITES A `declaration` WITH
 * `status: 'blocked'`** — `blocked`, `unstarted`, `limited` and
 * `checks-unanswered` — because `supervise` reads the declaration file and
 * never the marker, and answers `correct` where none exists. `holding-work`
 * writes none: its correction is *land your work*, and `supervise` answering
 * `correct` is the right answer there.
 *
 * @param readings - what this pass measured, in the table's own order.
 * @returns the decision for this pass — writes, an ending where the table
 *   calls for one, and nothing where the pass only waits.
 */
export const agentLoop = (readings: AgentLoopReadings): Decision<AgentLoopDetail> => {
  const { worktree } = readings;

  // ROWS 1-3 — no assignment: the loop is free.
  if (readings.assignedBranch === '') {
    // ROW 3 — the manifest that named this free loop is gone.
    if (readings.registration === 'gone') {
      return end(worktree, '', 'unregistered', 'agent', 'the manifest that named this loop is gone', 124);
    }

    // ROW 2 — the free wait reached `Worker bound`. No slice was ever held,
    // so there is nothing to attribute an ending to and no watcher to name:
    // the table's own "none, 124" for the ending column. The exit code lives
    // in `detail.exitCode` rather than in a `loop-end` write, because no
    // ending reason applies here.
    if (readings.boundSeconds > 0 && readings.waitedSeconds >= readings.boundSeconds) {
      return decide('agent-loop', [], {
        branch: '',
        exitCode: 124,
        note: `the free wait exceeded the ${readings.boundSeconds}s bound`,
      });
    }

    // ROW 1 — still inside the bound, nothing assigned yet.
    return wait('', 'waiting for an assignment');
  }

  const branch = readings.assignedBranch;

  // ROW 4 — an assignment was just read: reset the desk onto it, commit and
  // push the claim, then run the first prompt.
  if (readings.running === null && readings.exit === null) {
    // A desk holding unlanded work ends the loop before anything is written
    // over it, the same `holding-work` ending row 11 gives after a prompt.
    const unlanded = readings.resetRefusals.filter((r) => r !== 'blocked-marker');
    if (unlanded.length > 0) {
      return end(
        worktree,
        branch,
        'holding-work',
        'agent',
        `the desk holds unlanded work (${unlanded.join(', ')}); \`${branch}\` is not taken up`,
        0,
      );
    }
    // A desk holding only a `PLOT-BLOCKED` marker is not reset; the slice
    // runs over it.
    const resettable = readings.resetRefusals.length === 0;
    const reset: readonly Write[] = resettable
      ? [{ kind: 'desk-reset', worktree, branch, base: readings.base }]
      : [];
    return decide(
      'agent-loop',
      [
        ...reset,
        { kind: 'commit', message: `plot: claim ${branch}`, paths: [] },
        { kind: 'push', branch, onto: '' },
        { kind: 'prompt-run', worktree, branch },
      ],
      {
        branch,
        exitCode: null,
        note: `${resettable ? 'desk reset, ' : `desk not reset (${readings.resetRefusals.join(', ')}), `}claim pushed, read: ${readings.claim ?? 'unknown'}`,
      },
    );
  }

  // ROWS 5-6 — a prompt is running this pass.
  if (readings.running !== null) {
    if (readings.running.verdict === 'idle') {
      // ROW 5.
      return end(
        worktree,
        branch,
        'quiet',
        'monitor',
        'the watcher reported idle: alive, committed, transcript silent past the window, no child on a core, tree unmoved',
        124,
        [{ kind: 'worker-finding', worktree, finding: 'idle' }],
      );
    }

    if (readings.boundSeconds > 0 && readings.waitedSeconds >= readings.boundSeconds) {
      // ROW 6 — the floor fired on a still-running prompt. The idle watch
      // said nothing (`silent`, never `idle` — that is row 5), so which of
      // `bound` or `unreadable` applies depends only on whether a transcript
      // could be read at all.
      return readings.running.transcriptReadable
        ? end(worktree, branch, 'bound', 'bound', `exceeded the ${readings.boundSeconds}s bound`, 124, [
            { kind: 'worker-finding', worktree, finding: 'gone' },
          ])
        : end(
            worktree,
            branch,
            'unreadable',
            'bound',
            'no transcript could be read for this worktree',
            124,
            [{ kind: 'worker-finding', worktree, finding: 'gone' }],
          );
    }

    return wait(branch, 'prompt running');
  }

  const exit = readings.exit;

  // ROW 7 — the prompt never started.
  if (exit !== null && exit.answer === 'unstarted') {
    if (readings.startRetries < readings.maxStartRetries) {
      return decide(
        'agent-loop',
        [{ kind: 'agent-attempt', worktree, attempts: readings.startRetries + 1 }],
        { branch, exitCode: null, note: `start retry ${readings.startRetries + 1}` },
      );
    }
    const question = `PLOT-BLOCKED: the prompt never started on \`${branch}\` after ${readings.startRetries} attempts — a person decides what to fix.`;
    return end(worktree, branch, 'unstarted', 'agent', 'the prompt never started, retries spent', 1, [
      { kind: 'blocked-marker', worktree, branch, question },
      blockedDeclaration(worktree, branch, 'the prompt never started'),
    ]);
  }

  // ROW 8 — a usage limit with a known reset the loop may wait for.
  if (exit !== null && exit.answer === 'wait') {
    return wait(branch, `waiting for the usage limit to reset at ${exit.reset.iso}`);
  }

  // ROW 9 — a usage limit with no wait allowed.
  if (exit !== null && exit.answer === 'end-limited') {
    const question = `PLOT-BLOCKED: the usage limit on \`${branch}\` cannot be waited out (${exit.cause}) — a person decides when to retry.`;
    return end(worktree, branch, 'limited', 'agent', `usage limit, cause: ${exit.cause}`, 1, [
      { kind: 'blocked-marker', worktree, branch, question },
      blockedDeclaration(worktree, branch, `usage limit: ${exit.cause}`),
    ]);
  }

  // From here `exit` is `ran`, or the prompt has already run in an earlier
  // pass and the loop is now watching the CI wait (`exit` stays `ran`).

  // ROW 10 — the agent wrote its own PLOT-BLOCKED marker.
  if (exit !== null && exit.answer === 'ran' && readings.markerWritten) {
    return end(worktree, branch, 'blocked', 'agent', 'the agent declared itself blocked', 0, [
      blockedDeclaration(worktree, branch, readings.markerText),
    ]);
  }

  // ROW 11 — unlanded work and no marker. No declaration: the correction is
  // "land your work", and `supervise` answering `correct` is the right
  // answer here (`the-shell-loop-holds-unlanded-work`).
  if (exit !== null && exit.answer === 'ran' && readings.resetRefusals.length > 0) {
    const refusal = readings.resetRefusals[0]!;
    return end(worktree, branch, 'holding-work', 'agent', `the desk holds unlanded work: ${refusal}`, 0);
  }

  // ROW 12a — before the CI wait starts, nothing pushed or no PR open: no CI
  // answer can come, so the slice is sealed and freed with no checks wait.
  // `checksVerdict` answers `none` for the same readings, and the shell seals
  // the slice on it. Once the wait has started, rows 13-18 decide alone: a
  // moved or unreadable tip and a closed PR are readings inside the wait.
  if (
    exit !== null &&
    exit.answer === 'ran' &&
    readings.checks === null &&
    (!readings.pushed || !readings.prOpen)
  ) {
    return seal(
      worktree,
      branch,
      readings.session,
      readings.pushed ? 'no PR open, no checks wait' : 'nothing pushed, no checks wait',
    );
  }

  // ROWS 12-18 — the exit is `ran`, work is pushed and a PR is open. The
  // switch has a case for every `ChecksFromRuns` value and no `default`; with
  // the declared return type, a new value fails typecheck until it has a row.
  const checks = readings.checks;
  switch (checks) {
    case null:
      // ROW 12 — the CI wait has not been asked yet.
      return wait(branch, 'waiting for checks');

    case 'none':
      // ROW 12b — `Checks wait` disables the wait: sealed and freed, as for 12a.
      return seal(worktree, branch, readings.session, 'the checks wait is disabled');

    case 'tip-moved':
      // ROW 17 — the remote tip moved out from under the pushed commit.
      // `checksFromRuns` answers this before `wait`, because a green run can
      // exist for the NEW tip, and that run is not evidence about this one.
      return end(worktree, branch, 'checks-unanswered', 'agent', `tip-moved: the remote tip of \`${branch}\` is no longer the pushed commit`, 0, [
        blockedDeclaration(worktree, branch, 'the remote tip moved away from the pushed commit'),
      ]);

    case 'no-answer':
      // ROW 16 — the wait reached `Checks wait` with nothing conclusive.
      return end(worktree, branch, 'checks-unanswered', 'agent', 'no-answer', 0, [
        blockedDeclaration(worktree, branch, 'no CI answer by the Checks wait bound'),
      ]);

    case 'wait':
      // ROW 18 — the tip could not be read this pass; a failure to observe is
      // not evidence, so the wait keeps going inside `Checks wait`. This and
      // ROW 13's ordinary in-progress wait share one answer.
      return wait(branch, 'waiting for checks');

    case 'settled':
      return settled(readings, branch);
  }
};
