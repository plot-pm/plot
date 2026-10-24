/**
 * What the controller gate reads of a command, and what it says when it
 * refuses. `controllerInvocation` (`ci-suite.ts`) decides which action a
 * command runs; this file holds the other pure parts of the gate: the
 * heredoc strip, the message-sink strip, the prefilter, the unpinned-merge
 * reading and the refusal texts.
 */
import { isReadSegment, programWords, withoutComments, withoutQuotes, wordBasename } from './ci-suite.js';
import { blankSpans, readShell, type ShellCommand, type ShellWord } from './shell-reading.js';

/** The actions a controller owns. */
export type ControllerAction = 'dispatch' | 'approve' | 'deliver' | 'release';

/**
 * Blanks the body of every single-quoted heredoc (`<<'EOF'` or `<<-'EOF'`),
 * which is data. The line that opens the heredoc and the terminator line stay,
 * and every body character except a new line becomes a space, so line numbers
 * are unchanged. An unquoted or double-quoted heredoc keeps its body, because
 * it can hold a command substitution. A here-string (`<<<`) and a `<<` inside
 * quotes open no heredoc. A command line that `readShell` cannot read, which
 * includes one whose heredoc has no terminator, comes back unchanged.
 *
 * @param command - the command line.
 * @returns the command with those bodies blanked.
 */
export const withoutQuotedHeredocs = (command: string): string => {
  const reading = readShell(command);
  if (reading === null) return command;
  return blankSpans(
    command,
    reading.heredocs.filter((doc) => doc.singleQuoted).map((doc) => [doc.bodyStart, doc.bodyEnd] as const),
  );
};

/**
 * Text that an unquoted heredoc body expands by running something, or that
 * can join into such text: `$( )`, `$[ ]`, `${ }`, a backtick, `<( )`/`>( )`,
 * or a backslash-newline.
 */
