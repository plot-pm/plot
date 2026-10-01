/**
 * Which command starts an agent, given a repository's `Worker command`.
 *
 * An absent or empty key means the worker loop. `none` means the repository
 * starts its agents by hand. A configured command runs as written, with one
 * exception: a free agent starts with an empty `PLOT_BRANCH` and waits for the
 * registry to hand it a slice, and only the loop waits, so a free agent refuses
 * any command that does not run the loop. An agent given a branch works with
 * any command.
 *
 * The loop's file name and the command that runs it are readings the caller
 * supplies, so the rule names no script.
 */

/** The worker loop as the caller knows it. */
export interface LoopScript {
  /** The loop script's basename. */
  readonly name: string;
  /** The command that runs it: the default, and the value the repair proposes. */
  readonly command: string;
}

/** Whether the agent being started holds a branch yet. */
export type StartingAgent = 'free' | 'assigned';

/**
 * The command that starts an agent.
 *
 * - `run`: start `command`. `from` is `configured` for the repository's own
 *   value and `default` for the loop standing in for an absent key.
 * - `declined`: the repository answered `none`, so nothing starts.
 * - `refused`: the command cannot run this agent; `why` names the defect and
 *   `repair` the fix.
 */
export type StartCommand =
  | { readonly start: 'run'; readonly command: string; readonly from: 'configured' | 'default' }
  | { readonly start: 'declined' }
  | { readonly start: 'refused'; readonly why: string; readonly repair: string };

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Matches the loop's basename as a word: after the start, a `/`, whitespace, a
 * quote or `=`, and before the end, whitespace, a quote, `;`, `&`, `|` or `)`.
 */
const loopWord = (name: string): RegExp =>
  new RegExp(`(?:^|[/\\s"'=])${escapeRegExp(name)}(?:$|[\\s"';&|)])`);

/**
 * Answers which command starts an agent.
 *
 * @param configured - the `Worker command` value as configured; `''` when the
 *   key is absent.
 * @param loop - the worker loop's basename and the command that runs it.
 * @param agent - `free` for an agent holding no branch, `assigned` for one
 *   started on a branch.
 * @returns the command to run, `declined`, or the refusal.
 */
export const startCommand = (configured: string, loop: LoopScript, agent: StartingAgent): StartCommand => {
  const value = configured.trim();
  if (value === '') return { start: 'run', command: loop.command, from: 'default' };
  if (value.toLowerCase() === 'none') return { start: 'declined' };
  if (agent === 'assigned' || loopWord(loop.name).test(value)) {
    return { start: 'run', command: value, from: 'configured' };
  }
  return {
    start: 'refused',
    why: `the 'Worker command' does not run ${loop.name}, so a free agent starts with an empty PLOT_BRANCH, runs at once and exits`,
    repair: `delete the 'Worker command' key to use the default loop; or set it to '${loop.command}' (or the plugin's copy of ${loop.name}), and move the harness call into .plot/worker-prompt.sh — plot-install-prompt.sh writes one from the template`,
  };
};
