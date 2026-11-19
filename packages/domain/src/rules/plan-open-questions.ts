/** The open questions a plan carries: how many, and the first one's text. */
export interface OpenQuestions {
  count: number;
  first: string | null;
}

const HEADING = /^#{2,3}\s+(Open Questions|Open Points)\s*$/i;
const ANY_HEADING = /^#{1,6}\s/;
const UNCHECKED = /^\s*[-*]\s+\[ \]\s+(.*\S)\s*$/;

/**
 * The unchecked `- [ ]` items under a plan's `### Open Questions` and
 * `## Open Points` headings, in document order.
 *
 * @param text - the plan file's text.
 * @returns the count and the first item's text, or `null` where the plan has neither heading. A plan with a heading and every item checked returns a count of 0, which is not the same answer as `null`.
 */
export const planOpenQuestions = (text: string): OpenQuestions | null => {
  let inSection = false;
  let found = false;
  let fenced = false;
  const items: string[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (HEADING.test(line)) {
      inSection = true;
      found = true;
      continue;
    }
    if (ANY_HEADING.test(line)) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    const item = UNCHECKED.exec(line);
    if (item !== null) items.push(item[1]!);
  }
  return found ? { count: items.length, first: items[0] ?? null } : null;
};

/** The chip text for the open questions: `n open`, or `null` where the plan has no count to show. */
export const openQuestionsChip = (q: OpenQuestions | null | undefined): string | null =>
  q === null || q === undefined ? null : `${q.count} open`;

/** The tone of the open-questions chip. */
export type OpenQuestionsTone = 'warn' | 'neutral';

/**
 * The tone of the open-questions chip.
 *
 * @param q - the plan's open questions.
 * @returns `warn` where a question is open, `neutral` where the count is 0, and `null` where `openQuestionsChip` is `null`.
 */
export const openQuestionsTone = (q: OpenQuestions | null | undefined): OpenQuestionsTone | null =>
  q === null || q === undefined ? null : q.count > 0 ? 'warn' : 'neutral';

/** The "+n more" link text for the questions beyond the first, or `null` where n is not above 0. */
export const openQuestionsMore = (q: OpenQuestions | null | undefined): string | null =>
  q === null || q === undefined || q.count <= 1 ? null : `+${q.count - 1} more`;

/** The slice-count chip: `1 slice`, `5 slices`, or `null` where the plan names none. */
export const sliceCountChip = (slices: number | undefined): string | null =>
  slices === undefined || slices <= 0 ? null : `${slices} ${slices === 1 ? 'slice' : 'slices'}`;
