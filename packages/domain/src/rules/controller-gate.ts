/**
 * What the controller gate reads of a command, and what it says when it
 * refuses. `controllerInvocation` (`ci-suite.ts`) decides which action a
 * command runs; this file holds the other pure parts of the gate: the
 * heredoc strip, the prefilter, the unpinned-merge reading and the refusal
 * texts.
 */
import { isReadSegment, programWords, withoutComments, withoutQuotes, wordBasename } from './ci-suite.js';

/** The actions a controller owns. */
export type ControllerAction = 'dispatch' | 'approve' | 'deliver' | 'release';

/**
 * Removes the body of every single-quoted heredoc (`<<'EOF'` or `<<-'EOF'`),
 * which is data. The line that opens the heredoc and the terminator line stay;
 * an unquoted or double-quoted heredoc keeps its body, because it can hold a
 * command substitution.
 *
 * @param command - the command line.
 * @returns the command without those bodies.
 */
export const withoutQuotedHeredocs = (command: string): string => {
  const kept: string[] = [];
  let tag: string | null = null;
  for (const line of command.split('\n')) {
    if (tag === null) {
      tag = /<<-?[ \t]*'([^']+)'/.exec(line)?.[1] ?? null;
      kept.push(line);
    } else if (line.replace(/^\t+/, '') === tag) {
      tag = null;
      kept.push(line);
    }
  }
  return kept.join('\n');
};

/** A quoted argument, or a single unquoted word — what follows a flag that takes a value. */
const ARGUMENT = /'[^']*'|"(?:[^"\\]|\\.)*"|\S+/;

/**
 * Blanks the message argument of `git commit -m`/`--message` within a simple
 * command, everywhere that flag appears in `segment` — `-m` may repeat to
 * build a multi-paragraph message. Leaves the flag itself so the command
 * still reads as a `git commit` invocation; blanks only its value.
 *
 * @param segment - one simple command (already isolated from `&&`/`;`/`|`/newline neighbours).
 * @returns the segment with each `-m`/`--message` value replaced by an equal-length run of spaces.
 */
const withoutCommitMessageFlags = (segment: string): string => {
  const pattern = new RegExp(`(^|\\s)(-m|--message)(=|\\s+)(${ARGUMENT.source})`, 'g');
  return segment.replace(pattern, (_whole, lead, flag, sep, value) => `${lead}${flag}${sep}${' '.repeat(value.length)}`);
};

/**
 * Blanks the reason argument of `plot-state-receipt.sh --unowned-action
 * <action> <slug> <reason...>` within a simple command — everything after the
 * slug to the end of the segment, which is the shell script's `"$*"`. Leaves
 * the action and slug words so the segment still reads as that invocation.
 *
 * @param segment - one simple command.
 * @returns the segment with the reason text replaced by an equal-length run of spaces.
 */
const withoutUnownedActionReason = (segment: string): string => {
  const pattern = /(--unowned-action\s+\S+\s+\S+\s+)(.+)$/;
  return segment.replace(pattern, (_whole, head: string, reason: string) => `${head}${' '.repeat(reason.length)}`);
};

// Named once, the same reason ci-suite.ts names DISPATCH_SH/APPROVE_SH/
// DELIVER_SH: `check-script-names.sh` counts a quoted literal as a
// dependency, and this reading classifies a command string — it never
// spawns, sources or shells to the script it names.
const STATE_RECEIPT_SH = 'plot-state-receipt.sh';

/** Whether a word's basename is `plot-state-receipt.sh`. */
const isUnownedActionReceipt = (words: readonly string[]): boolean =>
  words.some((word) => wordBasename(word) === STATE_RECEIPT_SH) && words.includes('--unowned-action');

/** Whether a simple command's program is `git commit`. */
const isGitCommit = (words: readonly string[]): boolean => {
  const program = programWords(words);
  return wordBasename(program[0] ?? '') === 'git' && program[1] === 'commit';
};

/**
 * Whether a `git commit` simple command reads its message from stdin via
 * `-F -`/`--file -` — the shape a following heredoc feeds.
 */
