import { join } from 'node:path';

import type { ProbePrompt } from '@plot-pm/domain/ports/write-probe';

/**
 * The prompt file the write probe tests for one agent, read from the prompt
 * entry's `answer` line, which the worker loop also reads.
 *
 * @param root - the checkout the prompt resolves under.
 * @param name - the agent name, or `''` for the fallback prompt.
 * @param resolvePrompt - the prompt entry's `answer`.
 * @returns the absolute file and its charter (`null` for the fallback), or
 *   the charter's refusal.
 */
export const probePromptUnder = (
  root: string,
  name: string,
  resolvePrompt: (root: string, name: string) => string,
): ProbePrompt => {
  const [verb, named, why] = resolvePrompt(root, name).replace(/\n$/, '').split('\t');
  if (verb === 'refused' || !named) return { refused: why || `no prompt resolved for agent '${name}'` };
  return { file: join(root, named), charter: verb === 'declared' ? (why ?? name) : null };
};

/** What resolving the prompt of one started agent reads. */
export interface StartPromptReadings {
  /** The main checkout, which the loop resolves its prompt under. */
  readonly repoRoot: string;
  /** The agent a slice's own plan line names, as `sliceAgentOf` answers. */
  readonly sliceAgent: (branch: string) => string | null;
  /** The prompt entry's `answer` line for an agent name under a root. */
  readonly resolvePrompt: (root: string, name: string) => string;
  /** Whether a path exists. */
  readonly exists: (path: string) => boolean;
}

/**
 * The prompt file the loop of one `worker-start` write sources, resolved as
 * the loop resolves it.
 *
 * A write that names a branch resolves that slice's own `agent:` charter; a
 * free agent's write names none and resolves the fallback prompt. Where the
 * main checkout holds no file and the write's desk holds one, the desk's copy
 * is the answer.
 *
 * @param write - the `worker-start` write's branch and desk.
 * @param readings - the resolver and the reads it needs.
 * @returns the file to probe and its charter, or the charter's refusal.
 */
export const startPromptOf = (
  write: { readonly branch: string; readonly worktree: string },
  readings: StartPromptReadings,
): ProbePrompt => {
  const name = write.branch === '' ? '' : (readings.sliceAgent(write.branch) ?? '');
  const under = (root: string): ProbePrompt => probePromptUnder(root, name, readings.resolvePrompt);
  const main = under(readings.repoRoot);
  if ('refused' in main || readings.exists(main.file) || write.worktree === '' || write.worktree === readings.repoRoot) return main;
  const desk = under(write.worktree);
  return !('refused' in desk) && readings.exists(desk.file) ? desk : main;
};
