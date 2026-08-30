import path from 'node:path';

/**
 * Where the board's agent logs live — the ONE place that decides it.
 *
 * Nine modules spawn agents and each keeps its own log, prompt and state file
 * beside the others. Until 2026-08-30 each of them resolved the directory
 * itself, so one decision was written 22 times; this module is that decision,
 * and the nine ask it.
 *
 * WHY THE FILES SIT OUTSIDE THE REPOSITORY, since this is now the only place
 * that knows: `pnpm board` runs under `node --watch`, which watches the whole
 * tree and does not read `.gitignore`. A file written INSIDE the repo restarts
 * the very server that just spawned the agent, and the restart can take the
 * agent with it. Measured 2026-08-25 walking the v2.9.0 endgame: clicking
 * *Create plan* on issue #333 wrote `.plot/idea-issue-333.md`, the board log
 * recorded `Restarting 'board-server.mjs'` in the same second, and the agent's
 * log sat at 0 bytes. It recovered on a later attempt, which is worse than a
 * clean failure: the defect is a race, so it disappears when looked at.
 *
 * The second reason is the same one in different words — a log inside the repo
 * is an untracked file every `git status` reports and every worktree inherits,
 * so a repair that dirties its own worktree cannot be verified by the suite it
 * then runs.
 */

/**
 * The directory the board's agent logs, prompts and state files live in.
 *
 * The parent of the repository: "not in the repo" was implemented as "in the
 * directory beside it", which is a directory Plot does not own. That is a known
 * defect with its own slice — this module exists so that fixing it is one edit
 * rather than 22, and it deliberately does not fix it yet. Changing who decides
 * and what they decide in one diff means a reviewer cannot tell a missed call
 * site from an intended path change.
 */
export function agentLogDir(repoRoot: string): string {
  return path.resolve(repoRoot, '..');
}

/**
 * What kind of agent run a file belongs to — the `plot-<kind>-…` name segment.
 *
 * A closed set rather than a string, because these names are also what a sweep
 * globs for: a caller inventing a sixth kind would write a file that the
 * cleanup does not know to remove, which is the failure this plan exists to
 * stop recurring.
 */
export type AgentLogKind =
  | 'approve'
  | 'commission'
  | 'deliver'
  | 'dispatch'
  | 'idea-issue'
  | 'implement'
  | 'reslice'
  | 'resolve'
  | 'story-issue';

/**
 * Which of a run's three files is wanted.
 *
 * `log` is the agent's own words, `state` the outcome a later GET reads back,
 * and `prompt` the brief handed to it. All three share a directory because all
 * three share the reason for being outside the repo — and because a sweep that
 * knows about the log and not its `.state` companion leaves half a run behind.
 */
export type AgentLogFile = 'log' | 'state' | 'prompt';

const EXTENSIONS: Record<AgentLogFile, string> = {
  log: '.log',
  state: '.state',
  prompt: '.prompt.md',
};

/**
 * Where the `<file>` for a `<kind>` run keyed by `id` lives.
 *
 * `id` is whatever names the run to its module — a plan slug for `dispatch` and
 * `deliver`, an issue number for `idea-issue` and `story-issue`, a branch with
 * its slashes flattened for `resolve`. The resolver does not interpret it: the
 * module that spawned the agent knows what identifies its run, and a resolver
 * that second-guessed that would need to know all nine.
 *
 * @param repoRoot absolute path to the repository this board serves
 * @param kind which command spawned the run
 * @param id what names the run within that kind
 * @param file which of the run's three files is wanted
 * @returns an absolute path; the file need not exist
 */
export function agentLogPath(
  repoRoot: string,
  kind: AgentLogKind,
  id: string | number,
  file: AgentLogFile,
): string {
  return path.join(agentLogDir(repoRoot), `plot-${kind}-${id}${EXTENSIONS[file]}`);
}