const readsMessageFromStdin = (words: readonly string[]): boolean =>
  words.some((word, i) => (word === '-F' || word === '--file') && words[i + 1] === '-');

/**
 * Removes the two kinds of message-carrying DATA a controller-owned script's
 * name can sit inside with no process ever reading it as a command: a `git
 * commit -m`/`--message` value, the reason argument of `plot-state-receipt.sh
 * --unowned-action`, and — only when the commit reads its message from stdin
 * (`git commit -F -`) — the body of a heredoc that feeds it, same as
 * {@link withoutQuotedHeredocs} but for the unquoted/double-quoted form that
 * function leaves alone.
 *
 * The strip is sink-aware, not position-aware: it names the specific programs
 * whose argument is text they never execute, the same way `READERS` names
 * programs that never run their operand. A program that RUNS its quoted text
 * (`sh -c`, `bash <script>`, `xargs`) is untouched — the quoted span there is
 * the command.
 *
 * A heredoc body is stripped only when it holds no `$(`, backtick or `<(`/`>(`
 * — any of those can invoke a gated script by substitution, so that body stays
 * tokenised. A plain unquoted heredoc feeding a command other than `git commit
 * -F -` is untouched for the same reason {@link withoutQuotedHeredocs} leaves
 * it: this function does not decide what every heredoc means, only the one
 * shape that is provably a commit message.
 *
 * @param command - the command line, with any single-quoted heredoc body
 *   already stripped by {@link withoutQuotedHeredocs}.
 * @returns the command with those data spans blanked to equal-length runs of
 *   spaces, so word boundaries and line numbers are unchanged.
 */
export const withoutMessageSinks = (command: string): string => {
  const lines = command.split('\n');
  const out: string[] = [];
  let tag: string | null = null;
  let body: string[] | null = null; // collecting a candidate stdin-commit body; null when not in one
  const flushBody = () => {
    if (body === null) return;
    const strippable = !body.some((line) => /\$\(|`|[<>]\(/.test(line));
    out.push(...body.map((line) => (strippable ? ' '.repeat(line.length) : line)));
    body = null;
  };
  for (const line of lines) {
    if (tag !== null) {
      const atTerminator = line.replace(/^\t+/, '') === tag;
      if (atTerminator) tag = null;
      if (body !== null) {
        if (atTerminator) flushBody();
        else body.push(line);
      }
      if (atTerminator || body === null) out.push(line);
      continue;
    }
    const heredoc = /<<-?[ \t]*(?:"([^"]*)"|([A-Za-z_]\w*))/.exec(line);
    // Captured so the delimiters rejoin unchanged; only a segment's own text is ever rewritten.
    const parts = line.split(/(&&|\|\||[;|])/);
    let opensStdinCommit = false;
    const processed = parts
      .map((part, i) => {
        if (i % 2 === 1) return part; // a delimiter, not a segment
        const words = part.trim().split(/\s+/).filter((w) => w !== '');
        if (words.length === 0) return part;
        let segment = part;
        if (isGitCommit(words)) segment = withoutCommitMessageFlags(segment);
        if (isUnownedActionReceipt(words)) segment = withoutUnownedActionReason(segment);
        if (isGitCommit(words) && readsMessageFromStdin(words)) opensStdinCommit = true;
        return segment;
      })
      .join('');
    out.push(processed);
    if (heredoc) {
      tag = heredoc[1] ?? heredoc[2] ?? null;
      if (opensStdinCommit) body = [];
    }
  }
  return out.join('\n');
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
 * @param command - the command line, with any single-quoted heredoc body stripped.
 * @returns each merge program a segment runs with no pin, in order; empty when none.
 */
export const unpinnedMerges = (command: string): MergeProgram[] =>
  withoutQuotes(withoutComments(command))
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim().split(/\s+/).filter((word) => word !== ''))
    .filter((words) => words.length > 0)
    .flatMap((words) => {
      const program = unpinnedProgram(words);
      return program === null ? [] : [program];
    });

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
