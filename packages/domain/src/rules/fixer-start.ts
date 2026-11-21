import { CI_WORKFLOW_DIR } from '../adapters/ci-workflow-path.js';
import type { FixerAttemptsRecord } from '../entities/fixer-attempts.js';
import { roleRunAlive, type PidCheck } from './role-run-alive.js';

/** The most characters of review findings a fixer prompt carries; the rest is cut with a note. */
export const FIXER_FINDINGS_MAX = 60_000;

/**
 * What the fixer is started to answer: the review's findings, the failing CI
 * checks, or a conflict with the base branch `base` at the tip `baseTip`.
 */
export type FixerEvidence =
  | { readonly kind: 'high'; readonly findings: string }
  | { readonly kind: 'ci-red'; readonly failingChecks: readonly string[] }
  | { readonly kind: 'conflict'; readonly base: string; readonly baseTip: string };

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
export type FixerPrompt =
  | { read: 'prompt'; text: string }
  | { read: 'refused'; why: 'no-branch' | 'no-head' | 'findings-empty' | 'no-base' };

/**
 * The prompt a fixer run starts with.
 *
 * The prompt names the PR, its branch and the head SHA, says the worktree is a
 * detached checkout of that head, and says to push with
 * `git push origin HEAD:<branch>` and never with force. A HIGH run carries the
 * review findings verbatim, cut at {@link FIXER_FINDINGS_MAX} characters with
 * a note; a CI-red run names the failing checks, or says the index named none.
 * A conflict run names the base and its tip, says to merge `origin/<base>`
 * into the head and never to rebase, to restore a generated bundle from
 * `git merge-base origin/<base> HEAD MERGE_HEAD` rather than rebuild it, and to stop and
 * report a conflict in a path the role gate protects, a refused push or a
 * `State:` line the state gate refuses.
 *
 * @param input - the PR, its branch and head, and the evidence.
 * @returns the prompt; `refused` for an empty branch, head or conflict base,
 *   or HIGH findings that hold no text.
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
  } else if (evidence.kind === 'conflict') {
    const base = evidence.base.trim();
    if (base === '' || evidence.baseTip.trim() === '') return { read: 'refused', why: 'no-base' };
    lines.push(
      `${head} conflicts with the base branch \`${base}\` at ${evidence.baseTip}. Merge the base into the branch:`,
      '',
      `1. Fetch the base with \`git fetch origin ${base}\`.`,
      `2. Merge it with \`git merge origin/${base}\`. Never rebase, and never force-push: the merge adds one commit and the push is a fast-forward.`,
      '3. Resolve every conflict, so that both sides keep what they changed.',
      `4. A generated bundle is marked \`-merge\` in \`.gitattributes\`. Never edit it and never commit a rebuild. Restore it from the merge base the merge commit will have, with \`git restore --staged --worktree --source="$(git merge-base origin/${base} HEAD MERGE_HEAD)" -- <path>\` (docs/definition-of-done.md, "Resolving a board artifact conflict").`,
      `5. Where a conflict sits in a path the role gate protects (\`${CI_WORKFLOW_DIR}\`, \`.claude/\`, \`scripts/check-*.sh\`), stop: abort the merge with \`git merge --abort\` and report the path.`,
      `6. Commit the merge, then push it with \`git push origin HEAD:${branch}\`.`,
      '',
      'The role gate refuses a push that forces, deletes, or names another branch (`rolePushViolation` in `role-gate.ts`). Where your push is refused, stop and report the refusal; do not retry it another way.',
      'Where a conflict sits on a `State:` line, the state gate plot-state-gate.sh refuses the commit. Stop and report it; do not retry.',
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
