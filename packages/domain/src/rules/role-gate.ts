/**
 * What a non-reviewer role agent (fixer, unblocker, main-repair) is refused,
 * by its settings file's `PreToolUse` hook.
 *
 * `fleet-roles-are-declared-agents` (wave 3, `docs/plans/2026-10-29-fleet-roles-are-declared-agents.md`)
 * gives each such role a tree it can write — a worktree on the PR's branch,
 * or off the default branch — but never the authority to mark its own work
 * reviewed, merged, or exempt from the gates that watch every other change.
 * This file decides which call crosses that line; the settings files wire it
 * to `board/plot-gate.mjs` as a new gate, the shape the plan requires rather
 * than a bespoke script under `skills/`.
 *
 * Every predicate reads the command or path text only — the same posture as
 * `controller-gate.ts` and `main-checkout-write.ts` beside it: no port, no
 * git, no process. The hook's `ask` wires a readings-free `Gate` once this
 * module is imported. The one import from `adapters/` names a constant, not a
 * capability — see `ci-workflow-path.ts`.
 */
import { CI_WORKFLOW_DIR } from '../adapters/ci-workflow-path.js';
import { commandRunsScript, withoutComments, withoutQuotes, wordBasename } from './ci-suite.js';
import { gitPushCalls } from './main-checkout-write.js';

/** A path a non-reviewer role may never create, edit or delete. */
const PROTECTED_PATH_PREFIXES: readonly string[] = ['.claude/', CI_WORKFLOW_DIR];

/** A path glob a non-reviewer role may never create, edit or delete, tested by basename. */
const PROTECTED_BASENAME_GLOBS: readonly RegExp[] = [/^check-.*\.sh$/, /.*-gate\.sh$/];

/**
 * Whether `path` is one this role may never write: under `.claude/` or
 * `.github/workflows/`, a `scripts/check-*.sh`, or a `skills/plot/scripts/*-gate.sh`.
 *
 * The prefix test reads the path as given — a relative path is judged
 * relative to the tree the hook's process already runs in, the same
 * assumption `tool_input.file_path`/`tool_input.path` carries for every other
 * tool-input reading in this codebase.
 *
 * @param path - the `file_path` or `path` a Write, Edit or NotebookEdit call names.
 * @returns whether the path is protected.
 */