const EXPANDS = /`|\$[({[]|[<>]\(|\\\n/;

/** The `git` options before the subcommand that take the next word as their value. */
const GIT_VALUE_OPTIONS: ReadonlySet<string> = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

/** The `git` options before the subcommand that take no value. */
const GIT_FLAG_OPTIONS: ReadonlySet<string> = new Set([
  '--no-pager', '-P', '--no-optional-locks', '--literal-pathspecs', '--no-replace-objects',
]);

/** The `git commit` short options that take no value and may share a cluster with `-m`, as in `-am`. */
const COMMIT_SHORT_FLAGS = 'asnvqeiopz';

/** The `git commit` short options that take the next word as their value when the cluster ends with them. */
const COMMIT_SHORT_VALUES = 'Cct';

// Named once, the same reason ci-suite.ts names DISPATCH_SH/APPROVE_SH/
// DELIVER_SH: `check-script-names.sh` counts a quoted literal as a
// dependency, and this reading classifies a command string — it never
// spawns, sources or shells to the script it names.
const STATE_RECEIPT_SH = 'plot-state-receipt.sh';

/** A `[start, end)` range of the command line. */
type Span = readonly [number, number];

/** The last path segment of a word's value, or `null` when the word is absent or its value is unknown. */
const basename = (word: ShellWord | undefined): string | null =>
  word === undefined || word.value === null ? null : word.value.slice(word.value.lastIndexOf('/') + 1);

/** The span of a whole word, or none when the word is absent or can run something. */
const wholeWord = (word: ShellWord | undefined): Span[] => (word === undefined || word.executes ? [] : [[word.start, word.end]]);

/** The span of a word after `prefix`, or of the whole word when it does not start with `prefix` as written; none when it can run something. */
const afterPrefix = (word: ShellWord, prefix: string): Span[] => {
  if (word.executes) return [];
  return word.raw.startsWith(prefix) ? [[word.start + prefix.length, word.end]] : [[word.start, word.end]];
};

/** The index of the word a simple command runs as its program, past `NAME=value` assignments and `env`. */
const programIndex = (words: readonly ShellWord[]): number =>
  words.length - programWords(words.map((word) => word.raw)).length;

/**
 * The index of `commit` in `git [options] commit`, or `null` when the program
 * is not `git`, a word before `commit` has an unknown value, or an option
 * before it is not in `GIT_VALUE_OPTIONS` or `GIT_FLAG_OPTIONS`.
 */
const commitIndex = (words: readonly ShellWord[], at: number): number | null => {
  if (basename(words[at]) !== 'git') return null;
  let i = at + 1;
  while (i < words.length) {
    const value = words[i].value;
    if (value === null) return null;
    if (value === 'commit') return i;
    if (GIT_VALUE_OPTIONS.has(value)) i += 2;
    else if (GIT_FLAG_OPTIONS.has(value) || /^--(git-dir|work-tree|namespace)=/.test(value)) i += 1;
    else return null;
  }
  return null;
};

/**
 * The message spans of one `git commit` simple command: each `-m`/`--message`
 * value, including `-m` at the end of a cluster such as `-am`, and the body of
 * each heredoc this command's own redirections open when it reads its message
 * from stdin (`-F -`, `--file -`). A value that can run something is no span,
 * and neither is an unquoted body that {@link EXPANDS} matches.
 */
const commitMessageSpans = (command: string, simple: ShellCommand, at: number): Span[] => {
  const { words } = simple;
  const commit = commitIndex(words, at);
  if (commit === null) return [];
  const spans: Span[] = [];
  let stdin = false;
  for (let j = commit + 1; j < words.length; j += 1) {
    const word = words[j];
    const value = word.value;
    if (value === null) continue;
    if (value === '--') break;
    if (value === '-m' || value === '--message') {
      spans.push(...wholeWord(words[j + 1]));
      j += 1;
    } else if (value.startsWith('--message=')) {
      spans.push(...afterPrefix(word, '--message='));
    } else if (value === '-F' || value === '--file') {
      if (words[j + 1]?.value === '-') stdin = true;
      j += 1;
    } else if (value === '--file=-') {
      stdin = true;
    } else if (/^-[A-Za-z]/.test(value)) {
      let k = 1;
      while (k < value.length && COMMIT_SHORT_FLAGS.includes(value[k])) k += 1;
      const flag = value[k];
      const rest = value.slice(k + 1);
      if (flag === 'm' && rest === '') {
        spans.push(...wholeWord(words[j + 1]));
        j += 1;
      } else if (flag === 'm') {
        spans.push(...afterPrefix(word, value.slice(0, k + 1)));
      } else if (flag === 'F' && rest === '') {
        if (words[j + 1]?.value === '-') stdin = true;
        j += 1;
      } else if (flag === 'F' && rest === '-') {
        stdin = true;
      } else if (flag !== undefined && COMMIT_SHORT_VALUES.includes(flag) && rest === '') {
        j += 1;
      }
    }
  }
  if (!stdin) return spans;
  const bodies = simple.heredocs.filter((doc) => doc.quoted || !EXPANDS.test(command.slice(doc.bodyStart, doc.bodyEnd)));
  return [...spans, ...bodies.map((doc) => [doc.bodyStart, doc.bodyEnd] as const)];
};

/**
 * The reason spans of `plot-state-receipt.sh --unowned-action <action> <slug>
 * <reason...>`, run as the program itself or as `bash|sh <script>`: every word
 * after the slug that runs nothing. Any other position of the script name is
 * no span.
 */
const receiptReasonSpans = (words: readonly ShellWord[], at: number): Span[] => {
  const shell = basename(words[at]);
  const script = shell === 'bash' || shell === 'sh' ? at + 1 : at;
  if (basename(words[script]) !== STATE_RECEIPT_SH || words[script + 1]?.value !== '--unowned-action') return [];
  return words.slice(script + 4).flatMap(wholeWord);
};

/**
 * Blanks the message-carrying DATA a controller-owned script's name can sit
 * in with no process ever running it. There are three kinds:
 *
 * - the value of `git commit -m`/`--message`, including `-m` closing a
 *   cluster such as `-am`, and with `git -C <dir>` or another known global
 *   option before `commit`;
 * - the reason words of `plot-state-receipt.sh --unowned-action <action>
 *   <slug>`, when the program is that script or `bash`/`sh` running it;
 * - the body of a heredoc opened by the `git commit -F -` simple command
 *   itself — never one opened by another command on the same line.
 *
 * The strip is sink-aware: it names the programs whose argument is text they
 * never run, the same way `READERS` names programs that never run their
 * operand. A program that runs its text (`sh -c`, `bash <script>`, `xargs`)
 * is untouched.
 *
 * It blanks only text the shell never runs. A value or reason word that holds
 * `$( )`, a backtick, `${ }`, `$'…'` or a backslash-newline stays, and so
 * does an unquoted heredoc body that holds any of `$( )`, `$[ ]`, `${ }`, a
 * backtick, `<( )`/`>( )` or a backslash-newline. A command line that
 * `readShell` cannot read — an unterminated quote or heredoc, `case`, a
 * function definition — comes back unchanged.
 *
 * @param command - the command line, with any single-quoted heredoc body
 *   already blanked by {@link withoutQuotedHeredocs}.
 * @returns the command with those spans blanked to spaces, new lines kept, so
 *   word boundaries and line numbers are unchanged.
 */
export const withoutMessageSinks = (command: string): string => {
  const reading = readShell(command);
  if (reading === null) return command;
  const spans = reading.commands.flatMap((simple) => {
    const at = programIndex(simple.words);
    return [...commitMessageSpans(command, simple, at), ...receiptReasonSpans(simple.words, at)];
  });
  return blankSpans(command, spans);
};

/**
 * Whether a command could name a controller-owned script or merge a pull
 * request. A word passes when it contains `plot-dispatch`, `plot-approve` or
 * `plot-deliver`, when it ends `.sh` or `.mjs` and holds a glob character, or
 * when it is `merge` or `pr-merge`. The test may over-pass and never
 * under-passes: it only decides whether the full reading is worth its cost.
 *
 * @param command - the command line.
 * @returns whether the full reading should run.
 */
export const mayRunController = (command: string): boolean =>
  command.split(/\s+/).some(
    (word) =>
      /plot-(dispatch|approve|deliver)/.test(word) ||
      /\.(sh|mjs)$/.test(word) && /[*?[\]]/.test(word) ||
      word === 'merge' ||
      word === 'pr-merge',
  );

/** A program that merges a pull request: `gh pr merge`, or the host helper's `pr-merge`. */
export type MergeProgram = 'gh' | 'plot-host';

/** The flag each merge program takes to pin the head it merges. */
export const PIN_FLAG: Record<MergeProgram, string> = {
  gh: '--match-head-commit',
  'plot-host': '--match-head',
};

/** Shell builtins that run the next word as the program. */
const PREFIXES: ReadonlySet<string> = new Set(['command', 'builtin', 'exec']);

/** Whether a word is `flag` or `flag=<value>`. */
const isFlag = (word: string, flag: string): boolean => word === flag || word.startsWith(`${flag}=`);

/** The merge program a simple command runs with no pin, or `null`. */
const unpinnedProgram = (words: readonly string[]): MergeProgram | null => {
  if (isReadSegment(words)) return null;
  const all = programWords(words);
  let start = 0;
  while (PREFIXES.has(all[start])) start += 1;
  const program = all.slice(start);
  const merges: MergeProgram | null =
    program.length > 0 && wordBasename(program[0]) === 'gh' && program.some((w, i) => w === 'pr' && program[i + 1] === 'merge')
      ? 'gh'
      : program.some((w) => /^plot-host\.sh$/.test(wordBasename(w))) && program.includes('pr-merge')
        ? 'plot-host'
        : null;
  return merges !== null && !program.some((w) => isFlag(w, PIN_FLAG[merges])) ? merges : null;
};

/**
 * The merges a command runs without pinning the head it reviewed: `gh pr
 * merge` with no `--match-head-commit`, and the host helper's `pr-merge` with
 * no `--match-head`. Quoted text and unquoted `#` comments are not read; a
 * `command`, `builtin` or `exec` prefix is skipped; a segment whose program is
 * `ls`, `cat` or `git grep` is a read.
 *
 * When that segment reading finds none, the simple commands `readShell`
 * finds are read the same way, which includes a command inside `$( )` or
 * `<( )` within quotes: `git commit -m "$(gh pr merge 12)"` runs the merge.
 *
 * @param command - the command line, with any single-quoted heredoc body blanked.
 * @returns each merge program a command runs with no pin, in order; empty when none.
 */
