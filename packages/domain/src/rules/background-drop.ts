/**
 * Whether a prompt's turn ended with the background work it started dropped,
 * and what the loop tells the agent when it resumes the turn.
 *
 * Two shapes are read. The harness's termination line, matched at the start
 * of a line by the prefix the caller supplies from the harness table. And a
 * closing line of the agent's last message that says it waits for a
 * background task, a notification or a `Monitor`; that shape is the agent's
 * prose, so it needs no harness pattern.
 */

/** How many closing non-empty lines are read for the waiting shape. */
const CLOSING_LINES = 5;

/**
 * A closing line that says the agent now waits on background work. The first
 * shape needs a first-person future or present phrase before the wait, and a
 * `not` or `never` in it does not count; the second is a line that opens with
 * `Waiting for` or `Waiting on`.
 */
const WAITING: readonly RegExp[] = [
  /\b(?:I'll|I will|I'm|I am|let me)\s+(?:(?!not\b|never\b)\w+\s+){0,4}?(?:wait|waiting|pause|pausing)\b[^.!?\n]{0,80}\b(?:notification|notified|notify|background|Monitor)\b/i,
  /^\W*waiting (?:for|on)\b[^.!?\n]{0,80}\b(?:notification|notified|background|Monitor)\b/i,
];

/**
 * The line that shows a turn ended with its background work dropped.
 *
 * @param output - the last lines of the prompt's output, newest last.
 * @param prefix - the text the harness's termination line opens with;
 *   `undefined` where the harness table names none.
 * @returns the termination line, or the closing line that says the agent
 *   waits; `undefined` where neither is in the output.
 */
export const droppedBackgroundLine = (output: string, prefix: string | undefined): string | undefined => {
  const lines = output.split('\n').map((line) => line.trimEnd());
  const terminated = prefix === undefined || prefix === '' ? undefined : lines.find((line) => line.startsWith(prefix));
  if (terminated !== undefined) return terminated;

  const closing = lines.filter((line) => line.trim() !== '').slice(-CLOSING_LINES);
  return closing.find((line) => WAITING.some((shape) => shape.test(line)));
};

/** The heading of the correction a dropped turn writes. */
export const BACKGROUND_DROP_HEADING = '## The last turn ended with its background work dropped';

/**
 * The correction the loop hands an agent whose turn dropped its background
 * work, once, before it resumes the session.
 *
 * @param line - the line {@link droppedBackgroundLine} found, verbatim.
 * @returns the correction as Markdown, without a trailing separator.
 */
export const backgroundDropCorrection = (line: string): string =>
  `${BACKGROUND_DROP_HEADING}\n\n` +
  `The run reported: ${line}\n\n` +
  'Your last turn ended while work it started in the background was still running, and that work ended with the turn: it is lost. Background tasks are now disabled. Read what the worktree holds, then finish the slice in the FOREGROUND: run every command and subagent in the foreground, commit, push and open the pull request. End the turn only when nothing you started is still running. A second turn that ends this way is handed to a person.';
