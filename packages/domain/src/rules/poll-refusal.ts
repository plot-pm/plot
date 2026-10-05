/**
 * Refuses a tool call shaped to wait for a background task.
 *
 * **THE GATE REMOVES THE BACKGROUND START; IT DOES NOT CHASE EACH POLL
 * SHAPE.** Measured 2026-10-05: 803 of 13,844 fleet tool turns were polls —
 * `true`, a `cat` of a background task's output, `ListAgents` — and every one
 * of them follows a background start. Refusing those three shapes one by one
 * would leave the model free to find the next one, so the SDK adapter's
 * `disallowedTools` and `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` remove the
 * START (wave 2); this rule is the third part, refusing a background start on
 * its own and refusing the poll shapes that need no background start at all
 * — a `sleep` loop around `gh pr checks` starts nothing in the background and
 * still waits inside the model's own turn.
 *
 * **THE REASON'S FIRST WORDS ARE A CONTRACT.** Wave 5's
 * `scripts/count-fleet-turns.mjs` counts a refused poll by the fixed string
 * `plot: poll refused` appearing in a tool result, so this rule's reason must
 * always open with it verbatim.
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

/** The fixed prefix every refusal opens with — wave 5 counts a poll by this string. */
export const POLL_REFUSAL_PREFIX = 'plot: poll refused';

/** What the rule tells the model to do instead, appended to every refusal. */
const INSTRUCTION =
  'end your turn with `next: checks` or `next: pushed`; the loop runs the checks and waits for CI';

/** Builds a refusal, with the fixed prefix and the shape that triggered it. */
const refuse = (shape: string): string => `${POLL_REFUSAL_PREFIX}: ${shape} — ${INSTRUCTION}`;

/** The tool names a background start or a background read can come from. */
const BACKGROUNDABLE = new Set(['Bash', 'Agent']);

/** Whether a command's argv list is only a `ps` read of one process. */
const isPsRead = (words: readonly string[]): boolean =>
  words.length > 0 && wordBasename(words[0]) === 'ps';

/** A command's basename, stripping any leading path. */
const wordBasename = (word: string): string => {
  const parts = word.split('/');
  return parts[parts.length - 1]!;
};

/** Whether one `&&`/`;`/`|`-joined segment is only `sleep <n>`. */
const isSleepOnly = (words: readonly string[]): boolean =>
  words.length >= 1 &&
  wordBasename(words[0]) === 'sleep' &&
  words.slice(1).every((w) => /^[\d.]+[smhd]?$/.test(w));

/** Whether one segment is exactly `true`, with no arguments. */
const isTrueOnly = (words: readonly string[]): boolean =>
  words.length === 1 && wordBasename(words[0]) === 'true';

/** Whether one segment reads CI status: `gh run watch` or `gh pr checks`. */
const isCiStatusRead = (words: readonly string[]): boolean => {
  if (wordBasename(words[0]!) !== 'gh') return false;
  return (words[1] === 'run' && words[2] === 'watch') || (words[1] === 'pr' && words[2] === 'checks');
};

/**
 * Whether a path names a background task's own output file.
 *
 * The SDK's background-task files carry a name no foreground command's
 * output would — the caller's own convention, read as a reading rather than
 * matched against a hardcoded path here, since the file name is the
 * adapter's to supply where wave 2 wires this in.
 */
const isBackgroundOutputPath = (path: string): boolean =>
  /\.plot[/-]?background|background[-_]?task/i.test(path);

/** Whether one segment is a `cat` of a background task's own output file. */
const isBackgroundCat = (words: readonly string[]): boolean =>
  wordBasename(words[0]!) === 'cat' && words.slice(1).some((word) => isBackgroundOutputPath(word));

/** Splits a shell command into its `&&`/`;`/`|`-joined segments, each tokenised. */
const segments = (command: string): readonly string[][] =>
  command
    .split(/&&|;|\|/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
    .map((segment) => segment.split(/\s+/));

/**
 * Whether a Bash command is shaped like a poll.
 *
 * Checked SEGMENT BY SEGMENT, so `sleep 30 && gh pr checks` is refused by its
 * second segment even though neither alone exhausts the command: a sleep
 * before a status read is the shape a `pnpm test` run never takes, because a
 * foreground test's own segments are neither `sleep`, `true`, a `ps` read nor
 * a CI status read.
 */
const commandPolls = (command: string): string | null => {
  const parts = segments(command);
  if (parts.length === 0) return null;

  for (const words of parts) {
    if (isTrueOnly(words)) return '`true`';
    if (isSleepOnly(words)) return 'a bare `sleep`';
    if (isPsRead(words)) return 'a `ps` read of a process';
    if (isCiStatusRead(words)) return '`gh run watch` or `gh pr checks`';
    if (isBackgroundCat(words)) return "a `cat` of a background task's output file";
  }
  return null;
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