export const isProtectedPath = (path: string): boolean => {
  const normalised = path.replace(/^\.\//, '');
  if (PROTECTED_PATH_PREFIXES.some((prefix) => normalised.startsWith(prefix) || normalised.includes(`/${prefix}`))) {
    return true;
  }
  const base = normalised.slice(normalised.lastIndexOf('/') + 1);
  const underScripts = /(^|\/)scripts\//.test(normalised);
  const underPlotScripts = /(^|\/)skills\/plot\/scripts\//.test(normalised);
  return (underScripts && PROTECTED_BASENAME_GLOBS[0]!.test(base)) || (underPlotScripts && PROTECTED_BASENAME_GLOBS[1]!.test(base));
};

/** Whether a command's words, ignoring quotes and comments, include one whose basename is `name`. */
const runsNamed = (command: string, name: string): boolean => commandRunsScript(withoutComments(withoutQuotes(command)), name);

/**
 * Whether a command calls `plot-host.sh commit-status` — the status write a
 * non-reviewer role must not make; `review.ts` is the only writer `plot/review`
 * takes.
 *
 * @param command - the Bash command line.
 * @returns whether the command runs that call.
 */
export const callsCommitStatus = (command: string): boolean =>
  runsNamed(command, 'plot-host.sh') && /\bcommit-status\b/.test(withoutComments(withoutQuotes(command)));

/**
 * Whether a command runs `plot-review.mjs` — the review this role must never
 * run on its own change.
 *
 * @param command - the Bash command line.
 * @returns whether the command runs that script, by basename.
 */
export const callsReviewRun = (command: string): boolean => runsNamed(command, 'plot-review.mjs');

/**
 * Whether a command merges a pull request: `gh pr merge`, or `plot-ask.mjs merge`.
 *
 * Unlike `controller-gate.ts`'s `unpinnedMerges`, this refuses EVERY merge
 * call from this role, pinned or not — a fixer or main-repair agent has no
 * standing to merge at all, regardless of head pin.
 *
 * @param command - the Bash command line.
 * @returns whether the command runs a merge call.
 */
export const callsMerge = (command: string): boolean => {
  const stripped = withoutComments(withoutQuotes(command));
  const words = stripped.split(/\s+/).filter((word) => word !== '');
  const ghMerge = words.some((word) => wordBasename(word) === 'gh') && /\bpr\b/.test(stripped) && /\bmerge\b/.test(stripped);
  const askMerge = runsNamed(command, 'plot-ask.mjs') && /\bmerge\b/.test(stripped);
  return ghMerge || askMerge;
};

/**
 * Whether a command pushes to the default branch.
 *
 * A push naming no refspec pushes `currentBranch`, read the same way
 * `pushesBriefBranch` reads it; `--all` and `--mirror` push every branch,
 * default included.
 *
 * @param command - the Bash command line.
 * @param defaultBranch - the repository's default branch name.
 * @param currentBranch - the branch the checkout is on, `''` where unknown.
 * @returns whether any `git push` in the command writes the default branch.
 */
export const pushesDefaultBranch = (command: string, defaultBranch: string, currentBranch: string): boolean => {
  if (defaultBranch === '') return false;
  return gitPushCalls(command).some((args) => {
    if (args.some((word) => word === '--all' || word === '--mirror')) return true;
    const operands = args.filter((word) => !word.startsWith('-'));
    const refspecs = operands.slice(1);
    const destination = (refspec: string): string =>
      (refspec.includes(':') ? refspec.slice(refspec.indexOf(':') + 1) : refspec).replace(/^\+/, '').replace(/^refs\/heads\//, '');
    if (refspecs.length === 0) return currentBranch === defaultBranch;
    return refspecs.some((spec) => {
      const dest = destination(spec);
      return dest === defaultBranch || (dest === 'HEAD' && currentBranch === defaultBranch);
    });
  });
};

/** A `git commit` message naming an issue it claims to fix, e.g. `Fixes #123`, `fixes #123`, `closes #123`. */
const FIXES_N = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#\d+/i;

/**
 * Whether a command's `git commit` message contains a GitHub closing keyword
 * naming an issue (`Fixes #N`, `Closes #N`, `Resolves #N`, case-insensitive).
 *
 * This role's commits land on a PR branch; a closing keyword there would
 * auto-close an issue the moment the PR merges, which is a judgement this
 * role does not have standing to make. The message text itself is read
 * here — unlike the controller gate's `withoutMessageSinks`, which blanks a
 * commit message because it is data a process never runs, this predicate's
 * whole purpose IS to read that data.
 *
 * @param command - the Bash command line.
 * @returns whether the command is a `git commit` whose message matches.
 */
export const commitMessageClosesIssue = (command: string): boolean => {
  if (!/\bgit\s+(?:[^|&;]*\s+)?commit\b/.test(command)) return false;
  return FIXES_N.test(command);
};

/**
 * The refusal text for a call this role's hook denies.
 *
 * @param reason - the one-line description of what the call would have done.
 * @returns the text for the hook's `permissionDecisionReason` (or stderr, for
 *   the exit-code shape this repository's own gates use).
 */
export const roleDenyRefusal = (reason: string): string =>
  `plot-role-gate: ${reason} — this role's settings deny it; route it through the reviewer or a person.`;

/**
 * Judges one Bash command against every role-deny predicate that reads a
 * command, in a fixed order so the first match names the call.
 *
 * @param command - the Bash command line.
 * @param defaultBranch - the repository's default branch name, `''` where unknown.
 * @param currentBranch - the branch the checkout is on, `''` where unknown.
 * @returns the refusal, or `null` where the command is allowed.
 */
export const roleDeniesCommand = (command: string, defaultBranch: string, currentBranch: string): string | null => {
  if (callsCommitStatus(command)) return roleDenyRefusal('this command writes the PR review status (plot-host.sh commit-status)');
  if (callsReviewRun(command)) return roleDenyRefusal('this command runs the reviewer (plot-review.mjs)');
  if (callsMerge(command)) return roleDenyRefusal('this command merges a pull request');
  if (pushesDefaultBranch(command, defaultBranch, currentBranch)) return roleDenyRefusal('this command pushes the default branch');
  if (commitMessageClosesIssue(command)) return roleDenyRefusal('this commit message closes an issue (Fixes/Closes/Resolves #N)');
  return null;
};

/**
 * Judges one file write (Write, Edit or NotebookEdit) against the protected-path rule.
 *
 * @param path - the `file_path` the tool call names.
 * @returns the refusal, or `null` where the path is allowed.
 */
export const roleDeniesPath = (path: string): string | null =>
  isProtectedPath(path) ? roleDenyRefusal(`this path is protected (${path})`) : null;
