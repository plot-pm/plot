import type { ClaimHolderAnswer } from '../rules/claim.js';
import type { ChecksFromRuns, RemoteTipReading } from '../rules/checks-verdict.js';
import type { LoopRegistration } from '../rules/desk-manifest.js';
import type { PromptExit } from '../rules/prompt-exit.js';
import type { ResetRefusal } from '../rules/reapable.js';
import type { MonitorVerdict } from '../rules/sample.js';
import { backgroundDropCorrection } from '../rules/background-drop.js';
import { runLimitRefusal } from '../rules/run-limit.js';
import { sliceSpendRefusal } from '../rules/slice-spend-refusal.js';
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
   * What `claimAnswer` (`rules/claim.ts`) says about the branch, read after
   * origin rejected the claim push. `null` before a push and after any other
   * refusal. Carried into the decision's `detail`; the push itself is
   * unconditional.
   */
  readonly claim: ClaimHolderAnswer | null;
  /**
   * Which take-up write was refused this pass: the `desk-reset`, the claim
   * `commit`, or the claim `push`. `null` before the take-up writes are
   * applied and when every one of them landed. A refusal clears the
   * assignment, as the shell's `clear_manifest_branch` does after a rejected
   * claim push, so the loop goes free instead of retrying the take-up.
   */
  readonly takeUpRefused: TakeUpRefusal | null;
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
  readonly exit: LoopExit | null;
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
   * The SDK runner's hand-back, read only where {@link exit}`.answer` is
   * `ran`. `null` for a `command` runner, which hands back nothing, and for
   * a run whose `structured_output` the SDK's own `sdkRunExit` could not
   * read — both fall through to today's desk reading, same as `done`.
   *
   * **A READING, NEVER A STATE.** Filled by the caller from this pass's own
   * run, the way every other reading here is; `agentLoop` stores nothing
   * between passes.
   */
  readonly handBack: 'checks' | 'pushed' | 'blocked' | 'done' | null;
  /** The session a `checks` hand-back resumes once the local checks answered. */
  readonly checksResumeId: string;
  /** The hand-back's own summary, carried into the `checks` write and the resume. */
  readonly handBackSummary: string;
  /**
   * What the local checks answered for this `checks` hand-back; `null` while
   * they have not run. Read only where {@link handBack} is `checks`.
   */
  readonly localChecks: LocalChecksReading | null;
  /**
   * How many agent runs this slice has started: the first run, each `checks`
   * resume and each CI correction. Keyed to the branch; `0` after a hop.
   */
  readonly sliceRuns: number;
  /** `Slice max runs` — the run count at which no further run starts. */
  readonly sliceMaxRuns: number;
  /**
   * Whether this slice was already resumed once after a turn that dropped
   * its background work. Read only where {@link exit}`.answer` is `dropped`.
   */
  readonly backgroundDropResumed: boolean;
  /**
   * What the slice-spend record reads for this branch, from `readSliceSpend`.
   * `null` where `Slice max spend` is unconfigured — the caller's job, same as
   * {@link sliceMaxSpendUsd}, so a project naming no limit asks this rule
   * nothing rather than passing a sentinel through it.
   */
  readonly sliceCostUsd: number | null;
  /** `Slice max spend`, in dollars; `null` where the key is absent — no default stands in for it. */
  readonly sliceMaxSpendUsd: number | null;
  /**
   * Why this desk may not be reset — empty when nothing holds it. Read at
   * take-up and after a `ran` exit. At either point, `uncommitted-changes` or
   * `unpushed-commits` ends the loop `holding-work`. At take-up, a list that
   * names only `blocked-marker` ends the loop `blocked`: the desk holds an
   * unanswered question, so the slice is not taken up.
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

  /**
   * When this pass took its readings, ISO-8601. A finding this pass publishes
   * holds from this moment, so it is the finding's `since`.
   */
  readonly passAt: string;

  /** The worktree this loop runs in, absolute. */
  readonly worktree: string;
  /** The session id the dispatcher minted for this agent — the manifest `assignment-clear` lands in. */
  readonly session: string;
}

/**
 * How the last run ended: a `command` runner's {@link PromptExit}, or one of
 * the three ends only an SDK run reports — its own bound abort, its turn
 * limit, or its spend limit.
 */
export type LoopExit =
  | PromptExit
  | { readonly answer: 'bound' }
  | { readonly answer: 'turn-limit' }
  | { readonly answer: 'spend-limit' };

