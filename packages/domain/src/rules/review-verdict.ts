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

/** What a review request names about one pull request. */
export interface ReviewRequest {
  pr: number;
  headSha: string;
  base: string;
  /** Absolute path of the file the reviewer writes its verdict to. */
  verdictFile: string;
}

/**
 * The fixed review-request block appended to the reviewer charter's prompt.
 *
 * @param request - the pull request, its head, its base branch and the verdict file.
 * @returns the block: the PR facts, the severity rubric, the read-only rule, and
 *   the verdict file's path and required `Findings:` line.
 */
export const reviewRequestBlock = (request: ReviewRequest): string =>
  [
    'Review request',
    `Pull request: #${request.pr}`,
    `Head commit: ${request.headSha}`,
    `Base branch: ${request.base}`,
    '',
    'Review the change between the base branch and the head commit. The working tree is checked out at the head commit.',
    '',
    'Severity:',
    '- HIGH: a security leak, a wrong result users hit, or a break of main or of merges.',
    '- MEDIUM: a defect that does not meet the HIGH bar.',
    '- LOW: a style or maintainability point.',
    '',
    'Read-only: change no file in the working tree, create no commit, and push nothing.',
    '',
    `Write your verdict to ${request.verdictFile}. List each finding with its severity, then end with exactly one line:`,
    'Findings: HIGH <n>, MEDIUM <n>, LOW <n>',
  ].join('\n');

/**
 * The URL of a follow-up issue, composed from facts the tracker and the PR state.
 *
 * A Jira key composes against the tracker's address as `<address>/browse/<key>`.
 * A numeric id on a GitHub-hosted tracker composes from the PR's own URL by
 * replacing `/pull/<n>` with `/issues/<id>`. Nothing else is guessed.
 *
 * @param scheme - the tracker's declared scheme, `''` where none is declared.
 * @param baseUrl - the tracker's address, `''` where none was given.
 * @param id - the issue id the tracker answered.
 * @param prUrl - the reviewed PR's URL.
 * @returns the issue URL, or null where none can be composed from these facts.
 */
export const reviewIssueUrl = (scheme: string, baseUrl: string, id: string, prUrl: string): string | null => {
  if (scheme === 'jira') return baseUrl === '' ? null : `${baseUrl.replace(/\/+$/, '')}/browse/${id}`;
  const github = /^(https:\/\/[^/]+\/[^/]+\/[^/]+)\/pull\/\d+/.exec(prUrl);
  if ((scheme === '' || scheme === 'github-issues') && github !== null && /^\d+$/.test(id)) {
    return `${github[1]}/issues/${id}`;
  }
  return null;
};
