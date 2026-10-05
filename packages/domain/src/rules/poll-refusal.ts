/**
 * Refuses a tool call shaped to wait for a background task.
 *
 * Refuses a background start (`run_in_background: true` on `Bash` or
 * `Agent`), a read of a background task's output file, and a Bash command
 * whose every segment is a poll shape: `sleep`, `true`, a `ps` read, a
 * `wait`, or a CI status read (`gh run watch`, `gh pr checks`). A command
 * with one segment that does other work is allowed. Every refusal opens with
 * {@link POLL_REFUSAL_PREFIX}.
 */

/** What the caller measured about one tool call, before it runs. */
export interface PollCheck {
  /** Whether the call asked to run in the background. */
  readonly runInBackground?: boolean;
  /** The Bash command, for a `Bash` call; `''` for every other tool. */
  readonly command?: string;
  /** The path a `Read` call names, for the background-output-file shape. */
  readonly path?: string;
}

/**
 * The fixed prefix every refusal opens with. A refused poll is counted by
 * this string in a tool result, so it does not change.
 */
export const POLL_REFUSAL_PREFIX = 'plot: poll refused';

/** What the rule tells the model to do instead, appended to every refusal. */
const INSTRUCTION =
  'end your turn with `next: checks` or `next: pushed`; the loop runs the checks and waits for CI';

/** Builds a refusal, with the fixed prefix and the shape that triggered it. */
const refuse = (shape: string): string => `${POLL_REFUSAL_PREFIX}: ${shape} — ${INSTRUCTION}`;

/** The tool names a background start can come from. */
const BACKGROUNDABLE = new Set(['Bash', 'Agent']);

/** The shell keywords stripped from a segment's front before its first word is read. */
const LEADING_KEYWORDS = new Set(['while', 'until', 'if', 'elif', 'do', 'then', 'else', '!', '{', '(']);

/** The shell keywords that close a loop or a group and carry no command. */
const CLOSING_KEYWORDS = new Set(['done', 'fi', '}', ')']);

/** The commands that print a file, for the background-output-file shape. */
const FILE_READERS = new Set(['cat', 'tail', 'head', 'less']);

/** A command's basename, stripping any leading path. */
const wordBasename = (word: string): string => {
  const parts = word.split('/');
  return parts[parts.length - 1]!;
};

/**
 * Whether a path names a background task's output file.
 *
 * Claude Code writes a background task's output to `<dir>/tasks/<id>.output`.
 */
const isBackgroundOutputPath = (path: string): boolean => /\/tasks\/[^/]+\.output$/.test(path);

/** The poll shape one segment's words take, or `null` where the segment does other work. */
const segmentShape = (words: readonly string[]): string | null => {
  const first = wordBasename(words[0]!);
  const args = words.slice(1);
  if (first === 'true' && args.length === 0) return '`true`';
  if (first === 'sleep' && args.every((w) => /^[\d.]+[smhd]?$/.test(w))) return '`sleep`';
  if (first === 'wait') return '`wait`';
  if (first === 'ps' && args.includes('-p')) return 'a `ps` read of a process';
  if (first === 'gh' && args[0] === 'run' && args[1] === 'watch') return '`gh run watch`';
  if (first === 'gh' && args[0] === 'pr' && args[1] === 'checks') return '`gh pr checks`';
  if (FILE_READERS.has(first) && args.some(isBackgroundOutputPath)) {
    return "a read of a background task's output file";
  }
  return null;
};

/**
 * Splits a shell command into its segments, each tokenised, with loop and
 * group keywords removed.
 *
 * Splits on newlines, `&&`, `||`, `;`, `|` and a lone `&`; the `&` of a
 * redirection such as `2>&1` does not split. A segment that holds only a
 * keyword such as `done` is dropped.
 */
const segments = (command: string): readonly string[][] =>
  command
    .split(/\n|&&|\|\||;|\||(?<![<>&])&(?![>&])/)
    .map((segment) => {
      const words = segment.trim().split(/\s+/).filter((word) => word !== '');
      while (words.length > 0 && LEADING_KEYWORDS.has(words[0]!)) words.shift();
      return words.filter((word) => !CLOSING_KEYWORDS.has(word));
    })
    .filter((words) => words.length > 0);

/**
 * Whether a command ends with a lone `&`, which starts it in the background.
 * `&&` and a redirection such as `2>&1` are not a lone `&`.
 */
const startsInBackground = (command: string): boolean => /(?:^|[^&>])&\s*$/.test(command.trim());

/**
 * The poll shape a Bash command takes, or `null` where it does other work.
 *
 * @param command - the Bash command, verbatim.
 * @returns the shape's description where every segment is a poll shape, or
 *   the command starts in the background; `null` otherwise.
 */
const commandPolls = (command: string): string | null => {
  if (startsInBackground(command)) return 'a command started in the background with `&`';

  const parts = segments(command);
  if (parts.length === 0) return null;

  const shapes = parts.map(segmentShape);
  if (shapes.some((shape) => shape === null)) return null;
  return shapes.find((shape) => shape !== '`sleep`') ?? '`sleep`';
};

/**
 * Refuses one tool call shaped to wait for a background task, or allows it.
 *
 * @param toolName - the tool the model is about to call.
 * @param input - what the caller measured about the call.
 * @returns the refusal reason, opening with {@link POLL_REFUSAL_PREFIX}, or
 *   `null` where the call is allowed.
 */
export const pollRefusal = (toolName: string, input: PollCheck): string | null => {
  if (BACKGROUNDABLE.has(toolName) && input.runInBackground === true) {
    return refuse(`${toolName} asked to run in the background`);
  }

  if (toolName === 'Bash' && input.command !== undefined && input.command !== '') {
    const shape = commandPolls(input.command);
    if (shape !== null) return refuse(shape);
  }

  if (toolName === 'Read' && input.path !== undefined && isBackgroundOutputPath(input.path)) {
    return refuse("a read of a background task's output file");
  }

  return null;
};