export const unpinnedMerges = (command: string): MergeProgram[] => {
  const segments = withoutQuotes(withoutComments(command))
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim().split(/\s+/).filter((word) => word !== ''))
    .filter((words) => words.length > 0)
    .flatMap((words) => {
      const program = unpinnedProgram(words);
      return program === null ? [] : [program];
    });
  if (segments.length > 0) return segments;
  return (readShell(command)?.commands ?? []).flatMap((simple) => {
    const program = unpinnedProgram(simple.words.map((word) => word.value ?? word.raw));
    return program === null ? [] : [program];
  });
};

/** Quotes a path for a shell, leaving a plain one bare. */
const shellQuote = (value: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);

/** The HTTP request each action's button sends. */
const ENDPOINT: Record<ControllerAction, string> = {
  dispatch: 'POST /api/dispatch {"slug":"<slug>"}',
  approve: 'POST /api/approve {"slug":"<slug>"}',
  deliver: 'POST /api/deliver {"slug":"<slug>"}',
  release: 'POST /api/release {"slug":"<slug>","version":"<version>"}',
};

/** The request body of the spike mode of `approve`. */
const SPIKE_ENDPOINT = 'POST /api/approve {"slug":"<slug>","spike":true}';

/**
 * Whether a command line asks for the spike mode of `approve`.
 *
 * @param command - the command line, with quoted heredoc bodies removed.
 * @returns true when a word of the command is exactly `--spike`.
 */
