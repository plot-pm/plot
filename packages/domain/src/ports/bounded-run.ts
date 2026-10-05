import type { PortResult } from '../port-result.js';

/**
 * Runs a child the CALLER OWNS, bounded by a deadline — the opposite of
 * {@link Performer}, which starts detached processes that outlive the caller.
 *
 * **NO `detached`, EVER.** `plot-dispatch.sh --stop` ends an agent with
 * `kill -TERM -<pgid>` against the ONE process group the wrapper, the loop and
 * the prompt all share (`start_worker`'s `set -m`). A `boundedRun` that set
 * `detached: true` (or called `setsid`) would put the prompt in its OWN group,
 * and that external group signal would then miss it entirely — measured
 * 2026-09-30 (#1084): signalling the wrapper alone ended the wrapper, and the
 * loop, the prompt shell, `claude` and its children survived reparented to
 * pid 1. So this port's own child inherits the caller's process group, and it
 * is this port's job — not the group's — to reach the prompt's descendants
 * when ITS bound fires.
 *
 * **ON ITS OWN BOUND, ON THE CALLER'S EXIT, OR ON A SIGTERM, SIGINT OR SIGHUP
 * TO THE CALLER, IT SIGNALS THE ROOT AND ITS DESCENDANTS — DESCENDANTS READ
 * FIRST.** On a signal the caller then exits with `128 + signal number`. The child here is a shell that
 * launches the harness as a grandchild (`bash -c '. "$f"'` launching `claude`),
 * so signalling the immediate child alone orphans the harness, which is the
 * very thing being bounded. The descendants are read through `Processes`
 * BEFORE the root dies: once it is gone they have reparented to pid 1 and a
 * read taken then finds none of them (`_kill_tree`, `plot-worker-loop.sh:2054`).
 */
export interface BoundedRun {
  /**
   * Runs one command to completion or to its bound, whichever comes first.
   *
   * @param command - the executable to run.
   * @param args - its arguments.
   * @param options - where to run it, where its output goes, and how long it
   *   may run before being ended.
   * @returns what the run produced; `failed` where the command could not be
   *   started at all. Never `unaskable` — a command either starts or it does
   *   not, and there is no backend this port cannot ask.
   */
  run(
    command: string,
    args: readonly string[],
    options: BoundedRunOptions,
  ): Promise<PortResult<BoundedRunResult>>;
}

/** How to run one bounded command. */
export interface BoundedRunOptions {
  /** The directory to run in. */
  cwd: string;
  /** Extra environment on top of the current process's. */
  env?: Readonly<Record<string, string>>;
  /**
   * How long the command may run before it is ended, in seconds.
   *
   * `0` disables the bound — the same floor-off convention `Worker bound`
   * uses everywhere else in this loop.
   */
  boundSeconds: number;
  /** Where the command's combined output is written as it runs. */
  outFile: string;
}

/** What one bounded run produced. */
export interface BoundedRunResult {
  /** The command's own exit status; `null` where the bound ended it first. */
  status: number | null;
  /** Whether the bound fired before the command exited on its own. */
  timedOut: boolean;
  /** How long the command ran, in seconds. */
  ranSeconds: number;
}
