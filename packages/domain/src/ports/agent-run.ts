import type { PortResult } from '../port-result.js';
import type { TokenCountsRecord } from '../entities/slice-spend.js';

/**
 * One agent run — the connector a fleet agent starts from TypeScript.
 *
 * A connector port, separate from `BoundedRun` and `Performer`: it records
 * the run's spend and reports the account's usage limit, and the run stays in
 * its caller's process group. The request and the result name no SDK type;
 * an adapter under `adapters/` translates them.
 */
export interface AgentRun {
  /**
   * Runs one agent turn to its end: a hand-back, a limit, a bound, a turn or
   * spend ceiling, or an unstarted run.
   *
   * @param request - the desk, the prompt, the session to resume, and every
   *   other reading the run needs.
   * @returns what the run produced; `failed` where the run could not be
   *   started at all. Never `unaskable` — a connector that exists either
   *   starts the run or it does not.
   */
  run(request: AgentRunRequest): Promise<PortResult<AgentRunResult>>;
}

/**
 * What one agent run asks for.
 *
 * **NAMES NO HARNESS-SPECIFIC OPTION.** `model`, `effort`, `harness` and the
 * rest are the readings `runnerChoice` and the charter precedence already
 * decided before this request is built; the adapter that carries one out
 * translates them into whichever options its own connector understands.
 */
export interface AgentRunRequest {
  /** The worktree the run works in, absolute — the desk. */
  readonly worktree: string;
  /** The prompt text for a fresh run; the correction or resume text otherwise. */
  readonly prompt: string;
  /** The session to resume, or `''` to start a fresh one. */
  readonly resumeId: string;
  /**
   * The id a fresh session takes, so the loop's transcript readings find it;
   * absent or `''` lets the connector choose. Ignored where `resumeId` is set.
   */
  readonly sessionId?: string;
  /** The role running — `worker`, or a board role such as `idea` or `brief`. */
  readonly role: string;
  /** The harness this run is asked to use; `''` when unstated. */
  readonly harness: string;
  /** The model this run is asked to use; `''` when unstated. */
  readonly model: string;
  /** The reasoning effort this run is asked for; `''` when unstated. */
  readonly effort: string;
  /** The turn limit for this one run; `0` for no limit. */
  readonly maxTurns: number;
  /** The spend limit for this one run, in dollars; `0` for no limit. */
  readonly maxSpendUsd: number;
  /** How long this run may take before it is ended, in seconds; `0` disables the bound. */
  readonly boundSeconds: number;
  /** The context-window cap this run is asked to keep, in tokens; `0` for no cap. */
  readonly contextWindow: number;
  /** What this run may do — the capability list a charter or a default names. */
  readonly capabilities: readonly string[];
  /** Extra environment on top of the run's own inherited one; merged, never a replacement. */
  readonly env: Readonly<Record<string, string>>;
  /** Where this run's combined output is written as it runs. */
  readonly logFile: string;
}

/**
 * What one model's cumulative usage looked like at this run's end.
 *
 * **CUMULATIVE FOR THE SESSION, NEVER A DELTA.** The SDK reports a resumed
 * session's totals from its transcript, not from the run just asked for, and
 * this carries that figure verbatim — a reader that wants what THIS run
 * added derives it from the difference against the session's previous line
 * (`readSpend`, slice 3), rather than this port computing one.
 */
export type AgentRunUsage = TokenCountsRecord;

/**
 * A reading of the account's usage limit, taken during this run.
 *
 * Sent for claude.ai subscription accounts only; an API-key account's run
 * carries none. `utilization` is carried in the SDK's own scale, unconverted:
 * a fraction from 0 to 1, read from one live event on 2026-10-06 (`0.14` for
 * a `five_hour` window).
 */
