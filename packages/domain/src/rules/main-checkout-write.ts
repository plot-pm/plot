/**
 * Whether a command writes git state, and in which directory each write runs,
 * so a gate can refuse an unattended agent's write to the repository's MAIN
 * checkout rather than its own desk worktree (#2311,
 * `docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md`).
 *
 * This module reads the command text only. The caller decides who is asking
 * (`PLOT_UNATTENDED=1`) and whether a directory is a linked worktree.
 */
import { programWords, withoutComments, withoutQuotes, wordBasename } from './ci-suite.js';

/** A git subcommand that mutates `HEAD`, the index, or a ref. */
const MUTATING_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'commit',
  'reset',
  'checkout',
  'restore',
  'merge',
  'rebase',
  'pull',
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

/** The git global options whose value is the next word. */
const GLOBAL_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--super-prefix',
]);

/** The `git branch` options that create, delete, move, copy or reconfigure a branch. */
const BRANCH_WRITE_OPTIONS: ReadonlySet<string> = new Set([
  '-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy', '-f', '--force',
  '-u', '--set-upstream-to', '--unset-upstream', '--edit-description', '-t', '--track', '--no-track',
  '--create-reflog',
]);

/**
 * The `git branch` options that put it in list mode, where a further word is a
 * pattern. A list filter that takes a commit as its next word, given without
 * one of these, reads as a write: a refusal the agent can rephrase.
 */
const BRANCH_LIST_OPTIONS: ReadonlySet<string> = new Set(['-a', '--all', '-r', '--remotes', '-l', '--list', '--show-current']);

/**
 * Whether a mutating subcommand's arguments ask only for a read:
 * `git stash list|show`, and `git branch` with no write option that has no
 * argument, a list option, or `--show-current`.
 */
const readsOnly = (sub: string, args: readonly string[]): boolean => {
  if (sub === 'stash') return args[0] === 'list' || args[0] === 'show';
  if (sub !== 'branch') return false;
  const options = args.filter((word) => word.startsWith('-')).map((word) => word.split('=')[0]);
  if (options.some((option) => BRANCH_WRITE_OPTIONS.has(option))) return false;
  return options.some((option) => BRANCH_LIST_OPTIONS.has(option)) || options.length === args.length;
};

/** Whether a `-C` value is missing, a parameter, a substitution, or quoted text the reader removed. */
const unknowable = (value: string): boolean => /^$|[$`'"]/.test(value);

/**
 * The directory a mutating git call in one simple command runs in.
 *
 * @param words - one simple command, split on whitespace, quotes already removed.
 * @returns `null` for the working directory, the path the `-C` options name,
 *   or `undefined` where the command is no mutating git call or its `-C` path
 *   cannot be read from the text.
 */
const writeDirOf = (words: readonly string[]): string | null | undefined => {
  const program = programWords(words);
  if (program.length === 0 || wordBasename(program[0]) !== 'git') return undefined;
  let i = 1;
  let dir: string | null = null;
  let known = true;
  while (i < program.length && program[i].startsWith('-')) {
    const option = program[i];
    if (!GLOBAL_VALUE_OPTIONS.has(option)) {
      i += 1;
      continue;
    }
    const value = program[i + 1] ?? '';
    if (option === '-C') {
      if (unknowable(value)) known = false;
      else dir = dir === null || value.startsWith('/') ? value : `${dir}/${value}`;
    }
    i += 2;
  }
  const sub = program[i];
  if (sub === undefined || !MUTATING_GIT_SUBCOMMANDS.has(sub) || readsOnly(sub, program.slice(i + 1))) return undefined;
  return known ? dir : undefined;
};

/**
 * The directory of each git call in a command that mutates `HEAD`, the index,
 * or a ref. Quoted text and `#` comments are not read. Each simple command,
 * split on `&&`, `||`, `;`, `|`, new lines, `$(`, backticks and parentheses,
 * is tested on its own. Git global options before the subcommand are skipped,
 * and successive `-C` paths are joined the way git joins them.
 *
 * A call whose `-C` path is a parameter, a substitution or quoted text is left
 * out, because the text does not name the directory it writes to.
 *
 * @param command - the command line.
 * @returns one entry per mutating git call: `null` for the working directory,
 *   otherwise the path its `-C` options name (absolute, or relative to the
 *   working directory).
 */
export const gitWriteDirs = (command: string): readonly (string | null)[] =>
  withoutQuotes(withoutComments(command))
    .split(/&&|\|\||\$\(|[;|\n`()]/)
    .map((segment) => writeDirOf(segment.trim().split(/\s+/).filter((word) => word !== '')))
    .filter((dir): dir is string | null => dir !== undefined);

/**
 * Whether a command line runs a git call that mutates `HEAD`, the index, or a
 * ref in a directory its text names. See {@link gitWriteDirs}.
 *
 * @param command - the command line.
 * @returns whether any simple command is such a call.
 */
export const mutatesGitState = (command: string): boolean => gitWriteDirs(command).length > 0;

/**
 * The refusal text for a mutating git call an unattended agent
 * (`PLOT_UNATTENDED=1`) ran against the main checkout.
 *
 * @param scriptDir - the absolute directory holding the plot scripts, so the
 *   refusal names the desk helper by path.
 * @returns the text for stderr.
 */
export const mainCheckoutWriteRefusal = (scriptDir: string): string =>
  [
    'plot-main-checkout-gate: this command mutates git state in the MAIN checkout, not a desk worktree,',
    '  and PLOT_UNATTENDED=1 marks the caller as an unattended agent. An unattended agent writes to its own',
    '  worktree, never to the checkout the board reads.',
    '',
    `  Resolve the desk worktree first: . "${scriptDir}/plot-desk-root.sh"; plot_desk_root`,
    '  then run this command with that path as the working directory (or `git -C <desk> ...`).',
    '',
    '  If this really is bookkeeping that belongs on the main checkout (e.g. advancing a shared ref), route it',
    '  through a disposable worktree the way plot-dispatch.sh books its Started record, rather than writing here.',
    '',
  ].join('\n');
