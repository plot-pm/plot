import type { PrConversationReading, PrConversationRow } from '../ports/host.js';

/** The comment that holds a merge, and what the rest of the conversation adds to it. */
export interface HumanCommentOpen {
  /** The oldest open comment's author login; `''` where the account is deleted. */
  readonly login: string;
  /** The oldest open comment's `time`, verbatim. */
  readonly time: string;
  /** The first non-empty line of the oldest open comment's body, trimmed. */
  readonly firstLine: string;
  /** How many other comments are open. */
  readonly others: number;
  /** The newest `time` over every row the read returned, marked and `Bot` rows included; `''` where none parses. */
  readonly conversationAt: string;
}

const PLOT_MARKER = /<!--\s*plot-/;

const epoch = (time: string): number => (time === '' ? Number.NaN : Date.parse(time));

/** A body Plot wrote carries a `<!-- plot-… -->` marker. */
const marked = (row: PrConversationRow): boolean => PLOT_MARKER.test(row.body);

/**
 * A row that speaks as a person: an account whose `type` is not `Bot` (an
 * empty `type` is a person), an unmarked body, a non-empty body and, for a
 * review, a state other than `PENDING`.
 */
const spoken = (row: PrConversationRow): boolean =>
  row.type !== 'Bot' && !marked(row) && row.body.trim() !== '' && !(row.kind === 'review' && row.state === 'PENDING');

/** An `APPROVED` review answers every earlier comment, whoever wrote it. */
const approval = (row: PrConversationRow): boolean => row.kind === 'review' && row.state === 'APPROVED';

/** A review that approves is the answer, never a question. */
const opens = (row: PrConversationRow, prAuthor: string): boolean =>
  spoken(row) && !approval(row) && !(prAuthor !== '' && row.login === prAuthor);

/**
 * Whether `later` answers `comment`: strictly later by `time`, and either an
 * `APPROVED` review from any login or an unmarked, non-`Bot` comment from a
 * different login. A time that does not parse, and a tie, answer nothing.
 */
const answers = (later: PrConversationRow, comment: PrConversationRow): boolean => {
  const at = epoch(later.time);
  const asked = epoch(comment.time);
  if (Number.isNaN(at) || Number.isNaN(asked) || at <= asked) return false;
  if (approval(later)) return true;
  return spoken(later) && later.login !== comment.login;
};

const firstLineOf = (body: string): string => body.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';

/**
 * Finds the human comments of a PR that nobody has answered.
 *
 * A comment is an `issue`, `inline` or `review` row by an account whose `type`
 * is not `Bot` — an empty `type` is a person — with an unmarked, non-empty
 * body. The PR author's own comments open nothing, and a review in state
 * `APPROVED` is an answer and opens nothing. A `PENDING` review is not a
 * comment. A comment stays open until a later unmarked non-`Bot` comment from
 * a different login, or a later `APPROVED` review from any login (the
 * commenter's own included). The answer is PR-wide, not per thread. "Later"
 * is strictly later by `time`; a tie, an empty `time` and a `time` that does
 * not parse answer nothing, and a comment whose own `time` does not parse can
 * be answered by nothing. A later commit does not answer.
 *
 * @param conversation - the PR's whole conversation as the host read it.
 * @returns `null` where no comment is open, otherwise the oldest open comment
 *   (an unparseable `time` sorts first) with the count of the others and the
 *   newest `time` over all rows.
 */
export const humanCommentOpen = (conversation: PrConversationReading): HumanCommentOpen | null => {
  const { prAuthor, rows } = conversation;
  const open = rows
    .filter((row) => opens(row, prAuthor) && !rows.some((later) => answers(later, row)))
    .map((row, index) => ({ row, index, at: epoch(row.time) }))
    .sort((a, b) => {
      const an = Number.isNaN(a.at) ? Number.NEGATIVE_INFINITY : a.at;
      const bn = Number.isNaN(b.at) ? Number.NEGATIVE_INFINITY : b.at;
      return an === bn ? a.index - b.index : an - bn;
    });
  const oldest = open[0];
  if (oldest === undefined) return null;
  const newest = rows.reduce<number>((max, row) => {
    const at = epoch(row.time);
    return Number.isNaN(at) || at <= max ? max : at;
  }, Number.NEGATIVE_INFINITY);
  return {
    login: oldest.row.login,
    time: oldest.row.time,
    firstLine: firstLineOf(oldest.row.body),
    others: open.length - 1,
    conversationAt: Number.isFinite(newest) ? new Date(newest).toISOString() : '',
  };
};
