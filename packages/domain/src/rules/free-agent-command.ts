/**
 * Whether a repository's `Worker command` can run a free agent.
 *
 * A free agent starts with an empty `PLOT_BRANCH` and waits for the registry to
 * hand it a slice. Only `plot-worker-loop.sh` waits; any other command runs its
 * prompt at once with no branch and exits. A worker given a branch is not
 * judged here: it works with any command.
 */

/** The script a free agent's command must run. */
export const WORKER_LOOP = 'plot-worker-loop.sh';

/** The `Worker command` value the refusal proposes. */
export const LOOP_COMMAND = `PLOT_UNATTENDED=1 skills/plot/scripts/${WORKER_LOOP}`;

/**
 * Matches the loop's basename as a word: after the start, a `/`, whitespace, a
 * quote or `=`, and before the end, whitespace, a quote, `;`, `&`, `|` or `)`.
 */
const LOOP_WORD = /(?:^|[/\s"'=])plot-worker-loop\.sh(?:$|[\s"';&|)])/;

/** Why a `Worker command` cannot run a free agent, and what fixes it. */
export interface FreeAgentCommandRefusal {
  /** The sentence that names the defect. */
  readonly why: string;
  /** The sentence that names the repair. */
  readonly repair: string;
}

/**
 * Judges a configured `Worker command` for a free agent.
 *
 * An empty command and `none` answer `undefined`: those are the
 * `unconfigured` and `declined` answers, which the caller reports itself.
 *
 * @param command - the `Worker command` value as configured.
 * @returns `undefined` when the command runs the loop or is not configured;
 *   otherwise the refusal.
 */
export const freeAgentCommandRefusal = (command: string): FreeAgentCommandRefusal | undefined => {
  const value = command.trim();
  if (value === '' || value.toLowerCase() === 'none') return undefined;
  if (LOOP_WORD.test(value)) return undefined;
  return {
    why: `the 'Worker command' does not run ${WORKER_LOOP}, so a free agent starts with an empty PLOT_BRANCH, runs at once and exits`,
    repair: `set 'Worker command' to '${LOOP_COMMAND}' (or the plugin's copy of ${WORKER_LOOP}), and move the harness call into .plot/worker-prompt.sh — plot-install-prompt.sh writes one from the template`,
  };
};
