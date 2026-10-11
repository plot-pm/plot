/**
 * Whether a shell command runs a suite the project leaves to CI.
 *
 * A project lists those suites in the `CI suites` config key. An agent at a
 * fleet desk that starts one is refused, with the local checks command to run
 * instead. The match reads only where a command runs: a `grep`, a commit
 * message or a PR body that mentions a suite passes.
 */

/** A refused command, naming the suite it starts. */
export interface CiSuiteRefusal {
  readonly suite: string;
}

/** A leading `NAME=value` assignment. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/;

/**
 * Removes quoted text, so a suite named inside quotes is not read as run.
 *
 * @param command - the command line.
 * @returns the command with every quoted span emptied.
 */
export const withoutQuotes = (command: string): string =>
  command.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');

/** A single- or double-quoted span. */
const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/g;

/**
 * Removes every unquoted `#` comment: the `#` and the rest of its line. A `#`
 * starts a comment at the start of a line or after whitespace; `$#`, `${#x}`
 * and a `#` inside quotes do not.
 *
 * @param command - the command line.
 * @returns the command with each comment cut off at its `#`.
 */
export const withoutComments = (command: string): string => {
  const blanked = command.replace(QUOTED, (span) => span.replace(/[^\n]/g, ' '));
  const lines = command.split('\n');
  const scanned = blanked.split('\n');
  return lines
    .map((line, i) => {
      const hash = /(^|\s)#/.exec(scanned[i]);
      return hash === null ? line : line.slice(0, hash.index + hash[1].length);
    })
    .join('\n');
};

/** `for NAME in LIST; do` — the list ends at the first `;` or new line. */
const FOR_LOOP = /\bfor\s+([A-Za-z_]\w*)\s+in\s+([^;\n]*?)\s*(?:;|\n)\s*do\b/g;

/** Programs that read their operands and never run one. */
const READERS: ReadonlySet<string> = new Set([
  'cmp', 'diff', 'cat', 'ls', 'grep', 'head', 'tail', 'wc', 'shasum', 'sha256sum', 'stat', 'test', '[',
]);

/** The `git` subcommands that read and never run an operand. */
const GIT_READERS: ReadonlySet<string> = new Set(['diff', 'show', 'log', 'grep']);

/** Whether a simple command's program is a reader: one of `READERS`, or `git diff|show|log|grep`. */
const isReader = (words: readonly string[]): boolean => {
  const [head, sub] = programWords(words);
  if (head === undefined) return false;
  const name = wordBasename(head);
  return READERS.has(name) || (name === 'git' && GIT_READERS.has(sub));
};

/**
 * The simple commands of a loop body: the text after `do` up to the segment
 * that is `done`, split on `&&`, `||`, `;`, `|` and new lines.
 */
const bodySegments = (after: string): string[][] => {
  const segments: string[][] = [];
  for (const segment of after.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).filter((w) => w !== '');
    if (words[0] === 'done') break;
    if (words.length > 0) segments.push(words);
  }
  return segments;
};

/**
 * Removes the word list of a `for` loop whose body only reads: every simple
 * command in the body has a reader as its program (`cmp`, `diff`, `cat`, `ls`,
 * `grep`, `head`, `tail`, `wc`, `shasum`, `sha256sum`, `stat`, `test`, `[`,
 * `git diff|show|log|grep`), and the body holds no command substitution. Any
 * other body keeps the list, so a name in it reads as a run.
 *
 * @param command - the command line.
 * @returns the command with such word lists emptied.
 */
