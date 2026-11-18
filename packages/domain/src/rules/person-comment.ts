/** The held answer a PR index row carries for a person's unanswered comment. */
export interface PersonComment {
  /** The head commit the merge pass was refused at. */
  readonly head: string;
  /** The later of the conversation's newest time and the row's `updatedAt` at that refusal, ISO-8601. */
  readonly at: string;
}

/**
 * Whether a held person-comment answer still covers a PR.
 *
 * The answer covers the PR where it names the row's head commit (`headSha`,
 * never the branch name) and the row's `updatedAt` is not later than the
 * answer's `at`. A reply to the comment moves `updatedAt`, so the answer stops
 * covering without a second write. An unparseable time on either side, a
 * missing `updatedAt` and a missing `headSha` cover nothing.
 *
 * @param comment - the held answer, or undefined where the row carries none.
 * @param row - the row's head commit and last-update time.
 * @returns true where the answer still holds.
 */
export const personCommentHolds = (
  comment: PersonComment | undefined,
  row: { readonly headSha?: string | undefined; readonly updatedAt?: string | undefined },
): boolean => {
  if (comment === undefined || row.headSha === undefined || comment.head !== row.headSha) return false;
  const held = Date.parse(comment.at);
  const updated = row.updatedAt === undefined ? Number.NaN : Date.parse(row.updatedAt);
  return !Number.isNaN(held) && !Number.isNaN(updated) && updated <= held;
};
