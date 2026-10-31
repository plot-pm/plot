import type { FixerAttemptsRecord } from '../entities/fixer-attempts.js';
import { roleRunAlive, type PidCheck } from './role-run-alive.js';

/** The most characters of review findings a fixer prompt carries; the rest is cut with a note. */
export const FIXER_FINDINGS_MAX = 60_000;

/** What the fixer is started to answer: the review's findings, or the failing CI checks. */
export type FixerEvidence =
  | { readonly kind: 'high'; readonly findings: string }
  | { readonly kind: 'ci-red'; readonly failingChecks: readonly string[] };

/** The PR a fixer works on and the evidence it answers. */
export interface FixerPromptInput {
  /** The PR number. */
  readonly pr: number;
  /** The PR's URL; `''` where the index carries none. */
  readonly url: string;
  /** The PR's head branch, without a remote prefix. */
  readonly branch: string;
  /** The head SHA the fixer is started for. */
  readonly head: string;
  readonly evidence: FixerEvidence;
}

/** The prompt for one fixer run, or why none is built. */
export type FixerPrompt = { read: 'prompt'; text: string } | { read: 'refused'; why: 'no-branch' | 'no-head' | 'findings-empty' };

/**
 * The prompt a fixer run starts with.
 *
 * The prompt names the PR, its branch and the head SHA, says the worktree is a
 * detached checkout of that head, and says to push with
 * `git push origin HEAD:<branch>` and never with force. A HIGH run carries the
 * review findings verbatim, cut at {@link FIXER_FINDINGS_MAX} characters with
 * a note; a CI-red run names the failing checks, or says the index named none.
 *
 * @param input - the PR, its branch and head, and the evidence.
 * @returns the prompt; `refused` for an empty branch or head, or HIGH findings
 *   that hold no text.
 */
export const fixerPrompt = (input: FixerPromptInput): FixerPrompt => {
  const { pr, url, branch, head, evidence } = input;
  if (branch.trim() === '') return { read: 'refused', why: 'no-branch' };
  if (head.trim() === '') return { read: 'refused', why: 'no-head' };
  const where = url === '' ? `pull request #${pr}` : `pull request #${pr} (${url})`;
  const lines = [
    `You fix ${where} on branch \`${branch}\`.`,
    '',
    `fleetd started you for head ${head}. Your worktree is a detached checkout of that commit.`,
    `Commit your fix there, then push it with \`git push origin HEAD:${branch}\`.`,
    `Never force-push. If the branch has moved past ${head}, the push fails: stop and report that.`,
    '',
  ];
  if (evidence.kind === 'high') {
    const findings = evidence.findings.trim();
    if (findings === '') return { read: 'refused', why: 'findings-empty' };
    const cut = findings.length > FIXER_FINDINGS_MAX;
    const text = cut ? `${findings.slice(0, FIXER_FINDINGS_MAX)}\n\n…cut at ${FIXER_FINDINGS_MAX} characters.` : findings;
    lines.push(
      `The review of ${head} holds at least one HIGH finding. Fix every HIGH finding below; MEDIUM and LOW findings are not yours.`,
      '',
      '--- review findings ---',
      text,
      '--- end of review findings ---',
    );
  } else {
    const named = evidence.failingChecks.filter((name) => name.trim() !== '');
    lines.push(
      named.length === 0
        ? `CI is red on ${head}, and the index named no failing check. Read the checks with \`gh pr checks ${pr}\`.`
        : `CI is red on ${head}. The failing checks: ${named.join(', ')}. Read their logs with \`gh pr checks ${pr}\`.`,
      'Fix the cause on the branch, not the check.',
    );
  }
  return { read: 'prompt', text: `${lines.join('\n')}\n` };
};

/**
 * The attempts whose fixer has ended: an in-flight mark whose run
 * {@link roleRunAlive} reads as not alive.
 *
 * An unanswerable pid check reads as alive for the fixer, so an attempt the
 * process table cannot answer for stays in flight.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @param check - asks the process table about one pid.
 * @returns the positions in `attempts` of the ended runs; none for a missing or unreadable record.
 */
export const endedFixerAttempts = (
  record: FixerAttemptsRecord | 'none' | 'unreadable',
  check: (pid: string) => PidCheck,
): readonly number[] => {
  if (record === 'none' || record === 'unreadable') return [];
  return record.attempts.flatMap((attempt, index) =>
    attempt.inFlight !== undefined && !roleRunAlive({ role: 'fixer', pid: String(attempt.inFlight.pid), check }) ? [index] : [],
  );
};
