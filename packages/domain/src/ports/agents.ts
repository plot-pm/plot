import type { PortResult } from '../port-result.js';

/**
 * What the dispatcher declared about one agent when it launched it.
 *
 * The manifest's fields, named for what they mean rather than for the JSON keys
 * they arrive under. Every field has an empty value that is a reading in its own
 * right: a manifest written by an older dispatcher states less, and an agent it
 * names must still be found.
 */
export interface AgentManifest {
  /** The session id the dispatcher minted — the identity everything joins on. */
  session: string;
  /** The handle a continuation resumes by; `''` where the manifest asserts none. */
  resumeId: string;
  /** The branch the agent holds; `''` between slices is a value, not a gap. */
  branch: string;
  /** That branch's plan slug; `''` where none travelled with the assignment. */
  slug: string;
  /** The desk it runs in, absolute. */
  worktree: string;
  /** The worker command as launched, verbatim. */
  command: string;
  /** When it launched, ISO-8601; `''` where the manifest recorded none. */
  startedAt: string;
  /** The pid recorded at launch — a launch fact, never alone meaning running. */
  pid: string;
  /** The pid this run displaced; `''` on a first dispatch. */
  previousPid: string;
  /** How often this desk's worker was relaunched — a person's record. */
  relaunches: number;
  /** How often the supervisor retried it — the budget's counter, never a person's. */
  attempts: number;
}

/**
 * What one desk holds, read without a manifest.
 *
 * **THE DESK IS ASKED BY PATH AND NOT BY SESSION, and that is the aggregate
 * boundary this slice measured rather than chose.** Three of the five callers
 * — `worker-question.ts`, `registryd-main.ts` and `continue.ts` — arrive holding
 * a worktree path from the pulse or from git and have never read a manifest.
 * A repository that could only be entered by session id would force each of
 * them to find one, and two of the three are about desks no manifest names.
 */
export interface AgentDesk {
  /**
   * The question a stopped agent left for a person; `''` where it left none.
   *
   * The FIRST LINE of the first `PLOT-BLOCKED*` file at the desk's root, which
   * is the whole of what a row can show. `''` is *no marker was read* and never
   * *not waiting*: the state is the deriver's to decide and this only annotates
   * it.
   */
  question: string;
  /** The `PLOT-BLOCKED*` filenames at the desk's root, without their directory. */
  markers: readonly string[];
  /** The pid the desk's own record names; `''` where it holds none usable. */
  pid: string;
  /**
   * The exit the wrapper recorded — `null` where no record exists, `''` where
   * one exists and says nothing.
   *
   * The two are kept apart because the shell keeps them apart: a worker killed
   * outright left no file, one whose wrapper died mid-write left a file saying
   * nothing. `rules/agent-state.ts` reads both as `ended` by different routes,
   * and collapsing them here would decide that on the repository's behalf.
   */
  exit: string | null;
}

/**
 * The agents Plot has launched, and the desks they were launched into.
 *
 * **A REPOSITORY, AND THE PATTERN IS PART OF THE CONTRACT.** It answers about
 * `Agent`s by identity and never about files: nothing outside its adapter knows
 * that a question is a file called `PLOT-BLOCKED.md`, that a pid sits in
 * `.plot-worker.pid`, or that a manifest is `<session>.json` under the
 * configured registry directory. The test is `plan-store`'s — can a caller use
 * it without knowing where the thing lives? — and a `read(path)` port fails that
 * by construction.
 *
 * **IT DOES NOT DERIVE STATE.** `rules/agent-state.ts` turns readings into one
 * of the eight words, and it takes readings as values. This supplies some of
 * those readings and decides nothing: a repository that answered `running`
 * would be a second deriver, which is the duplication
 * `an-agent-state-has-one-deriver` exists to refuse.
 *
 * ## `Agent` is not an aggregate root, and the callers say so
 *
 * The plan asks whether an agent's desk, worker, question and ending are loaded
 * and written together. **Measured on the five callers in `packages/board/src`:
 * they are not.**
 *
 * | caller | reads | joins the manifest? |
 * |---|---|---|
 * | `registry.ts:645` | the manifest directory | it *is* the manifest read |
 * | `worker-question.ts:markerIn` | a `PLOT-BLOCKED*` marker | no |
 * | `registryd-main.ts:414` | a `PLOT-BLOCKED*` marker | no |
 * | `registryd-main.ts:288,402` | `.plot-worker.pid` | no |
 * | `continue.ts:484` | `.plot-worker.log/.pid/.exit` | no |
 *
 * Four of the five reach a desk artefact having never seen a manifest, and they
 * arrive holding a worktree path rather than a session id. **A desk is
 * legitimately read alone**, so the manifest and the desk are two entries to one
 * repository rather than one root loading both — which is exactly the test the
 * plan asked to be decided by measurement rather than by preference.
 *
 * What the repository does own is that neither entry composes a path.
 */
export interface Agents {
  /**
   * Every agent the dispatcher has declared.
   *
   * @returns one manifest per readable declaration, in no promised order. An
   *   empty list is an ANSWER — no dispatch has run through this registry —
   *   where `failed` means the registry could not be read at all.
   */
  declared(): Promise<PortResult<readonly AgentManifest[]>>;

  /**
   * What the dispatcher declared about one agent.
   *
   * @param session - the agent's session id.
   * @returns its manifest, or `failed` where none names it.
   */
  declaration(session: string): Promise<PortResult<AgentManifest>>;

  /**
   * What one desk holds right now.
   *
   * @param worktree - the desk's absolute path.
   * @returns its readings. A desk that is not there answers `failed`; a desk
   *   that is there and holds nothing answers with every field at its empty
   *   value, which is a reading and not a failure.
   */
  desk(worktree: string): Promise<PortResult<AgentDesk>>;
}