export interface AgentRunLimitReading {
  /** `allowed`, `allowed_warning` or `rejected`, as the event names it. */
  readonly status: string;
  /** When the window resets, in epoch seconds as the SDK sends it; `null` where the event names none. */
  readonly resetsAt: number | null;
  /** Which limit this reading is about, in the event's own word. */
  readonly rateLimitType: string;
  /**
   * How much of the window is spent, 0 to 1; `null` where the event names
   * none. An `allowed` event can omit the top-level figure and carry it only
   * per window, so absent is unknown, never `0`.
   */
  readonly utilization: number | null;
}

/**
 * The hand-back a worker role's turn ended with.
 *
 * **A READING, NEVER A STATE.** `agentLoop` carries nothing between passes;
 * this is one more field the caller fills from the run just finished, read
 * only where {@link AgentRunResult.end} is `ran`.
 */
export type AgentHandBack =
  | { readonly next: 'checks'; readonly summary: string }
  | { readonly next: 'pushed'; readonly summary: string }
  | { readonly next: 'blocked'; readonly summary: string }
  | { readonly next: 'done'; readonly summary: string };

/**
 * The hand-back a board role's turn ended with.
 *
 * Distinguished from {@link AgentHandBack} by shape rather than by a shared
 * discriminant field: a board role's vocabulary (a written path, or a
 * done/refused outcome) has nothing in common with the worker's `next` enum,
 * so a reader tells the two apart with `'next' in handBack` /
 * `'written' in handBack` / `'outcome' in handBack`.
 */
export type BoardHandBack =
  | { readonly written: string; readonly summary: string }
  | { readonly outcome: 'done' | 'refused'; readonly summary: string };

/**
 * Why a run ended, mapped to the loop's existing vocabulary.
 *
 * `sdkRunExit` is what classifies an SDK result into one of these; a
 * `command` adapter answers `ran` or `unstarted` by exit status, as
 * `promptExit` already does.
 */
export type AgentRunEnd =
  | { readonly answer: 'unstarted'; readonly detail: string }
  /** A usage limit the loop may wait out; `resetEpoch` is the reset in epoch seconds. */
  | { readonly answer: 'wait'; readonly resetEpoch: number }
  | { readonly answer: 'end-limited'; readonly cause: 'no-reset' | 'past-bound' | 'no-progress' }
  | { readonly answer: 'bound' }
  | { readonly answer: 'turn-limit' }
  | { readonly answer: 'spend-limit' }
  | { readonly answer: 'ran'; readonly handBack: AgentHandBack | BoardHandBack | null };

/**
 * What one agent run produced.
 *
 * **THE USAGE IS THE SESSION'S CUMULATIVE FIGURE, NEVER A SUM THIS PORT
 * COMPUTES.** A reader wanting what one run added derives it from the
 * difference against the previous run line — see `readSpend`, slice 3. `turns`
 * is this run's own turns, counted by the adapter as it streams the
 * `assistant` messages; it is not cumulative.
 */
export interface AgentRunResult {
  /** The session id this run ran under — fresh or resumed. */
  readonly sessionId: string;
  /** Why the run ended. */
  readonly end: AgentRunEnd;
  /** The session's cumulative usage, per model; empty where the connector reports none. */
  readonly usageByModel: Readonly<Record<string, AgentRunUsage>>;
  /** The session's cumulative cost estimate, in dollars; `null` where unreported. */
  readonly costUsd: number | null;
  /**
   * The session's cumulative cost estimate per model, in dollars; empty where
   * the connector reports none. Kept apart from {@link usageByModel} because
   * that record's key set is the four token counters.
   */
  readonly costUsdByModel: Readonly<Record<string, number>>;
  /** How many turns this run itself took. */
  readonly turns: number;
  /** Every usage-limit reading this run observed, in order. */
  readonly limitReadings: readonly AgentRunLimitReading[];
  /**
   * The authenticated account's email, then organization, then `null` where
   * the connector reports neither — the precedence `rateLimitEntry`'s caller
   * resolves a budget entry's account from.
   */
  readonly account: string | null;
}
