/**
 * Which command starts an agent, given a repository's `Worker command`.
 *
 * An absent or empty key means the repository is not set up to start agents,
 * and `none` means it starts them by hand; neither runs anything. A configured
 * command runs as written, with one exception: a free agent starts with an
 * empty `PLOT_BRANCH` and waits for the registry to hand it a slice, and only
 * the loop waits, so a free agent refuses any command that does not run the
 * loop. An agent given a branch works with any command.
 *
 * The loop's file name and the `Worker command` value that runs it are readings
 * the caller supplies, so the rule names no script.
 */

/** The worker loop as the caller knows it. */
export interface LoopScript {
  /** The loop script's basename. */
  readonly name: string;
  /** The `Worker command` value that runs it, proposed in every repair. */
  readonly command: string;
}

/** Whether the agent being started holds a branch yet. */
export type StartingAgent = 'free' | 'assigned';

/**
 * The command that starts an agent.
 *
 * - `run`: start `command`, the repository's configured value.
 * - `unconfigured`: the key is absent or empty, so nothing starts; `repair`
 *   names the value to set.
 * - `declined`: the repository answered `none`, so nothing starts.
 * - `refused`: the command cannot run this agent; `why` names the defect and
 *   `repair` the fix.
 */
export type StartCommand =
  | { readonly start: 'run'; readonly command: string }
  | { readonly start: 'unconfigured'; readonly repair: string }
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
 * @param loop - the worker loop's basename and the `Worker command` value that
 *   runs it.
 * @param agent - `free` for an agent holding no branch, `assigned` for one
 *   started on a branch.
 * @returns the command to run, `unconfigured`, `declined`, or the refusal.
 */
export const startCommand = (configured: string, loop: LoopScript, agent: StartingAgent): StartCommand => {
  const value = configured.trim();
  const setIt = `set 'Worker command' to '${loop.command}'`;
  if (value === '') return { start: 'unconfigured', repair: `${setIt}, which /plot-dispatch offers to write` };
  if (value.toLowerCase() === 'none') return { start: 'declined' };
  if (agent === 'assigned' || loopWord(loop.name).test(value)) return { start: 'run', command: value };
  return {
    start: 'refused',
    why: `the 'Worker command' does not run ${loop.name}, so a free agent starts with an empty PLOT_BRANCH, runs at once and exits`,
    repair: `${setIt}, and move the harness call into .plot/worker-prompt.sh — plot-install-prompt.sh writes one from the template`,
  };
};