export const carriesSpikeFlag = (command: string): boolean =>
  command.split(/\s+/).includes('--spike');

/**
 * The refusal for a controller-owned action called with no controller receipt.
 * It names the HTTP endpoint first and the receipt escape second. Only
 * dispatch has a board-free bundle to name; `approve` and `deliver` take
 * `--who`/`--release` modes the gate itself reads as a run, so the text does
 * not send the reader to them.
 *
 * @param action - the action the command runs.
 * @param scriptDir - the absolute directory holding the plot scripts.
 * @param spike - whether the command line carries `--spike`; an `approve`
 *   refusal then names the request body that carries `"spike":true`.
 * @returns the text for stderr.
 */
export const controllerRefusal = (action: ControllerAction, scriptDir: string, spike = false): string => {
  const owner = action === 'release' ? 'deliver' : action;
  const named = `plot-${owner}.sh`;
  const lines = [`plot-controller-gate: ${named} is a controller-owned action.`, '', '  Call the controller instead:'];
  if (action === 'dispatch') {
    lines.push(`      node ${shellQuote(`${scriptDir}/board/plot-dispatch-command.mjs`)} <slug>`);
    lines.push(`    which runs with no board. With the board up, ${ENDPOINT[action]} is its button, and /plot-dispatch asks it.`);
  } else {
    lines.push(`      ${spike && action === 'approve' ? SPIKE_ENDPOINT : ENDPOINT[action]}`);
    lines.push(`    which is the board's button, and /plot-${owner} asks it.`);
  }
  lines.push(
    '',
    '  Or, where the board is not running and you accept the bypass, run these as TWO calls, in this order:',
    `      1. bash ${shellQuote(`${scriptDir}/plot-state-receipt.sh`)} --unowned-action ${action} <slug> "<reason>"`,
    `      2. the ${action} command you meant`,
    '    A chained `receipt && command` is checked before either runs, and is refused. The receipt stays until the',
    '    action exits 0.',
    '',
    '  The reason is required and it is counted to .plot/state/unowned-action-writes.tsv, because a gate with no',
    '  exit is one people route around and an uncounted exit is an off switch.',
    '',
  );
  return lines.join('\n');
};

/**
 * The refusal for a merge with no head pin. It names the controller command
 * first and then the pin flag of the program refused.
 *
 * For `gh`, it also names the reach of that command: `gh` speaks to one git
 * host, so a repository on a different host has no `--match-head-commit` to
 * add — there, the merge runs through `plot-host.sh pr-merge` instead, which
 * pins where its host can and runs unpinned where it cannot.
 *
 * @param scriptDir - the absolute directory holding the plot scripts.
 * @param program - the merge program the command runs.
 * @returns the text for stderr.
 */
export const unpinnedMergeRefusal = (scriptDir: string, program: MergeProgram): string =>
  [
    'plot-controller-gate: a merge must be pinned to the head that was reviewed.',
    '',
    '  Merge through the controller, which re-asks the host and merges pinned to <sha> or refuses by name:',
    `      node ${shellQuote(`${scriptDir}/board/plot-ask.mjs`)} merge <pr> <sha>`,
    `  Or add ${PIN_FLAG[program]} <sha> to the merge you meant.`,
    ...(program === 'gh'
      ? ['  gh speaks to one git host: a repository on another host has no --match-head-commit to add —', '    there, the merge runs through plot-host.sh pr-merge instead, pinned where its host allows it.']
      : []),
    '',
  ].join('\n');

/**
 * Whether an unpinned merge is allowed because the git host cannot pin one:
 * `plot-host.sh pr-merge` on a host whose `pr-merge --match-head` cannot pin.
 *
 * @param program - the merge program the command runs.
 * @param hostPins - whether the resolved git host pins a merge to a commit.
 * @returns whether the merge goes through unpinned.
 */
export const pinUnavailable = (program: MergeProgram, hostPins: boolean): boolean =>
  program === 'plot-host' && !hostPins;

/** The note for a merge {@link pinUnavailable} lets through. */
export const UNPINNABLE_NOTE =
  'plot-controller-gate: the Git host cannot pin a merge to a commit — this pr-merge runs unpinned.';