/** What the local checks a `checks` hand-back asked for answered. */
export type LocalChecksReading =
  | { readonly passed: true }
  | {
      readonly passed: false;
      /** The first command that failed, verbatim. */
      readonly command: string;
      /** The last lines of that command's output. */
      readonly tail: string;
    };

/** The take-up write that was refused, as {@link AgentLoopReadings.takeUpRefused} names it. */
export type TakeUpRefusal = 'desk-reset' | 'commit' | 'push';

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
 * The `run-limit` ending where this slice may start no further run, or `null`
 * where the next run may start.
 *
 * @param readings - this pass's readings.
 * @param branch - the branch the slice is on.
 * @returns the ending, with a `blocked` declaration, or `null`.
 */
const runLimitEnding = (readings: AgentLoopReadings, branch: string): Decision<AgentLoopDetail> | null => {
  if (!runLimitRefusal(readings.sliceRuns, readings.sliceMaxRuns)) return null;
  const summary = `the slice started ${readings.sliceRuns} runs, the Slice max runs limit of ${readings.sliceMaxRuns}`;
  return end(readings.worktree, branch, 'run-limit', 'agent', summary, 0, [
    blockedDeclaration(readings.worktree, branch, summary),
  ]);
};

/**
 * The `spend-limit` ending where this slice may start no further run because
 * its recorded cost reached `Slice max spend`, or `null` where the next run
 * may start.
 *
 * **ASKS NOTHING WHERE THE LIMIT IS UNCONFIGURED.** `sliceMaxSpendUsd` is
 * `null` for a project naming no `Slice max spend` key, and `sliceSpendRefusal`
 * must not be called with a sentinel standing in for that absence — so this
 * returns `null` before reaching the rule at all.
 *
 * @param readings - this pass's readings.
 * @param branch - the branch the slice is on.
 * @returns the ending, with a `blocked` declaration, or `null`.
 */
const spendLimitEnding = (readings: AgentLoopReadings, branch: string): Decision<AgentLoopDetail> | null => {
  if (readings.sliceMaxSpendUsd === null) return null;
  if (!sliceSpendRefusal({ costUsd: readings.sliceCostUsd }, readings.sliceMaxSpendUsd)) return null;
  const summary = `the slice's recorded cost reached the Slice max spend limit of $${readings.sliceMaxSpendUsd}`;
  return end(readings.worktree, branch, 'spend-limit', 'agent', summary, 0, [
    blockedDeclaration(readings.worktree, branch, summary),
  ]);
};

/** A `worker-finding` write about this pass's branch, holding from {@link AgentLoopReadings.passAt}. */
const finding = (
  readings: AgentLoopReadings,
  branch: string,
  name: 'gone' | 'idle',
  evidence: string,
): Write => ({ kind: 'worker-finding', worktree: readings.worktree, branch, finding: name, since: readings.passAt, evidence });

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
 *   `corrections-spent` ending once it is spent.
 */
