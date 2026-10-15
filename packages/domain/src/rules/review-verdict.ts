/** The severity counts a reviewer's verdict file states. */
export interface ReviewCounts {
  high: number;
  medium: number;
  low: number;
}

/** What `reviewVerdict` answers: the counts, or the reason the file is refused. */
export type ReviewVerdict =
  | { read: 'counted'; counts: ReviewCounts }
  | { read: 'refused'; why: string };

const COUNT_LINE = /^Findings:/;
const COUNT_SHAPE = /^Findings: HIGH (\d+), MEDIUM (\d+), LOW (\d+)\s*$/;

/**
 * Reads the severity counts from a reviewer's verdict file.
 *
 * The file must hold exactly one line starting `Findings:`, and that line must
 * read `Findings: HIGH <n>, MEDIUM <n>, LOW <n>` with each `<n>` a
 * non-negative integer. Nothing else in the file is interpreted.
 *
 * @param text - the verdict file's contents.
 * @returns the counts, or a refusal naming what is wrong: no such line, more
 *   than one, or a line whose counts are not integers in that order.
 */
export const reviewVerdict = (text: string): ReviewVerdict => {
  const lines = text.split(/\r?\n/).filter((line) => COUNT_LINE.test(line));
  if (lines.length === 0) return { read: 'refused', why: 'no "Findings:" line' };
  if (lines.length > 1) return { read: 'refused', why: `${lines.length} "Findings:" lines, expected one` };

  const match = COUNT_SHAPE.exec(lines[0]!);
  if (match === null) {
    return { read: 'refused', why: `"Findings:" line is not "Findings: HIGH <n>, MEDIUM <n>, LOW <n>": ${lines[0]}` };
  }
  const [high, medium, low] = [match[1]!, match[2]!, match[3]!].map(Number) as [number, number, number];
  if (![high, medium, low].every(Number.isSafeInteger)) {
    return { read: 'refused', why: `"Findings:" count out of range: ${lines[0]}` };
  }
  return { read: 'counted', counts: { high, medium, low } };
};

/** The largest argument, in bytes, that Linux passes to `exec` (`MAX_ARG_STRLEN`). The review prompt is one argument. */
export const REVIEW_ARGUMENT_LIMIT = 131_072;

/**
 * The bytes of the review prompt reserved for everything but the diff: the
 * charter's prompt, the fixed request block and the changed-file list. The
 * largest charter prompt file in this repository is 13,563 bytes, the fixed
 * block is under 2,000, and the remaining 17,000 bytes hold about 200 paths.
 */
export const REVIEW_PROMPT_RESERVE = 32_768;

/** The largest diff, in UTF-8 bytes, that a review request carries inline. */
export const REVIEW_INLINE_DIFF_LIMIT = REVIEW_ARGUMENT_LIMIT - REVIEW_PROMPT_RESERVE;

/** The heading under which a reviewer may name content outside the change. */
export const OUTSIDE_THE_CHANGE_HEADING = 'Outside this change';

/** What a review request names about one pull request. */
export interface ReviewRequest {
  pr: number;
  headSha: string;
  base: string;
  /** The merge base of the base branch and the head commit. */
  mergeBase: string;
  /** The paths the change touches, from `git diff --name-only <mergeBase>..<headSha>`. */
  files: readonly string[];
  /** The absolute path of a file holding the full diff, `git diff <mergeBase>..<headSha>`. */
  diffPath: string;
  /** The full diff text. */
  diff: string;
}

/**
 * The fixed review-request block appended to the reviewer charter's prompt.
 *
 * The block names the change exactly: the merge base, the changed files and
 * the path of the full diff. The diff itself is inline when it holds at most
 * {@link REVIEW_INLINE_DIFF_LIMIT} UTF-8 bytes, and is left out otherwise.
 *
 * @param request - the pull request, its head, its base branch and its change.
 * @returns the block: the PR facts, the change, the scope rule, the severity
 *   rubric, the read-only rule, and the instruction to end the final answer
 *   with the one `Findings:` line.
 */
