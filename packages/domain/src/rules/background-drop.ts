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

/** What the agent waits on: a Monitor, a subagent, or a background task it started. */
const WAIT_OBJECT = String.raw`(?:the|my|its)\s+(?:\w+\s+){0,2}?(?:Monitor|subagent|background\s+(?:agent|subagent|task|job|build|process|work))`;

/**
 * A closing line that says the agent now waits on its own background work:
 * a first-person `I'll`, `I will`, `I'm` or `I am` before the wait, or a line
 * that opens with `Waiting for` or `Waiting on`, and in both a wait object
 * {@link WAIT_OBJECT} names before the sentence ends.
 */
const WAITING: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:I'll|I will|I'm|I am)\s+(?:\w+\s+){0,4}?(?:wait|waiting|pause|pausing)\b[^.!?;\n]{0,60}?\b${WAIT_OBJECT}`, 'i'),
  new RegExp(String.raw`^\W*waiting\s+(?:for|on)\s+${WAIT_OBJECT}`, 'i'),
];

/** A negation anywhere in the line, which reads it as no wait. */
const NEGATION = /\b(?:not|never|nothing|no|none|nobody)\b|n't\b/i;

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
  return closing.find((line) => !NEGATION.test(line) && WAITING.some((shape) => shape.test(line)));
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
