/**
 * Whether a command writes git state, and in which directory each write runs,
 * so a gate can refuse an unattended agent's write to the repository's MAIN
 * checkout rather than its own desk worktree (#2311,
 * `docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md`).
 *
 * This module reads the command text only, and {@link gatesMainCheckout} reads
 * the environment. The caller decides whether a directory is a linked worktree.
 */
import { programWords, withoutComments, withoutQuotes, wordBasename } from './ci-suite.js';
import { SPAWN_CONTRACT, type SpawnContractReading } from './spawn-contract.js';

/**
 * The variable a spawn sets to `1` when its agent writes the main checkout by
 * design: the `Brief command` and the deliver, reslice, story and auto-deliver
 * runs, and the dispatch brief launch, which commit a brief, a `Started:`
 * record or a plan there. A desk worker's launch sets it empty. The implement
 * run does NOT set it (#2740, `a98afb890`, 2026-10-26, removed it there).
 */
export const MAIN_CHECKOUT_WRITER_ENV = 'PLOT_MAIN_CHECKOUT_WRITER';

/**
 * Whether the main-checkout gate applies to a process with this environment:
 * an unattended agent (`PLOT_UNATTENDED=1`) that its spawn did not mark as a
 * main-checkout writer ({@link MAIN_CHECKOUT_WRITER_ENV}`=1`).
 *
 * The gate reads its own process environment, which the agent's session sets
 * at spawn. A `VAR=1 git commit` prefix in the command text changes the
 * environment of the git call, not of the gate, so it cannot mark a caller.
 *
 * @param env - the environment of the gate's process.
 * @returns whether a mutating git call in the main checkout is refused.
 */
export const gatesMainCheckout = (env: Readonly<Record<string, string | undefined>>): boolean =>
  env.PLOT_UNATTENDED === '1' && env[MAIN_CHECKOUT_WRITER_ENV] !== '1';

/** A git subcommand that mutates `HEAD`, the index, or a ref. */
const MUTATING_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'add',
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
  'tag',
  'notes',
  'clean',
  'fetch',
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
 * Whether a short-option word (`-n`, `-fd`, `-fx`, …) carries the one-letter
 * flag `letter` among the letters it combines.
 */
const hasShortFlag = (word: string, letter: string): boolean =>
  /^-[a-zA-Z]+$/.test(word) && word.slice(1).includes(letter);

/**
 * Whether a mutating subcommand's arguments ask only for a read:
 * `git stash list|show`; `git branch` with no write option that has no
 * argument, a list option, or `--show-current`; `git tag -l`/`--list`; `git
 * notes list|show`; `git clean -n`/`--dry-run` (a dry run mutates nothing,
 * even combined with `-f` as `-nf`); and `git fetch` whose refspec arguments
 * hold no `:` (no local ref is named to update).
 */
const readsOnly = (sub: string, args: readonly string[]): boolean => {
  if (sub === 'stash' || sub === 'notes') return args[0] === 'list' || args[0] === 'show';
  if (sub === 'tag') return args.some((word) => word === '-l' || word === '--list' || hasShortFlag(word, 'l'));
  if (sub === 'clean') {
    if (args.some((word) => word === '-n' || word === '--dry-run' || hasShortFlag(word, 'n'))) return true;
    return !args.some((word) => word === '-f' || word === '--force' || hasShortFlag(word, 'f'));
  }
  if (sub === 'fetch') return !args.some((word) => !word.startsWith('-') && word.includes(':'));
  if (sub !== 'branch') return false;
  const options = args.filter((word) => word.startsWith('-')).map((word) => word.split('=')[0]);
  if (options.some((option) => BRANCH_WRITE_OPTIONS.has(option))) return false;
  return options.some((option) => BRANCH_LIST_OPTIONS.has(option)) || options.length === args.length;
};

