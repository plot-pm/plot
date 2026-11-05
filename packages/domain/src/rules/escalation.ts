/** The prefix of an answer-record outcome that records an escalation. */
const ESCALATED_PREFIX = 'escalated ';

/**
 * The reason a desk's question was escalated to a person.
 *
 * Reads the rows recorded for one question key (`worktree`, `askedAt`). The
 * last row decides: an outcome `escalated <reason>` answers `<reason>`, and
 * any other last outcome (`started`, `refused …`, `failed …`) answers `null`,
 * because the question is then open or retried and nobody has been handed it.
 *
 * @param rows - the rows recorded for the question key, oldest first.
 * @returns the reason, or `null` where the last row is not an escalation or
 *   there are no rows.
 */
export const escalationReason = (rows: readonly { readonly outcome: string }[]): string | null => {
  const last = rows[rows.length - 1];
  if (last === undefined || !last.outcome.startsWith(ESCALATED_PREFIX)) return null;
  const reason = last.outcome.slice(ESCALATED_PREFIX.length).trim();
  return reason === '' ? null : reason;
};

/** What a posted escalation comment says and where it is keyed. */
export interface EscalationComment {
  /** The text of the comment, starting with its marker line. */
  readonly body: string;
  /** The marker that makes the post an edit-in-place on a repeat. */
  readonly marker: string;
}

/**
 * The marker of one question's escalation comment, keyed on the desk's branch
 * and the marker's `askedAt`. A new question has a new `askedAt` and so a new
 * comment.
 *
 * @param branch - the desk's branch.
 * @param askedAt - the question marker's modification time, ISO-8601.
 * @returns the marker line.
 */
export const escalationMarker = (branch: string, askedAt: string): string =>
  `<!-- plot:escalation ${branch} ${askedAt} -->`;

/**
 * The comment that puts an escalated question on the plan's issue.
 *
 * @param input.branch - the desk's branch.
 * @param input.askedAt - the question marker's modification time, ISO-8601.
 * @param input.question - the question, as the marker states it.
 * @param input.reason - the escalation reason.
 * @returns the body and the marker the body starts with.
 */
export const escalationComment = (input: {
  branch: string;
  askedAt: string;
  question: string;
  reason: string;
}): EscalationComment => {
  const marker = escalationMarker(input.branch, input.askedAt);
  const body = [
    marker,
    `The agent on \`${input.branch}\` asked a question that needs a person (escalated: ${input.reason}).`,
    '',
    'Question:',
    '',
    ...input.question.split('\n').map((line) => `> ${line}`),
    '',
    `Asked at ${input.askedAt}. The desk stays blocked until the question is answered.`,
  ].join('\n');
  return { body, marker };
};

/**
 * The issue a plan's `## Status` `Issue:` line names, as the tracker's
 * identifier: the first `#<number>` or Jira-style key (`ABC-123`) on the line.
 *
 * @param planText - the whole plan file.
 * @returns the identifier without a leading `#`, or `null` where the plan has
 *   no `Issue:` line or the line names no issue.
 */
export const planIssueId = (planText: string): string | null => {
  const statusBody = planText.match(/## Status\s*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
  const value = statusBody.match(/^- \*\*Issue:\*\* (.+)$/m)?.[1] ?? '';
  return value.match(/#(\d+)/)?.[1] ?? value.match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0] ?? null;
};
