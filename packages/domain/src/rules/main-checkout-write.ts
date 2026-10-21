/**
 * Whether an unattended agent's command writes git state directly into the
 * repository's MAIN checkout, rather than its own desk worktree.
 *
 * The incident this guards against (#2311, `docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md`)
 * was not a script writing to the wrong path — wave 1's sandbox runs cleared
 * every named script. It was an interactive session running `git commit` /
 * `git reset` directly against the checkout the operator had open, following
 * the same "append `→ #<number>`" bookkeeping instructions a hand-off brief
 * gives by hand. So this reads the same two signals the controller gate
 * already reads — `PLOT_UNATTENDED=1`, and whether the cwd resolves to a
 * linked worktree — and refuses a git command that mutates `HEAD` or the
 * index when both say "this is an unattended agent, and this is not a desk".
 */
import { isReadSegment, programWords, withoutComments, withoutQuotes, wordBasename } from './ci-suite.js';

/** A git subcommand that mutates `HEAD`, the index, or a ref. */
const MUTATING_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'commit',
  'reset',
  'checkout',
  'restore',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'am',
  'apply',
  'stash',
  'update-ref',
  'symbolic-ref',
  'branch',
  'switch',
  'rm',
  'mv',
]);

/**
 * Whether a simple command's program is a git call naming a mutating
 * subcommand. `git grep`/`git log`/`git show`/`git diff`/`git status` and the
 * rest of git's read surface are not in {@link MUTATING_GIT_SUBCOMMANDS}, so
 * they pass. `git branch` with no further argument only lists and would be a
 * false positive, but `branch -f`/`branch -d <name>` mutate — the gate is not
 * asked to split that hair: a bare `git branch` inside an unattended agent's
 * command on the main checkout is rare enough that refusing it is a false
 * positive worth naming over a missed mutation.
 *
 * @param words - one simple command, split on whitespace, quotes already removed.
 * @returns whether the segment runs a mutating git subcommand.
 */
const isMutatingGitSegment = (words: readonly string[]): boolean => {
  if (isReadSegment(words)) return false;
  const program = programWords(words);
  if (program.length === 0 || wordBasename(program[0]) !== 'git') return false;
  const sub = program.slice(1).find((w) => !w.startsWith('-'));
  return sub !== undefined && MUTATING_GIT_SUBCOMMANDS.has(sub);
};

/**
 * Whether a command line runs a git subcommand that mutates `HEAD`, the
 * index, or a ref. Quoted text and `#` comments are not read; each segment
 * split on `&&`, `||`, `;`, `|` and newlines is tested on its own, so one
 * mutating segment in a chain is enough.
 *
 * @param command - the command line.
 * @returns whether any segment mutates git state.
 */
export const mutatesGitState = (command: string): boolean =>
  withoutQuotes(withoutComments(command))
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim().split(/\s+/).filter((word) => word !== ''))
    .some((words) => words.length > 0 && isMutatingGitSegment(words));

/**
 * The refusal text for a mutating git command an unattended agent ran
 * directly against the main checkout.
 *
 * @param scriptDir - the absolute directory holding the plot scripts, so the
 *   refusal can point at the desk helper rather than describe it.
 * @returns the text for stderr.
 */
export const mainCheckoutWriteRefusal = (scriptDir: string): string =>
  [
    'plot-main-checkout-gate: this command mutates git state and the working directory is the MAIN checkout,',
    '  not a desk worktree. An unattended agent writes to its own worktree, never to the checkout the board reads.',
    '',
    `  Resolve the desk worktree first: . "${scriptDir}/plot-desk-root.sh"; plot_desk_root`,
    '  then run this command with that path as the working directory (or `git -C <desk> ...`).',
    '',
    '  If this really is bookkeeping that belongs on the main checkout (e.g. advancing a shared ref), route it',
    '  through a disposable worktree the way plot-dispatch.sh books its Started record, rather than writing here.',
    '',
  ].join('\n');