const withoutDataLists = (command: string): string => {
  let out = command;
  for (const match of [...command.matchAll(FOR_LOOP)].reverse()) {
    const { index: at } = match;
    const after = command.slice(at + match[0].length);
    const body = bodySegments(after);
    if (!body.every(isReader) || body.some((words) => words.some((w) => /\$\(|`|[<>]\(/.test(w)))) continue;
    const listStart = at + match[0].indexOf(match[2], match[0].indexOf(' in ') + 1);
    out = out.slice(0, listStart) + out.slice(listStart + match[2].length);
  }
  return out;
};

/**
 * Strips what precedes the program a simple command runs: `NAME=value`
 * assignments, and `env` with its options and assignments.
 *
 * @param words - one simple command, split on whitespace.
 * @returns the words from the program on.
 */
export const programWords = (words: readonly string[]): string[] => {
  let i = 0;
  while (i < words.length && ASSIGNMENT.test(words[i])) i += 1;
  if (words[i] === 'env') {
    i += 1;
    while (i < words.length) {
      const word = words[i];
      if (word === '-u' || word === '--unset' || word === '-C' || word === '--chdir') i += 2;
      else if (word.startsWith('-') || ASSIGNMENT.test(word)) i += 1;
      else break;
    }
  }
  return words.slice(i);
};

/**
 * Decides whether a command runs one of the suites.
 *
 * The command is split into simple commands on `&&`, `||`, `;`, `|` and new
 * lines, after quoted text is removed. A simple command runs a suite when its
 * words, from the program on, begin with that suite's words.
 *
 * @param command - the command line an agent is about to run.
 * @param suites - the `CI suites` entries.
 * @returns the refusal, or `null` when the command runs none of them.
 */
export const ciSuiteRefusal = (command: string, suites: readonly string[]): CiSuiteRefusal | null => {
  const entries = suites.map((suite) => ({ suite, words: suite.trim().split(/\s+/) })).filter((e) => e.words[0] !== '');
  if (entries.length === 0) return null;
  const segments = withoutQuotes(command).split(/&&|\|\||[;|\n]/);
  for (const segment of segments) {
    const words = programWords(segment.trim().split(/\s+/).filter((word) => word !== ''));
    for (const entry of entries) {
      if (entry.words.length <= words.length && entry.words.every((word, i) => words[i] === word)) {
        return { suite: entry.suite };
      }
    }
  }
  return null;
};

/**
 * Which controller-owned action a command runs, if any.
 *
 * `plot-controller-gate.sh` refuses `plot-dispatch.sh`, `plot-approve.sh` and
 * `plot-deliver.sh` invoked with no controller receipt. Deciding which of
 * those a command RUNS — as opposed to reads or mentions — lived in a shell
 * token loop that could not be unit tested; this is that decision, moved.
 *
 * | command | answer |
 * | --- | --- |
 * | `ls skills/plot/scripts/plot-dispatch.sh` | `null` — a read |
 * | `git grep -l plot-deliver.sh -- '*.sh'` | `null` — a read |
 * | `cat plot-approve.sh` | `null` — a read |
 * | `bash skills/plot/scripts/plot-dispatch.sh x` | `'dispatch'` |
 * | `./plot-approve.sh x` | `'approve'` |
 * | `for s in a b; do plot-dispatch.sh $s; done` | `'dispatch'` — a loop body |
 * | `bash skills/plot/scripts/*dispatch.sh x` | `'dispatch'` — a glob matching one name |
 * | `ls skills/plot/scripts/*.sh` | `null` — a glob matching all three |
 * | `plot-deliver.sh --release 2.22.3 x` | `'release'`, not `'deliver'` |
 * | `plot-dispatch.sh --release <branch>` | `null` — no endpoint for this mode |
 * | `node skills/plot/scripts/board/plot-deliver.mjs x` | `'deliver'` — the launcher's own bundle |
 * | `node .../plot-deliver.mjs --release 2.22.3 x` | `'release'`, the bundle read the same as the launcher |
 * | `node .../plot-deliver.mjs --dry-run x` | `null` — no endpoint for this mode |
 * | `node skills/plot/scripts/board/plot-approve.mjs x` | `'approve'` — the launcher's own bundle |
 * | `node .../plot-approve.mjs --dry-run x` | `null` — no endpoint for this mode |
 *
 * A script named is a RUN unless its segment's program is `ls`, `cat` or
 * `git grep` — the three reads #1245 measured the token loop getting wrong.
 * Everything else a script's basename appears in, including a loop body or an
 * unquoted heredoc line, is read as a run: that is deliberate, not a gap left
 * by this reading. A single-quoted heredoc body (`<<'EOF'` or `<<-'EOF'`) is
 * data and must be stripped by the caller before this is asked; an unquoted
 * body stays tokenised because it can hold a command substitution.
 *
 * A glob word ending `.sh` or `.mjs` is matched as a pattern against the gated
 * basenames; it answers only where exactly one of them matches, so `*.sh` —
 * matching all three — is not a run.
 *
 * An unquoted `#` starts a comment: it and the rest of its line are not read.
 * The word after `--who` or `--release` is that flag's value and is never read
 * as a mode. The word list of a `for` loop whose body only runs readers
 * (`for f in plot-deliver.sh; do cmp $f x; done`) is data, not a run; any
 * other body keeps the list.
 *
 * @param command - the command line an agent is about to run, with any
 *   single-quoted heredoc body already stripped.
 * @returns the action, or `null` when the command runs none of the three.
 */
export const controllerInvocation = (command: string): 'dispatch' | 'approve' | 'deliver' | 'release' | null => {
  for (const segment of withoutDataLists(withoutComments(command)).split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).filter((word) => word !== '');
    if (words.length === 0) continue;
    if (isReadSegment(words)) continue;
    for (const word of words) {
      const script = scriptNamed(word);
      if (script === null) continue;
      return actionFor(script, words);
    }
  }
  return null;
};

// Named once, so the three scripts this reading knows appear as a single
// literal each rather than once per table they are keys of — the shape
// `check-script-names.sh` counts is a quoted literal, not a dependency this
// classification has on what the scripts do.
const DISPATCH_SH = 'plot-dispatch.sh';
const APPROVE_SH = 'plot-approve.sh';
const DELIVER_SH = 'plot-deliver.sh';
// THE BUNDLE IS A SECOND NAME FOR THE SAME GATED ACTION, since
// `the-first-script-becomes-a-command` made `plot-deliver.sh` a launcher: an
// agent running `node .../board/plot-deliver.mjs` directly skips the launcher
// and would otherwise skip this gate too, walking around the controller the
// same way a direct call to the `.sh` always could have.
const DELIVER_MJS = 'plot-deliver.mjs';
// `approval-becomes-a-command` did the same to `plot-approve.sh`.
const APPROVE_MJS = 'plot-approve.mjs';

/** The scripts a command may run, and the action each bare call is. */
const GATED: Record<string, 'dispatch' | 'approve' | 'deliver'> = {
  [DISPATCH_SH]: 'dispatch',
  [APPROVE_SH]: 'approve',
  [APPROVE_MJS]: 'approve',
  [DELIVER_SH]: 'deliver',
  [DELIVER_MJS]: 'deliver',
};
const GATED_NAMES = Object.keys(GATED);

/** A word's path basename, with a glued assignment, grouping or quote prefix and trailing punctuation dropped. */
export const wordBasename = (word: string): string => {
  const stripped = word
    .replace(/^[A-Za-z_][A-Za-z0-9_]*=/, '')
    .replace(/^\$?["'(]+/, '')
    .replace(/[)\];,"']+$/, '');
  // `String.split` always returns at least one element, even for `''`, so the
  // last element is never `undefined` — no fallback is reachable here.
  const parts = stripped.split('/');
  return parts[parts.length - 1];
};

/**
 * A plain glob word (`*`, `?`, `[...]`) turned into a RegExp matching a
 * basename, for the one caller that needs to test it against several names.
 */
const globToRegExp = (glob: string): RegExp => {
  const escaped = glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
};

/**
 * Whether a command runs the script named `name`, by basename, anywhere among
 * its whitespace-split words — the third matcher for "does this command run
 * script N", alongside `controllerInvocation`'s three names and the CI-suite
 * arm's `plot-local-checks.mjs`. `startCommand` asks this of a configured
 * `Worker command` against the worker loop's basename, so it carries no
 * read/run carve-out: a loop that merely mentions the script does not arise
 * in that caller's readings, and adding one here would be a second decision
 * for a question this one already answers.
 *
 * @param command - the command line.
 * @param name - the script's basename to look for.
 * @returns whether any word's basename equals `name`.
 */
export const commandRunsScript = (command: string, name: string): boolean =>
  command.split(/\s+/).some((word) => wordBasename(word) === name);

/**
 * The gated script a word names, by exact basename or by a glob matching
 * exactly one of the three.
 */
const scriptNamed = (word: string): string | null => {
  const base = wordBasename(word);
  if (base in GATED) return base;
  if (/\.(sh|mjs)$/.test(base) && /[*?[\]]/.test(base)) {
    const pattern = globToRegExp(base);
    const hits = GATED_NAMES.filter((name) => pattern.test(name));
    if (hits.length === 1) return hits[0];
  }
  return null;
};

/** Whether a segment's program is a read that this reading carves out: `ls`, `cat`, `git grep`. */
export const isReadSegment = (words: readonly string[]): boolean => {
  const program = programWords(words);
  if (program.length === 0) return false;
  const head = wordBasename(program[0]);
  if (head === 'ls' || head === 'cat') return true;
  return head === 'git' && program[1] === 'grep';
};

/** Each gated script's modes with no endpoint. The approve entry has no `--status` mode, so `--status` on it is a run. */
const NO_ENDPOINT: Record<string, readonly string[]> = {
  [APPROVE_SH]: ['--dry-run', '--help', '-h'],
  [APPROVE_MJS]: ['--dry-run', '--help', '-h'],
  [DELIVER_SH]: ['--status', '--dry-run', '--help', '-h'],
  [DELIVER_MJS]: ['--status', '--dry-run', '--help', '-h'],
  [DISPATCH_SH]: [
    '--status', '--dry-run', '--stop', '--restart', '--start', '--migrate', '--release', '--help', '-h',
  ],
};

/** The flags whose next word is their value. */
const VALUE_FLAGS: ReadonlySet<string> = new Set(['--who', '--release']);

/** The action a call on `script` runs, reading `--release` as a fourth action on `plot-deliver.sh`/`plot-deliver.mjs` alone. */
const actionFor = (script: string, words: readonly string[]): 'dispatch' | 'approve' | 'deliver' | 'release' | null => {
  // The word after `--who` or `--release` is that flag's value, whatever it looks like.
  const flags = words.filter((_, i) => !VALUE_FLAGS.has(words[i - 1]));
  if (flags.some((word) => NO_ENDPOINT[script]?.includes(word))) return null;
  if ((script === DELIVER_SH || script === DELIVER_MJS) && words.includes('--release')) return 'release';
  return GATED[script];
};
