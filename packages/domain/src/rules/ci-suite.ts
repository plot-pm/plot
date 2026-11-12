/**
 * Whether a shell command runs a suite the project leaves to CI.
 *
 * A project lists those suites in the `CI suites` config key. An agent at a
 * fleet desk that starts one is refused, with the local checks command to run
 * instead. The match reads only where a command runs: a `grep`, a commit
 * message or a PR body that mentions a suite passes.
 */

import { readShell } from './shell-reading.js';

/** A refused command, naming the suite it starts. */
export interface CiSuiteRefusal {
  readonly suite: string;
}

/**
 * The files whose presence marks a tree as under a managed process: a fleet
 * desk holds the first, a pinned verification run's `pin/` tree the second.
 */
export const MANAGED_PROCESS_MARKERS: readonly string[] = ['.plot-worker.pid', '.plot-verify.pid'];

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

/** A command or process substitution: `$(`, a backtick, `<(` or `>(`. */
const SUBSTITUTION = /\$\(|`|[<>]\(/;

/** Whether any word holds a command or process substitution. */
const hasSubstitution = (words: readonly string[]): boolean => words.some((w) => SUBSTITUTION.test(w));

/** Programs that read their operands and never run one. */
const READERS: ReadonlySet<string> = new Set([
  'cmp', 'diff', 'cat', 'ls', 'grep', 'head', 'tail', 'wc', 'shasum', 'sha256sum', 'stat', 'test', '[',
]);

/** The `git` subcommands that read and never run an operand. */
const GIT_READERS: ReadonlySet<string> = new Set(['diff', 'show', 'log', 'grep']);

/** The programs that read the process table and signal nothing. */
const PROCESS_READERS: ReadonlySet<string> = new Set(['pgrep', 'ps', 'lsof']);

/** A `pgrep` option that signals what it finds: `--signal`, `-<digits>`, `-KILL`, `-SIGTERM`. */
const SIGNAL_FORM = /^(--signal(=.*)?|-\d+|-[A-Z]{2,})$/;

/**
 * Whether a simple command reads the process table: after at most one leading
 * `while` or `until`, the program is `pgrep`, `ps` or `lsof`. The command must
 * be one simple command that `readShell` reads, with no heredoc, no word that
 * executes, and no signal option on `pgrep`. Whitespace-split words keep their
 * quote characters, so the line is read again with `readShell` and the
 * operands are the quote-free values.
 *
 * @param words - one simple command, split on whitespace.
 * @returns whether the command only looks at processes.
 */
const isProcessRead = (words: readonly string[]): boolean => {
  const reading = readShell(words.join(' '));
  if (reading === null || reading.commands.length !== 1 || reading.heredocs.length > 0) return false;
  const [command] = reading.commands;
  if (command.words.some((word) => word.executes)) return false;
  const values = command.words.map((word) => word.value ?? word.raw);
  const at = values[0] === 'while' || values[0] === 'until' ? 1 : 0;
  if (values[at] === undefined || !PROCESS_READERS.has(wordBasename(values[at]))) return false;
  if (wordBasename(values[at]) === 'pgrep' && values.slice(at + 1).some((w) => SIGNAL_FORM.test(w))) return false;
  return true;
};

/**
 * Whether a simple command's program is a reader: one of `READERS`,
 * `git diff|show|log|grep`, or a process-table read (`isProcessRead`).
 */
const isReader = (words: readonly string[]): boolean => {
  const [head, sub] = programWords(words);
  if (head === undefined) return false;
  const name = wordBasename(head);
  return READERS.has(name) || (name === 'git' && GIT_READERS.has(sub)) || isProcessRead(words);
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
 * `git diff|show|log|grep`, `pgrep`, `ps`, `lsof`), and the body holds no command substitution. Any
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
    if (!body.every(isReader) || body.some(hasSubstitution)) continue;
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
 * | `node .../board/plot-ask.mjs release-approve 1 abc1234` | `'release-approve'` |
 * | `node .../board/plot-ask.mjs merge 1 abc1234` | `null` — a different subcommand |
 * | `curl -X POST http://localhost:4000/api/release` | `'release'` |
 * | `curl -X POST http://localhost:4000/api/release-approve` | `'release-approve'` |
 * | `curl -X POST http://localhost:4000/api/restart` | `'restart'` |
 * | `curl -X POST http://localhost:4000/api/loose-delete` | `'loose-delete'` |
 * | `curl http://localhost:4000/api/release` | `null` — GET, the default method |
 * | `curl -X POST http://localhost:4000/api/dispatch` | `null` — a different route |
 * | `grep release-approve docs/plans/*.md` | `null` — a read |
 * | `node .../plot-approve.mjs --dry-run x` | `null` — no endpoint for this mode |
 *
 * A script named is a RUN unless its segment's program is a reader
 * (`isReadSegment`, delegating to `isReader`'s set, which includes a
 * process-table read: `pgrep`, `ps` or `lsof`, optionally after one `while` or
 * `until`, with no signal option; such a segment is a read only when every
 * other segment of its pipeline is a read) and the segment holds no
 * substitution, no assignment or `env` prefix, and no git option that runs or
 * writes. Everything else a script's basename appears in, including a loop
 * body or an unquoted heredoc line, is read as a run: that is deliberate, not
 * a gap left by this reading. A single-quoted heredoc body (`<<'EOF'` or
 * `<<-'EOF'`) is data and must be stripped by the caller before this is
 * asked; an unquoted body stays tokenised because it can hold a command
 * substitution.
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
 * @returns the action, or `null` when the command runs none of the gated actions.
 */
export const controllerInvocation = (command: string): GatedAction | null => {
  for (const words of nonReadSegments(command)) {
    const route = httpRouteAction(words);
    if (route !== null) return route;
    for (const word of words) {
      if (wordBasename(word) === ASK_MJS && words.includes('release-approve')) return 'release-approve';
      const script = scriptNamed(word);
      if (script === null) continue;
      return actionFor(script, words);
    }
  }
  return null;
};

/**
 * The segments of a command that are not reads, each as its words. A command
 * splits on `&&`, `||`, `;` and new lines into pipelines, and a pipeline on
 * `|` into segments. A segment that only `isProcessRead` admits counts as a
 * read when every other segment of its pipeline is a read, so `pgrep -f x |
 * xargs kill` keeps both segments.
 */
const nonReadSegments = (command: string): string[][] => {
  const out: string[][] = [];
  for (const pipeline of withoutDataLists(withoutComments(command)).split(/&&|\|\||[;\n]/)) {
    const segments = pipeline.split('|')
      .map((segment) => segment.trim().split(/\s+/).filter((word) => word !== ''))
      .filter((words) => words.length > 0);
    const allRead = segments.every(isReadSegment);
    for (const words of segments) {
      const processOnly = isProcessRead(words);
      if (isReadSegment(words) && (!processOnly || allRead)) continue;
      out.push(words);
    }
  }
  return out;
};

/**
 * Whether a command is specifically an HTTP client call that POSTs to one of
 * the three gated board routes — as opposed to a script or bundle call that
 * {@link controllerInvocation} classifies to the same `'release'`/`'restart'`
 * action. The caller that must offer the bundle call no receipt escape for
 * the HTTP form, while leaving the bundle form's own receipt escape alone,
 * reads this rather than re-deriving it from `controllerInvocation`'s answer.
 *
 * @param command - the command line an agent is about to run, with any
 *   single-quoted heredoc body already stripped.
 * @returns the action, or `null` when no segment is a gated HTTP call.
 */
export const controllerHttpAction = (command: string): GatedAction | null => {
  for (const words of nonReadSegments(command)) {
    const route = httpRouteAction(words);
    if (route !== null) return route;
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
// `plot-ask.mjs` answers several questions and runs two actions
// (`merge`, `release-approve`); only its `release-approve` subcommand is
// gated here, so it is matched by name and subcommand together rather than
// joining `GATED`'s bare-script lookup.
const ASK_MJS = 'plot-ask.mjs';

/** The lifecycle actions a gated script call can be. */
export type GatedAction = 'dispatch' | 'approve' | 'deliver' | 'release' | 'release-approve' | 'restart' | 'loose-delete';

/** The scripts a command may run, and the action each bare call is. */
const GATED: Record<string, 'dispatch' | 'approve' | 'deliver'> = {
  [DISPATCH_SH]: 'dispatch',
  [APPROVE_SH]: 'approve',
  [APPROVE_MJS]: 'approve',
  [DELIVER_SH]: 'deliver',
  [DELIVER_MJS]: 'deliver',
};
const GATED_NAMES = Object.keys(GATED);

/** A word's path basename, with a glued assignment, grouping, quote or substitution prefix and trailing punctuation dropped. */
export const wordBasename = (word: string): string => {
  const stripped = word
    .replace(/^[A-Za-z_][A-Za-z0-9_]*=/, '')
    .replace(/^`|^\$?["'(]+|^[<>]\(/, '')
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

/** A `git` option that runs or writes a program, on `git diff|show|log|grep`. */
const GIT_RUN_OPTIONS = /^(--ext-diff|--textconv|--output(=.*)?|-O.*|--open-files-in-pager(=.*)?)$/;

/**
 * Whether a segment's program is a read: `isReader`'s set, with none of a
 * command or process substitution in any word, an assignment or `env` prefix,
 * or (on `git`) an option that runs or writes a program.
 */
export const isReadSegment = (words: readonly string[]): boolean => {
  if (!isReader(words)) return false;
  if (hasSubstitution(words)) return false;
  const program = programWords(words);
  if (program.length !== words.length) return false;
  if (wordBasename(program[0]) === 'git' && words.some((w) => GIT_RUN_OPTIONS.test(w))) return false;
  return true;
};

/** Each gated script's modes with no endpoint. The approve entry has no `--status` mode, so `--status` on it is a run. */
const NO_ENDPOINT: Record<string, readonly string[]> = {
  [APPROVE_SH]: ['--dry-run', '--help', '-h'],
  [APPROVE_MJS]: ['--dry-run', '--help', '-h'],
  [DELIVER_SH]: ['--status', '--dry-run', '--help', '-h'],
  [DELIVER_MJS]: ['--status', '--dry-run', '--help', '-h'],
  [DISPATCH_SH]: [
    '--status', '--dry-run', '--stop', '--start', '--migrate', '--release', '--help', '-h',
  ],
};

/** The flags whose next word is their value. */
const VALUE_FLAGS: ReadonlySet<string> = new Set(['--who', '--release']);

/** The action a call on `script` runs, reading `--release` as a fourth action on `plot-deliver.sh`/`plot-deliver.mjs` alone and `--restart` as a fifth on `plot-dispatch.sh`. */
const actionFor = (script: string, words: readonly string[]): GatedAction | null => {
  // The word after `--who` or `--release` is that flag's value, whatever it looks like.
  const flags = words.filter((_, i) => !VALUE_FLAGS.has(words[i - 1]));
  if (flags.some((word) => NO_ENDPOINT[script]?.includes(word))) return null;
  if ((script === DELIVER_SH || script === DELIVER_MJS) && words.includes('--release')) return 'release';
  if (script === DISPATCH_SH && words.includes('--restart')) return 'restart';
  return GATED[script];
};

/** The programs that can make an HTTP request, by basename. */
const HTTP_PROGRAMS: ReadonlySet<string> = new Set(['curl', 'wget', 'http', 'https', 'httpie']);

/**
 * The three board routes this gate refuses, each requiring a POST, longest
 * first so `/api/release-approve` is tried before the `/api/release` prefix
 * it would otherwise also match.
 */
const ROUTE_ACTION: ReadonlyArray<readonly [string, GatedAction]> = [
  ['/api/release-approve', 'release-approve'],
  ['/api/release', 'release'],
  ['/api/restart', 'restart'],
  ['/api/loose-delete', 'loose-delete'],
];

/** The quote characters a URL or a method may be wrapped in, dropped before either is read. */
const QUOTES = /^['"]+|['"]+$/g;

/** A word with any wrapping quote dropped, so `"http://host/api/release"` reads as the bare URL. */
const unquoted = (word: string): string => word.replace(QUOTES, '');

/** A path segment naming one of `ROUTE_ACTION`'s routes, found in a URL-shaped word. The route must end the word or be followed by `/`, `?` or `#`, so `/api/release2` names no route. A wrapping quote is dropped first, so a quoted URL reads the same as a bare one. */
const routeIn = (word: string): GatedAction | null => {
  const bare = unquoted(word);
  for (const [route, action] of ROUTE_ACTION) {
    const at = bare.indexOf(route);
    if (at === -1) continue;
    const after = bare[at + route.length];
    if (after === undefined || after === '/' || after === '?' || after === '#') return action;
  }
  return null;
};

/**
 * A `curl` long option that sends a request body, which makes `curl` POST
 * unless an explicit method overrides it: every `--data*` form
 * (`--data-raw`, `--data-binary`, `--data-urlencode`, `--data-ascii`),
 * `--json` and `--form`. A long option's value is glued with `=` or follows
 * as the next word.
 */
const CURL_BODY_LONG = /^(--data(-raw|-binary|-urlencode|-ascii)?|--json|--form)(=|$)/;

/**
 * A `curl` short option that sends a body, `-d` or `-F`, in a short-option
 * group. A short option takes its value glued with no separator (`-d@body`,
 * `-dslug=x`) or as the next word, so the value is not read here — only that
 * the group holds the flag. The group may carry other flags first (`-sd@body`).
 * The letters after the single `-` never cross a second `-`, so a long option
 * such as `--dump-header` is not read as a group — `CURL_BODY_LONG` names the
 * long forms that do send a body.
 */
const CURL_BODY_SHORT = /^-[A-Za-z]*[dF]/;

/** A `wget` option that sends a request body, which makes `wget` POST unless `--method` overrides it. */
const WGET_BODY_FLAG = /^(--post-data|--post-file|--body-data|--body-file)(=|$)/;

/** The explicit method a `curl` word names: `-X POST`, `--request POST`, `--request=POST` or a grouped `-sXPOST`. Returns the method, `'next'` when the value is the following word, or `null`. */
const curlMethodIn = (word: string): string | 'next' | null => {
  const bare = unquoted(word);
  if (bare === '-X' || bare === '--request') return 'next';
  if (bare.startsWith('--request=')) return unquoted(bare.slice('--request='.length)).toUpperCase();
  // A short-option group ends at `X`, whose value is the rest of the word
  // (`-sXPOST`) or, when it ends the group (`-sX`), the following word. The
  // letters after the single `-` never cross a second `-`, so no long option
  // reaches here — `--request` is read above and `--max-time` matches nothing.
  const group = /^-[A-Za-z]*X(.*)$/.exec(bare);
  if (group !== null) return group[1] === '' ? 'next' : unquoted(group[1]).toUpperCase();
  return null;
};

/** The explicit method a `wget` word names: `--method=POST` or `--method POST`. */
const wgetMethodIn = (word: string): string | 'next' | null => {
  const bare = unquoted(word);
  if (bare === '--method') return 'next';
  if (bare.startsWith('--method=')) return unquoted(bare.slice('--method='.length)).toUpperCase();
  return null;
};

/** The HTTP methods `httpie` takes as its first operand, so `http POST :4000/api/release` reads as a POST. */
const HTTPIE_METHODS: ReadonlySet<string> = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
]);

/**
 * An `httpie` request item that sends a body, which makes `httpie` POST when
 * no method is named: `field=value`, `field:=json`, `field@file` and
 * `field=@file`. A header (`Name:Value`), a query parameter (`k==v`) and an
 * option (`-x`) send no body, and neither does a bare URL.
 */
const HTTPIE_BODY_ITEM = /^[A-Za-z_][\w.-]*(:?=@?|@)(?!=)/;

/**
 * The method an HTTP client call uses, read per program so each client's own
 * way of naming or implying a POST is understood.
 *
 * An explicit method always wins over one a body flag implies, because that is
 * what the clients do: `curl -d x -X GET <url>` sends a GET.
 *
 * - **`curl`** POSTs on `-d`/`--data*`/`--json`/`-F`, whether the value is
 *   glued (`-d@body`) or the next word, and takes its method from
 *   `-X`/`--request`, including a grouped `-sXPOST`.
 * - **`wget`** POSTs on `--post-data`/`--post-file`/`--body-data`/`--body-file`,
 *   and takes its method from `--method`.
 * - **`httpie`** (`http`, `https`, `httpie`) takes an optional method as its
 *   first operand, and otherwise POSTs when any request item sends a body.
 *
 * @param program - the segment's words from the program on.
 * @returns the method in upper case, `'GET'` when none is named or implied.
 */
const httpMethod = (program: readonly string[]): string => {
  const name = wordBasename(program[0]);
  const isHttpie = name === 'http' || name === 'https' || name === 'httpie';
  const explicitIn = name === 'wget' ? wgetMethodIn : curlMethodIn;
  /** Whether a word is a body flag for this program, reading a `curl` short-option group apart from a long option. */
  const sendsBody = (bare: string): boolean =>
    name === 'wget' ? WGET_BODY_FLAG.test(bare) : CURL_BODY_LONG.test(bare) || CURL_BODY_SHORT.test(bare);
  let explicit: string | null = null;
  let implied: string | null = null;
  let operands = 0;
  for (let i = 1; i < program.length; i += 1) {
    const word = program[i];
    const bare = unquoted(word);
    if (isHttpie) {
      // httpie's method, when given, is the first operand before the URL.
      if (!bare.startsWith('-')) {
        operands += 1;
        if (operands === 1 && HTTPIE_METHODS.has(bare.toUpperCase())) explicit = bare.toUpperCase();
        else if (HTTPIE_BODY_ITEM.test(bare)) implied = 'POST';
      }
      continue;
    }
    const named = explicitIn(word);
    if (named === 'next') {
      const value = program[i + 1];
      if (value !== undefined) {
        explicit = unquoted(value).toUpperCase();
        i += 1;
      }
    } else if (named !== null) explicit = named;
    else if (sendsBody(bare)) implied = 'POST';
  }
  return explicit ?? implied ?? 'GET';
};

/**
 * Whether a segment is an HTTP client call that POSTs to one of the gated
 * board routes, and which action that is. `controllerHttpAction` is the
 * public form of this reading, run once per segment the same way this
 * function's caller, `controllerInvocation`, already splits a command.
 *
 * A GET is never gated: these routes only act on a POST. That covers the
 * default method, an explicit `GET`, and the documented
 * `GET /api/release/<slug>` poll. A URL naming a different route
 * (`/api/dispatch`) is likewise not gated — this reading is for exactly the
 * three named routes. {@link httpMethod} reads the method, so a quoted URL, a
 * body-implied POST, a grouped short option and `wget`/`httpie` forms are all
 * read the same as a bare `curl -X POST`.
 *
 * @param words - one segment's words, already past the read-segment carve-out.
 * @returns the action, or `null` when the segment is not a gated HTTP call.
 */
const httpRouteAction = (words: readonly string[]): GatedAction | null => {
  const program = programWords(words);
  if (program.length === 0) return null;
  if (!HTTP_PROGRAMS.has(wordBasename(program[0]))) return null;
  const route = program.map(routeIn).find((action) => action !== null) ?? null;
  if (route === null) return null;
  return httpMethod(program) === 'POST' ? route : null;
};