/** Whether a `-C` or `cd` value is missing, a parameter, a substitution, or quoted text the reader removed. */
const unknowable = (value: string): boolean => /^$|[$`'"]/.test(value);

/**
 * A directory relative to `base`, the way git joins `-C` paths and `cd`
 * resolves one: `undefined` where `base` is unknown and `value` is relative.
 */
const joined = (base: string | null | undefined, value: string): string | undefined => {
  if (base === null || value.startsWith('/')) return value;
  return base === undefined ? undefined : `${base}/${value}`;
};

/**
 * The directory a simple command moves the shell to, read from its text.
 *
 * @param words - one simple command, split on whitespace, quotes already removed.
 * @param base - the directory before it: `null` for the working directory,
 *   `undefined` where an earlier command made it unknown.
 * @returns `base` for a command that is no `cd` or `pushd`, the joined path for
 *   a literal argument, and `undefined` for `popd` or an argument the text does
 *   not give (none, `-`, `~…`, a parameter, a substitution or quoted text).
 */
const cdOf = (words: readonly string[], base: string | null | undefined): string | null | undefined => {
  const program = programWords(words);
  if (program[0] === 'popd') return undefined;
  if (program[0] !== 'cd' && program[0] !== 'pushd') return base;
  const args = program.slice(1).filter((word) => !/^-[LPe@]+$|^--$/.test(word));
  const value = args[0] ?? '';
  return unknowable(value) || value === '-' || value.startsWith('~') ? undefined : joined(base, value);
};

/**
 * The shell keywords a git call can follow in the same simple command: an
 * `if`/`elif`/`while`/`until` test, a `for` loop's `do`, a `{` brace group, a
 * `!` negation, and a `time` prefix. One is stripped at a time, so `! time
 * git …` is read after two strips.
 */
const LEADING_KEYWORDS: ReadonlySet<string> = new Set(['if', 'elif', 'while', 'until', 'do', '{', '!', 'time']);

/**
 * `words` with every leading shell keyword removed, so a git call named right
 * after one is read the same as a bare call. Keeps stripping while the first
 * word is a keyword, so `! time git commit` and `{ ! git commit` both reach
 * `git` as word 0.
 *
 * @param words - one simple command, split on whitespace.
 * @returns `words` with its leading keyword run removed.
 */
const withoutLeadingKeywords = (words: readonly string[]): readonly string[] => {
  let i = 0;
  while (i < words.length && LEADING_KEYWORDS.has(words[i])) i += 1;
  return words.slice(i);
};

/**
 * The directory a mutating git call in one simple command runs in.
 *
 * @param words - one simple command, split on whitespace, quotes already removed.
 * @param base - the directory an earlier `cd` moved to: `null` for the working
 *   directory, `undefined` where the text does not give it.
 * @param accepts - narrows which mutating calls count; receives the subcommand and its arguments.
 * @returns `base` joined with the path the `-C` options name, or `undefined`
 *   where the command is no mutating git call, `accepts` refuses it, or its directory cannot be read
 *   from the text. An absolute `-C` path places the call whatever came before it.
 */
const writeDirOf = (
  words: readonly string[],
  base: string | null | undefined,
  accepts: (sub: string, args: readonly string[]) => boolean = () => true,
): string | null | undefined => {
  const program = programWords(withoutLeadingKeywords(words));
  if (program.length === 0 || wordBasename(program[0]) !== 'git') return undefined;
  let i = 1;
  let dir = base;
  while (i < program.length && program[i].startsWith('-')) {
    const option = program[i];
    if (!GLOBAL_VALUE_OPTIONS.has(option)) {
      i += 1;
      continue;
    }
    const value = program[i + 1] ?? '';
    if (option === '-C') dir = unknowable(value) ? undefined : joined(dir, value);
    i += 2;
  }
  const sub = program[i];
  if (sub === undefined || !MUTATING_GIT_SUBCOMMANDS.has(sub) || readsOnly(sub, program.slice(i + 1))) return undefined;
  return accepts(sub, program.slice(i + 1)) ? dir : undefined;
};

/**
 * `command` with the body of every unquoted heredoc (`<<EOF`, `<<-EOF`,
 * `<<'EOF'`, `<<"EOF"`) blanked out, so a git call written there is not read
 * as a command. The opener line and the delimiter line that ends it are kept;
 * only the lines between become empty. A `<<-` opener allows the delimiter
 * line to carry leading tabs or spaces.
 *
 * @param command - the command line.
 * @returns `command` with each heredoc body replaced by blank lines.
 */
const withoutHeredocBodies = (command: string): string => {
  const lines = command.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);
    const opener = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    i += 1;
    if (!opener) continue;
    const indented = line.includes('<<-');
    const delimiter = opener[2];
    while (i < lines.length) {
      const body = lines[i];
      const read = indented ? body.replace(/^[\t ]+/, '') : body;
      if (read === delimiter) {
        out.push(body);
        i += 1;
        break;
      }
      out.push('');
      i += 1;
    }
  }
  return out.join('\n');
};

/**
 * The separators between simple commands; the capture keeps them in the
 * split. `&&` is tried before the single-`&` alternative, so a backgrounding
 * `&` never splits a `&&` it is part of.
 */
const SEPARATORS = /(&&|\|\||\$\(|[;|\n`()]|&)/;

/**
 * The directory of each git call in a command that mutates `HEAD`, the index,
 * or a ref. The body of an unquoted heredoc is not read ({@link
 * withoutHeredocBodies}), nor are quoted text and `#` comments. Each simple
 * command, split on `&&`, `||`, `;`, `|`, a single `&`, new lines, `$(`,
 * backticks and parentheses, is tested on its own, with a leading shell
 * keyword ({@link LEADING_KEYWORDS}) stripped first. Git global options
 * before the subcommand are skipped, and successive `-C` paths are joined
 * the way git joins them.
 *
 * A `cd` or `pushd` with a literal argument moves the directory every later
 * call is judged in, and `-C` paths join onto it. Its effect ends at the `)`
 * or backtick that closes the `(`, `$(` or backtick it was given in. A `|`
 * does not end it, although bash runs each side of a pipe in a subshell.
 *
 * Calls the text cannot place are left out, so the gate allows them: a `-C`
 * path or `cd` argument that is a parameter, a substitution or quoted text
 * (`cd "$desk"`, the form `plot_desk_root` produces), and every call after a
 * `popd`, a bare `cd`, `cd -` or `cd ~`, until an absolute `cd` or `-C` path
 * places them again. Refusing them would refuse the desk-root form the
 * refusal text recommends.
 *
 * `--git-dir` and `--work-tree` are skipped, not judged: such a call is
 * placed by its `-C` paths and `cd`, not by the repository those options name.
 *
 * @param command - the command line.
 * @returns one entry per mutating git call: `null` for the working directory,
 *   otherwise the path its `cd` and `-C` arguments name (absolute, or relative
 *   to the working directory).
 */
export const gitWriteDirs = (command: string): readonly (string | null)[] => writeDirsWhere(command);

/** {@link gitWriteDirs} over the mutating calls `accepts` keeps. */
const writeDirsWhere = (
  command: string,
  accepts?: (sub: string, args: readonly string[]) => boolean,
): readonly (string | null)[] => {
  const parts = withoutQuotes(withoutComments(withoutHeredocBodies(command))).split(SEPARATORS);
  const outer: (string | null | undefined)[] = [];
  const dirs: (string | null)[] = [];
  let here: string | null | undefined = null;
  let inBacktick = false;
  for (const [index, part] of parts.entries()) {
    if (index % 2 === 1) {
      const opens = part === '(' || part === '$(' || (part === '`' && !inBacktick);
      const closes = part === ')' || (part === '`' && inBacktick);
      if (part === '`') inBacktick = !inBacktick;
      if (opens) outer.push(here);
      else if (closes && outer.length > 0) here = outer.pop();
      continue;
    }
    // A word that runs on into `$(` or a backtick is a substitution the text does not give.
    const next = parts[index + 1];
    const runsOn = (next === '$(' || (next === '`' && !inBacktick)) && /\S$/.test(part);
    const words = `${part}${runsOn ? '$' : ''}`.trim().split(/\s+/).filter((word) => word !== '');
    const dir = writeDirOf(words, here, accepts);
    if (dir !== undefined) dirs.push(dir);
    here = cdOf(words, here);
  }
  return dirs;
};

/** The `git reset` modes that update the working tree with the index, or leave both as they were. */
const TREE_CONSISTENT_RESET_FLAGS: ReadonlySet<string> = new Set(['--hard', '--soft', '--keep', '--merge']);

/**
 * Whether `git reset` arguments leave the index out of step with the working
 * tree. Mixed is git's default, so the test is the absence of a tree-consistent
 * flag: `--hard`, `--soft`, `--keep` and `--merge` are consistent; `--mixed`,
 * `-q`, a commit alone and `-- <path>` are not.
 */
const stranding = (sub: string, args: readonly string[]): boolean =>
  sub === 'reset' && !args.some((word) => TREE_CONSISTENT_RESET_FLAGS.has(word));

/**
 * The directory of each `git reset` in a command that moves the index without
 * the working tree (a mixed reset, including `git reset -- <path>`). Reads the
 * command the way {@link gitWriteDirs} does.
 *
 * @param command - the command line.
 * @returns one entry per such call: `null` for the working directory, else the
 *   path its `cd` and `-C` arguments name.
 */
export const treeStrandingResetDirs = (command: string): readonly (string | null)[] => writeDirsWhere(command, stranding);

/**
 * Whether a command line runs a mixed `git reset`. See {@link treeStrandingResetDirs}.
 *
 * @param command - the command line.
 * @returns whether any simple command is such a call.
 */
export const strandsTree = (command: string): boolean => treeStrandingResetDirs(command).length > 0;

/**
 * Whether the tree-stranding reset check applies to a process with this
 * environment: any unattended agent (`PLOT_UNATTENDED=1`), including one its
 * spawn marked as a main-checkout writer. The marker lets that agent commit
 * there; it does not let it leave the working tree behind `HEAD`.
 *
 * @param env - the environment of the gate's process.
 * @returns whether a mixed reset in the main checkout is refused.
 */
export const gatesStrandingReset = (env: Readonly<Record<string, string | undefined>>): boolean => env.PLOT_UNATTENDED === '1';

/**
 * Whether a command line runs a git call that mutates `HEAD`, the index, or a
 * ref in a directory its text names. See {@link gitWriteDirs}.
 *
 * @param command - the command line.
 * @returns whether any simple command is such a call.
 */
export const mutatesGitState = (command: string): boolean => gitWriteDirs(command).length > 0;

/**
 * The arguments of every `git push` in a command, after the word `push`. The
 * command is split the way {@link gitWriteDirs} splits it: heredoc bodies,
 * quoted text and comments are not read, and a leading shell keyword is
 * stripped.
 *
 * @param command - the command line.
 * @returns one entry per `git push` call, options and operands in order.
 */
export const gitPushCalls = (command: string): readonly (readonly string[])[] => {
  const calls: string[][] = [];
  for (const part of withoutQuotes(withoutComments(withoutHeredocBodies(command))).split(SEPARATORS)) {
    const program = programWords(withoutLeadingKeywords(part.trim().split(/\s+/).filter((word) => word !== '')));
    if (program.length === 0 || wordBasename(program[0]) !== 'git') continue;
    let i = 1;
    while (i < program.length && program[i].startsWith('-')) i += GLOBAL_VALUE_OPTIONS.has(program[i]) ? 2 : 1;
    if (program[i] === 'push') calls.push(program.slice(i + 1));
  }
  return calls;
};

/**
 * The desk-worktree instruction every main-checkout refusal gives, and the
 * mixed-reset paragraph both arms of {@link mainCheckoutGateOf} can trigger.
 *
 * @param scriptDir - the absolute directory holding the plot scripts, so the
 *   refusal names the desk helper by path.
 * @returns the lines common to both refusals.
 */
const commonRefusalLines = (scriptDir: string): readonly string[] => [
  'plot-main-checkout-gate: this command mutates git state in the MAIN checkout, not a desk worktree,',
  '  and PLOT_UNATTENDED=1 marks the caller as an unattended agent. An unattended agent writes to its own',
  '  worktree, never to the checkout the board reads.',
  '',
  `  Resolve the desk worktree first: . "${scriptDir}/plot-desk-root.sh"; plot_desk_root`,
  '  then run this command with that path as the working directory (or `git -C <desk> ...`).',
  '',
  '  A mixed `git reset` (no --hard/--soft) moves HEAD and leaves the working tree behind it, so a later',
  '  `git add -A` commits the reverse of the commits it skipped. Allowed: `git reset --hard <ref>` on files',
  '  you own, or a re-cut in a disposable worktree.',
];

/**
 * Whether `reading` proves this process's spawner carried a different
 * {@link SPAWN_CONTRACT} number than this gate — `absent`, or a number that
 * differs. `empty` and `unreadable` are "no information," not "stale," and
 * prove nothing: treating them as `absent` would accuse a corrupted-but-not-
 * stale environment of being a stale spawner.
 */
const provenSkew = (reading: SpawnContractReading): boolean =>
  reading === 'absent' || (typeof reading === 'object' && reading.number !== SPAWN_CONTRACT);

/**
 * The paragraph naming a proven spawn-contract skew: the spawner's number (or
 * `none` for `absent`) against this gate's, and the instruction to stop and
 * report rather than route around the refusal — the one sentence #2725's agent
 * needed and did not have (#2728).
 *
 * @param reading - the gate's reading of its own spawn contract.
 * @returns the paragraph's lines, newest-spawner-direction included.
 */
const spawnerSkewLines = (reading: SpawnContractReading): readonly string[] => {
  const spawner = reading === 'absent' ? 'none' : typeof reading === 'object' ? String(reading.number) : '';
  const direction =
    reading === 'absent' || (typeof reading === 'object' && reading.number < SPAWN_CONTRACT)
      ? 'older'
      : 'newer';
  return [
    '',
    `  The process that spawned this agent carried spawn contract ${spawner}, against this gate's ${SPAWN_CONTRACT} — it`,
    `  loaded ${direction} gate-reading code than this gate. If this run writes the main checkout BY DESIGN`,
    '  (deliver, reslice, story, auto-deliver or brief), stop and report this refusal rather than working',
    '  around it: a stale spawner is the likely cause, not a mistake in this command.',
  ];
};

/**
 * The refusal text for a mutating git call an unattended agent
 * (`PLOT_UNATTENDED=1`) ran against the main checkout.
 *
 * A proven spawn-contract skew ({@link provenSkew}) adds a paragraph naming
 * both numbers and telling a by-design writer to stop and report rather than
 * route around the refusal — and that paragraph's case DROPS the "disposable
 * worktree" sentence below, because that sentence is what sent #2725's agent
 * around the refusal instead of reporting it (#2728). `empty`, `unreadable`
 * or an equal number add no such paragraph, and the sentence stays.
 *
 * @param scriptDir - the absolute directory holding the plot scripts, so the
 *   refusal names the desk helper by path.
 * @param reading - the gate's reading of its own spawn contract.
 * @returns the text for stderr.
 */
export const mainCheckoutWriteRefusal = (scriptDir: string, reading: SpawnContractReading): string => {
  const skewed = provenSkew(reading);
  const lines = [
    ...commonRefusalLines(scriptDir),
    ...(skewed ? spawnerSkewLines(reading) : []),
  ];
  if (!skewed) {
    lines.push(
      '',
      '  If this really is bookkeeping that belongs on the main checkout (e.g. advancing a shared ref), route it',
      '  through a disposable worktree the way plot-dispatch.sh books its Started record, rather than writing here.',
    );
  }
  lines.push('');
  return lines.join('\n');
};

/**
 * The refusal text for a mixed `git reset` ({@link strandsTree}) an
 * unattended agent ran against the main checkout — the arm {@link
 * gatesStrandingReset} fires regardless of {@link MAIN_CHECKOUT_WRITER_ENV},
 * so a marked writer must never read a sentence about a missing marker when
 * only this arm fired.
 *
 * @param scriptDir - the absolute directory holding the plot scripts, so the
 *   refusal names the desk helper by path.
 * @returns the text for stderr.
 */
export const strandingResetRefusal = (scriptDir: string): string =>
  [...commonRefusalLines(scriptDir), ''].join('\n');