export const reviewRequestBlock = (request: ReviewRequest): string => {
  const range = `${request.mergeBase}..${request.headSha}`;
  const diffBytes = Buffer.byteLength(request.diff, 'utf8');
  const inline = diffBytes <= REVIEW_INLINE_DIFF_LIMIT;
  return [
    'Review request',
    `Pull request: #${request.pr}`,
    `Head commit: ${request.headSha}`,
    `Base branch: ${request.base}`,
    `Merge base: ${request.mergeBase}`,
    '',
    `The change is \`git diff ${range}\`. The working tree is checked out at the head commit.`,
    '',
    `Changed files (${request.files.length}):`,
    ...(request.files.length === 0 ? ['- (none)'] : request.files.map((file) => `- ${file}`)),
    '',
    `Full diff: ${request.diffPath}`,
    ...(inline
      ? ['', '```diff', request.diff.replace(/\n$/, ''), '```']
      : [`The diff holds ${diffBytes} bytes, more than ${REVIEW_INLINE_DIFF_LIMIT} bytes, so it is not inline. Read it from the file above.`]),
    '',
    'Scope: judge only this change. Content the change does not add, remove or modify is not a finding of this pull request, even where it is wrong.',
    `You may name such content only under a separate heading "${OUTSIDE_THE_CHANGE_HEADING}". It never counts in the Findings: line.`,
    '',
    'Severity:',
    '- HIGH: a security leak, a wrong result users hit, or a break of main or of merges.',
    '- MEDIUM: a defect that does not meet the HIGH bar.',
    '- LOW: a style or maintainability point.',
    '',
    'Read-only: your tools read and search files and do nothing else. Write no file.',
    '',
    'Give your verdict as your final answer. List each finding with its severity, then end with exactly one line:',
    'Findings: HIGH <n>, MEDIUM <n>, LOW <n>',
  ].join('\n');
};

/** The only tools the reviewer's harness offers it: read and search. */
export const REVIEWER_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];

/** The tools the reviewer's harness removes by name as well, in case a harness build ignores the tool list. */
export const REVIEWER_DENY: readonly string[] = [
  'Write', 'Edit', 'NotebookEdit', 'Bash', 'Agent', 'Task', 'WebFetch', 'WebSearch',
];

/** A model or effort word the reviewer command accepts; it is single-quoted into the command. */
const COMMAND_WORD = /^[A-Za-z0-9._:[\]-]+$/;

/** `value` single-quoted for a POSIX shell, with each `'` written as `'\''`. */
const singleQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** What `reviewerCommand` answers: the shell fragment, or the reason none is built. */
export type ReviewerCommand = { read: 'command'; command: string } | { read: 'refused'; why: string };

/**
 * The shell fragment that runs the reviewer read-only, for the `command`
 * agent runner. The prompt follows it as an argument.
 *
 * The fragment runs `claude -p` with only {@link REVIEWER_TOOLS}, removes
 * {@link REVIEWER_DENY} by name, loads user settings only (`--setting-sources
 * user`, so no hook or permission rule from the reviewed tree applies),
 * denies every permission the settings do not grant (`--permission-mode
 * dontAsk`), and loads no MCP server (`--strict-mcp-config`). It never names
 * `bypassPermissions`. Each of `readDirs` is passed as `--add-dir`, single-quoted,
 * so the reviewer may read files there outside its working tree.
 *
 * @param charter - the reviewer charter's harness, model and effort.
 * @param readDirs - absolute directories outside the working tree the reviewer reads.
 * @returns the fragment, or a refusal for a harness other than `claude` or a
 *   model or effort word outside `[A-Za-z0-9._:[\]-]`.
 */
export const reviewerCommand = (
  charter: { harness: string; model: string; effort: string },
  readDirs: readonly string[],
): ReviewerCommand => {
  if (charter.harness !== '' && charter.harness !== 'claude') {
    return { read: 'refused', why: `the reviewer runs read-only on claude only; the charter names harness '${charter.harness}'` };
  }
  for (const [key, value] of [['model', charter.model], ['effort', charter.effort]] as const) {
    if (value !== '' && !COMMAND_WORD.test(value)) {
      return { read: 'refused', why: `the charter's ${key} '${value}' is not a single word` };
    }
  }
  const command = [
    'claude',
    '-p',
    ...(charter.model === '' ? [] : ['--model', `'${charter.model}'`]),
    ...(charter.effort === '' ? [] : ['--effort', `'${charter.effort}'`]),
    ...readDirs.flatMap((dir) => ['--add-dir', singleQuote(dir)]),
    '--tools',
    REVIEWER_TOOLS.join(','),
    '--disallowedTools',
    REVIEWER_DENY.join(','),
    '--setting-sources',
    'user',
    '--permission-mode',
    'dontAsk',
    '--strict-mcp-config',
  ].join(' ');
  return { read: 'command', command };
};
