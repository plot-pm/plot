/**
 * Whether a repository's `Worker command` can run a free agent.
 *
 * A free agent starts with an empty `PLOT_BRANCH` and waits for the registry to
 * hand it a slice. Only the worker loop waits; any other command runs its
 * prompt at once with no branch and exits. A worker given a branch is not
 * judged here: it works with any command.
 *
 * The loop's file name and the command that runs it are readings the caller
 * supplies, so the rule names no script.
 */

/** The worker loop as the caller knows it. */
export interface LoopScript {
  /** The loop script's basename. */
  readonly name: string;
  /** The `Worker command` value that runs it, proposed in the repair. */
  readonly command: string;
}

/** Why a `Worker command` cannot run a free agent, and what fixes it. */
export interface FreeAgentCommandRefusal {
  /** The sentence that names the defect. */
  readonly why: string;
  /** The sentence that names the repair. */
  readonly repair: string;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Matches the loop's basename as a word: after the start, a `/`, whitespace, a
 * quote or `=`, and before the end, whitespace, a quote, `;`, `&`, `|` or `)`.
 */
const loopWord = (name: string): RegExp =>
  new RegExp(`(?:^|[/\\s"'=])${escapeRegExp(name)}(?:$|[\\s"';&|)])`);

/**
 * Judges a configured `Worker command` for a free agent.
 *
 * An empty command and `none` answer `undefined`: those are the
 * `unconfigured` and `declined` answers, which the caller reports itself.
 *
 * @param command - the `Worker command` value as configured.
 * @param loop - the worker loop's basename and the command that runs it.
 * @returns `undefined` when the command runs the loop or is not configured;
 *   otherwise the refusal.
 */
export const freeAgentCommandRefusal = (
  command: string,
  loop: LoopScript,
): FreeAgentCommandRefusal | undefined => {
  const value = command.trim();
  if (value === '' || value.toLowerCase() === 'none') return undefined;
  if (loopWord(loop.name).test(value)) return undefined;
  return {
    why: `the 'Worker command' does not run ${loop.name}, so a free agent starts with an empty PLOT_BRANCH, runs at once and exits`,
    repair: `set 'Worker command' to '${loop.command}' (or the plugin's copy of ${loop.name}), and move the harness call into .plot/worker-prompt.sh — plot-install-prompt.sh writes one from the template`,
  };
};
