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
import { commandRunsScript } from './ci-suite.js';
import type { PromptResolution } from './prompt.js';

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
 * What the caller read about the prompt file the loop sources.
 *
 * The `sdk` runner falls back to Plot's shipped prompt, so only the `command`
 * runner needs the resolved file to exist.
 */
export interface PromptReading {
  /** The runner the agent's loop will use. */
  readonly runner: 'command' | 'sdk';
  /** Which prompt file the agent's charter names, or why none can be believed. */
  readonly resolution: PromptResolution;
  /** Whether the resolved file exists under the repo root. */
  readonly present: boolean;
}

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

/**
 * Answers which command starts an agent.
 *
 * @param configured - the `Worker command` value as configured; `''` when the
 *   key is absent.
 * @param loop - the worker loop's basename and the `Worker command` value that
 *   runs it.
 * @param agent - `free` for an agent holding no branch, `assigned` for one
 *   started on a branch.
 * @param prompt - the prompt file reading. A command that runs the loop on the
 *   `command` runner is refused when the resolution is `refused` or the file is
 *   absent; the `sdk` runner is never refused for the file.
 * @returns the command to run, `unconfigured`, `declined`, or the refusal.
 */
export const startCommand = (
  configured: string,
  loop: LoopScript,
  agent: StartingAgent,
  prompt: PromptReading,
): StartCommand => {
  const value = configured.trim();
  const setIt = `set 'Worker command' to '${loop.command}'`;
  if (value === '') return { start: 'unconfigured', repair: `${setIt}, which /plot-dispatch offers to write` };
  if (value.toLowerCase() === 'none') return { start: 'declined' };
  if (commandRunsScript(value, loop.name)) {
    const missing = missingPrompt(prompt);
    return missing ?? { start: 'run', command: value };
  }
  if (agent === 'assigned') return { start: 'run', command: value };
  return {
    start: 'refused',
    why: `the 'Worker command' does not run ${loop.name}, so a free agent starts with an empty PLOT_BRANCH, runs at once and exits`,
    repair: `${setIt}, and move the harness call into .plot/worker-prompt.sh — plot-install-prompt.sh writes one from the template`,
  };
};

/** The refusal for a loop on the `command` runner with no usable prompt file, else null. */
const missingPrompt = ({ runner, resolution, present }: PromptReading): StartCommand | null => {
  if (runner !== 'command') return null;
  if (resolution.resolve === 'refused') {
    return { start: 'refused', why: resolution.why, repair: `fix the charter named by PLOT_AGENT` };
  }
  if (present) return null;
  const declared = resolution.resolve === 'declared';
  return {
    start: 'refused',
    why: `the 'Worker command' runs the loop on the command runner, and its prompt file ${resolution.prompt} is absent`,
    repair: declared
      ? `write ${resolution.prompt}, which charter '${resolution.charter}' names`
      : 'run plot-install-prompt.sh to write .plot/worker-prompt.sh from the template',
  };
};