const settled = (readings: AgentLoopReadings, branch: string): Decision<AgentLoopDetail> => {
  const { worktree } = readings;
  if (readings.checksPassed === true) {
    // ROW 13 — checks pass: declare ok, record the spend, clear the
    // assignment, then the loop is free again.
    return seal(worktree, branch, readings.session, 'checks passed');
  }

  if (readings.correctionAttempts < readings.correctionBudget) {
    // ROW 14 — checks fail, correction budget left. The correction is a run,
    // so `Slice max runs` and `Slice max spend` are asked first.
    const limited = runLimitEnding(readings, branch);
    if (limited !== null) return limited;
    const overspent = spendLimitEnding(readings, branch);
    if (overspent !== null) return overspent;
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
  return end(worktree, branch, 'corrections-spent', 'agent', 'correction budget spent', 0, [
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
 * `status: 'blocked'`** — `blocked`, `unstarted`, `limited`,
 * `checks-unanswered`, `corrections-spent`, `turn-limit`, `spend-limit` and
 * `run-limit` — because `supervise` reads the declaration file and never the
 * marker, and answers `correct` where none exists. `holding-work`
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
    // A REFUSED TAKE-UP WRITE gives the assignment back. The ref on origin
    // still locks the slice, so the slice does not return to the queue.
    if (readings.takeUpRefused !== null) {
      return decide('agent-loop', [{ kind: 'assignment-clear', session: readings.session }], {
        branch,
        exitCode: null,
        note: `the ${readings.takeUpRefused} at take-up was refused, claim: ${readings.claim ?? 'unknown'}; the assignment is cleared`,
      });
    }
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
    // A desk holding only a `PLOT-BLOCKED` marker holds an unanswered
    // question: the slice is not taken up, and the blocked declaration lets
    // `supervise` answer needs-a-person.
    if (readings.resetRefusals.length > 0) {
      return end(
        worktree,
        branch,
        'blocked',
        'agent',
        `the desk holds an unanswered PLOT-BLOCKED question; \`${branch}\` is not taken up`,
        0,
        [blockedDeclaration(worktree, branch, readings.markerText || 'an unanswered PLOT-BLOCKED question')],
      );
    }
    const limited = runLimitEnding(readings, branch);
    if (limited !== null) return limited;
    const overspent = spendLimitEnding(readings, branch);
    if (overspent !== null) return overspent;
    return decide(
      'agent-loop',
      [
        { kind: 'desk-reset', worktree, branch, base: readings.base },
        { kind: 'commit', message: `plot: claim ${branch}`, paths: [] },
        { kind: 'push', branch, onto: '' },
        { kind: 'prompt-run', worktree, branch },
      ],
      {
        branch,
        exitCode: null,
        note: `desk reset, claim pushed, read: ${readings.claim ?? 'unknown'}`,
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
        [finding(readings, branch, 'idle', 'the watcher reported idle')],
      );
    }

    if (readings.boundSeconds > 0 && readings.waitedSeconds >= readings.boundSeconds) {
      // ROW 6 — the floor fired on a still-running prompt. The idle watch
      // said nothing (`silent`, never `idle` — that is row 5), so which of
      // `bound` or `unreadable` applies depends only on whether a transcript
      // could be read at all.
      return readings.running.transcriptReadable
        ? end(worktree, branch, 'bound', 'bound', `exceeded the ${readings.boundSeconds}s bound`, 124, [
            finding(readings, branch, 'gone', `the prompt exceeded the ${readings.boundSeconds}s bound`),
          ])
        : end(
            worktree,
            branch,
            'unreadable',
            'bound',
            'no transcript could be read for this worktree',
            124,
            [finding(readings, branch, 'gone', 'no transcript could be read for this worktree')],
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

  // ROW 9a — an SDK run aborted on its own bound.
  if (exit !== null && exit.answer === 'bound') {
    return end(worktree, branch, 'bound', 'bound', `the run exceeded the ${readings.boundSeconds}s bound`, 124, [
      finding(readings, branch, 'gone', `the run exceeded the ${readings.boundSeconds}s bound`),
    ]);
  }

  // ROW 9b — an SDK run reached `Agent max turns`.
  if (exit !== null && exit.answer === 'turn-limit') {
    return end(worktree, branch, 'turn-limit', 'agent', 'the run reached Agent max turns', 0, [
      blockedDeclaration(worktree, branch, 'the run reached Agent max turns'),
    ]);
  }

  // ROW 9c — an SDK run reached `Agent max spend`.
  if (exit !== null && exit.answer === 'spend-limit') {
    return end(worktree, branch, 'spend-limit', 'agent', 'the run reached Agent max spend', 0, [
      blockedDeclaration(worktree, branch, 'the run reached Agent max spend'),
    ]);
  }

  // From here `exit` is `ran`, or the prompt has already run in an earlier
  // pass and the loop is now watching the CI wait (`exit` stays `ran`).

  // ROW 10 — the agent wrote its own PLOT-BLOCKED marker. Read before every
  // hand-back: a marker on the desk answers whatever the agent handed back.
  if (exit !== null && (exit.answer === 'ran' || exit.answer === 'dropped') && readings.markerWritten) {
    return end(worktree, branch, 'blocked', 'agent', 'the agent declared itself blocked', 0, [
      blockedDeclaration(worktree, branch, readings.markerText),
    ]);
  }

  // ROW 10c — the turn ended with its background work dropped.
  if (exit !== null && exit.answer === 'dropped') return droppedTurn(readings, branch, exit.line);

  // ROW 10a — the agent handed back `blocked`.
  if (exit !== null && exit.answer === 'ran' && readings.handBack === 'blocked') {
    return end(worktree, branch, 'blocked', 'agent', 'the agent handed back blocked', 0, [
      blockedDeclaration(worktree, branch, readings.handBackSummary || 'the agent handed back blocked'),
    ]);
  }

  // ROW 10b — the agent handed back `checks`. Its commits are not pushed yet,
  // so only uncommitted changes outrank it (ROW 11 answers those).
  if (
    exit !== null &&
    exit.answer === 'ran' &&
    readings.handBack === 'checks' &&
    !readings.resetRefusals.includes('uncommitted-changes')
  ) {
    return checksHandBack(readings, branch);
  }

  // A `pushed` or `done` hand-back, and no hand-back, read the desk from here:
  // ROW 11's unlanded work, ROW 12a's nothing pushed or no PR, then the CI wait.

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

  return ciWait(readings, branch);
};

/**
 * ROW 10c — a turn that ended with its background work dropped. The first
 * time on a slice, the loop resumes the session with
 * {@link backgroundDropCorrection}, unless `Slice max runs` or `Slice max
 * spend` is reached. The
 * second time, the slice ends `blocked` with a marker naming the line.
 *
 * @param readings - this pass's readings.
 * @param branch - the branch the slice is on.
 * @param line - the output line that shows the drop.
 * @returns an `agent-resume` write, the `run-limit` or `spend-limit` ending,
 *   or the `blocked` ending.
 */
const droppedTurn = (readings: AgentLoopReadings, branch: string, line: string): Decision<AgentLoopDetail> => {
  const { worktree } = readings;
  if (readings.backgroundDropResumed) {
    const question = `PLOT-BLOCKED: \`${branch}\`'s turn ended with its background work dropped again after one resume. The run reported: ${line} — a person decides how the slice finishes.`;
    return end(worktree, branch, 'blocked', 'agent', 'the turn ended with its background work dropped, twice', 0, [
      { kind: 'blocked-marker', worktree, branch, question },
      blockedDeclaration(worktree, branch, 'the turn ended with its background work dropped, twice'),
    ]);
  }

  const limited = runLimitEnding(readings, branch);
  if (limited !== null) return limited;
  const overspent = spendLimitEnding(readings, branch);
  if (overspent !== null) return overspent;
  return decide(
    'agent-loop',
    [{ kind: 'agent-resume', branch, worktree, resumeId: readings.resumeId, correction: backgroundDropCorrection(line) }],
    { branch, exitCode: null, note: 'the turn dropped its background work, resuming once' },
  );
};

/**
 * ROW 10b — a `checks` hand-back. While the local checks have not answered,
 * the loop asks the performer to run them. Once they answered, it resumes the
 * session with the result, unless `Slice max runs` is reached: on a pass the
 * line "local checks passed: <summary>", on a fail the failing command and
 * the tail of its output.
 *
 * @param readings - this pass's readings.
 * @param branch - the branch the slice is on.
 * @returns a `checks` write, an `agent-resume` write, or the `run-limit`/`spend-limit` ending.
 */
const checksHandBack = (readings: AgentLoopReadings, branch: string): Decision<AgentLoopDetail> => {
  const { worktree } = readings;
  const result = readings.localChecks;
  if (result === null) {
    return decide(
      'agent-loop',
      [{ kind: 'checks', branch, worktree, resumeId: readings.checksResumeId, summary: readings.handBackSummary }],
      { branch, exitCode: null, note: 'hand-back: checks, running the local checks' },
    );
  }

  const limited = runLimitEnding(readings, branch);
  if (limited !== null) return limited;
  const overspent = spendLimitEnding(readings, branch);
  if (overspent !== null) return overspent;

  const correction = result.passed
    ? `local checks passed: ${readings.handBackSummary}`
    : `local checks failed: \`${result.command}\`\n\n${result.tail}`;
  return decide(
    'agent-loop',
    [{ kind: 'agent-resume', branch, worktree, resumeId: readings.checksResumeId, correction }],
    { branch, exitCode: null, note: result.passed ? 'local checks passed, resuming' : 'local checks failed, resuming' },
  );
};

/**
 * ROWS 12-18 — the CI wait, once work is pushed and a PR is open: the switch
 * has a case for every `ChecksFromRuns` value and no `default`, so a new
 * value fails typecheck until it has a row.
 *
 * Reached by falling through ROWS 10-12a once `exit` is `ran`, whatever the
 * hand-back.
 *
 * @param readings - this pass's readings.
 * @param branch - the branch the slice is on.
 * @returns the CI wait's decision for this pass.
 */
const ciWait = (readings: AgentLoopReadings, branch: string): Decision<AgentLoopDetail> => {
  const { worktree } = readings;
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
