// THROUGH THE NARROW PATHS, as `verify.ts` does, so the bundle carries the
// adapters and rules this command uses and no more.
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { runProcess } from '@plot-pm/domain/adapters/run-script';
import { processesShell } from '@plot-pm/domain/adapters/processes/processes-shell';
import { boundedRunProcess } from '@plot-pm/domain/adapters/bounded-run/bounded-run-process';
import { agentRunCommand } from '@plot-pm/domain/adapters/agent-run/agent-run-command';
import { HARNESS_LIMIT_LINES } from '@plot-pm/domain/adapters/harness/limit-lines';
import { reviewIssue } from '@plot-pm/domain/rules/review-issue';
import type { Host, Pr, Trees } from '@plot-pm/domain';
import type { AgentRun } from '@plot-pm/domain/ports/agent-run';
import { charterPath, readCharter } from '@plot-pm/domain/entities/charter';
import {
  reviewerCommand,
  reviewRequestBlock,
  reviewVerdict,
  type ReviewCounts,
} from '@plot-pm/domain/rules/review-verdict';
import { existsSync, linkSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * Reviews one pull request and records the result as the `plot/review` commit
 * status on the head that was reviewed.
 *
 * ```
 * plot-review.mjs [<pr>]
 * ```
 *
 * With no number, the current branch's PR. The head SHA is read from the host
 * at the start of the run, never from the caller. The reviewer agent runs in a
 * detached worktree at that SHA, and the worktree is removed whatever the
 * outcome. Before the run, the change is read in that worktree: the merge base
 * of `origin/<base>` and the head, the changed files, and the full diff. The
 * diff is written to `<pr>-<sha>.diff` in the reviews directory under the git
 * common directory, never inside the reviewed tree, and the request names the
 * files and that file and tells the reviewer to judge only this change. A diff
 * that cannot be read refuses. The agent runs read-only on the `command` runner with the fragment
 * `reviewerCommand` builds: read and search tools only, no MCP server, no
 * settings from the reviewed tree, the reviews directory as its one added
 * read directory, and never the `Verify command` fragment.
 * The agent's final answer is written to a verdict file under the git common
 * directory and read through `reviewVerdict`, never as free text.
 *
 * No finding opens a follow-up issue — {@link reviewIssue} answers `none` for
 * every count, HIGH included: a HIGH finding holds the PR at `plot/review=failure`
 * instead, until #2903's fixer loop owns the ticket. Zero HIGH findings writes
 * `success` with `no HIGH findings`; one or more writes `failure` with the HIGH
 * count. The status's `target_url` is the PR.
 *
 * Every finding, of any severity, goes into one PR comment instead: a marked
 * comment (`findingsMarker`) that a later run on the same PR edits in place
 * rather than duplicating, so one PR carries at most one findings comment
 * however many heads were reviewed. The comment and the status description
 * carry the same run marker, the review's UTC timestamp to the second, so a
 * reader can match the two. A verdict with no finding at all posts no comment.
 *
 * On a host that cannot take PR comments (`unaskable`, as Bitbucket answers),
 * or where posting the comment fails, the status is still written, the output
 * names the verdict file holding the findings, and the run exits
 * {@link EXIT.issueNotOpened}.
 *
 * Every refusal writes no status and exits non-zero with the reason.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** A status was written. */
  ok: 0,
  /** The arguments were unusable. */
  usage: 2,
  /** The run refused; no status was written. */
  refused: 3,
  /**
   * A status was written, and the findings were not posted: the host cannot
   * take PR comments, or posting the comment failed.
   */
  issueNotOpened: 4,
} as const;

/** The commit-status context this command writes. */
export const REVIEW_CONTEXT = 'plot/review';

/** How long one review may run before it is ended, in seconds. */
export const REVIEW_BOUND_SECONDS = 3600;

/** The change a pull request carries, read in the review worktree. */
export type ReviewChange =
  | { ok: true; mergeBase: string; files: string[]; diff: string }
  | { ok: false; why: string };

/** What a review run touches, so a test can supply values instead of a machine. */
export interface ReviewDeps {
  host: Host;
  trees: Trees;
  /** The agent connector that runs `command`, the reviewer's shell fragment. */
  agentRun: (command: string) => AgentRun;
  repoRoot: string;
  /** The git common directory, absolute. */
  commonDir: string;
  /** The base branch name the PR targets. */
  base: string;
  /** The current branch, for a run given no PR number. */
  currentBranch: string;
  /** Makes `sha` available locally; true when it is. */
  fetchSha: (sha: string) => Promise<boolean>;
  /**
   * Reads the change in `tree`: fetches `origin/<base>`, then the merge base
   * with `sha`, the changed files, and the full diff.
   */
  readChange: (tree: string, base: string, sha: string) => Promise<ReviewChange>;
  /** The charter file's text, or null where absent. */
  readCharterText: () => string | null;
  readText: (file: string) => string | null;
  writeText: (file: string, text: string) => void;
  removeFile: (file: string) => void;
  /** The current time, UTC to the second, as `2026-10-19T16:44:37Z`. */
  now: () => string;
  /** This process's id, for the run lock. */
  pid: () => number;
  /** A fresh unique id, for the run lock and the newest-pending check. */
  runId: () => string;
  /**
   * Whether a pid is a live process. `null` where the question could not be
   * put at all — the same three-way answer `pidAlive` in `slots-file.ts`
   * gives, so a lock whose liveness cannot be determined is never treated as
   * dead.
   */
  isAlive: (pid: number) => boolean | null;
  /**
   * Publishes `content` under `path`, whole, the way `slots-file.ts` claims a
   * slot: write a scratch file first, then `link` it into `path`. `wx` alone
   * publishes the name before the content, so a second reader could open an
   * empty file; `link` only ever makes a complete one visible.
   *
   * @returns `taken` where `path` is now held by this write, `held` where a
   *   name was already there, `failed` where the filesystem refused outright.
   */
  publishLock: (path: string, content: string) => 'taken' | 'held' | 'failed';
  /** Removes a lock file; a missing file is success, matching `removeFile`. */
  removeLock: (path: string) => void;
}

/** One run's claim on a `<pr>-<sha>` lock. */
interface RunLock {
  pid: number;
  runId: string;
}

/** How a run lock is written — one line, two fields, no parser needed. */
const encodeLock = (lock: RunLock): string => `${Math.trunc(lock.pid)}\t${lock.runId}\n`;

/** Reads a run lock back, or null where the text is not one this wrote. */
const decodeLock = (text: string): RunLock | null => {
  const [pid, runId] = text.trim().split('\t');
  const parsedPid = Number(pid);
  if (!Number.isFinite(parsedPid) || runId === undefined || runId === '') return null;
  return { pid: parsedPid, runId };
};

/** What one review run answered. */
export interface ReviewOutcome {
  /** The exit code. */
  code: number;
  /** The lines to print, without newlines. */
  lines: string[];
}

const refuse = (why: string): ReviewOutcome => ({ code: EXIT.refused, lines: [`plot-review: ${why}`] });

/** `deps.writeText(file, text)` fails with a message naming `file`, instead of throwing. */
const writeTextOutcome = (deps: ReviewDeps, file: string, text: string): ReviewOutcome | null => {
  try {
    deps.writeText(file, text);
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return refuse(`could not write ${file}: ${reason}`);
  }
};

/**
 * Takes the exclusive run lock at `path`, the way `slots-file.ts` claims a
 * slot: write the whole claim to a scratch file, then publish it with `link`
 * so the name and the content always arrive together. A lock already held by
 * a dead pid is moved aside and the take is tried once more; held by a live
 * one, this run refuses.
 *
 * @returns this run's own lock, or null where another live run holds it or
 *   the filesystem refused outright.
 */
const acquireRunLock = (deps: ReviewDeps, path: string): RunLock | null => {
  const mine: RunLock = { pid: deps.pid(), runId: deps.runId() };
  const scratch = `${path}.${mine.pid}.${mine.runId}.tmp`;
  try {
    deps.writeText(scratch, encodeLock(mine));
  } catch {
    return null;
  }
  try {
    const first = deps.publishLock(scratch, path);
    if (first === 'taken') return mine;
    if (first === 'failed') return null;
    const held = decodeLock(deps.readText(path) ?? '');
    if (held !== null && deps.isAlive(held.pid) !== false) return null;
    deps.removeLock(path);
    const retaken = deps.publishLock(scratch, path);
    return retaken === 'taken' ? mine : null;
  } finally {
    deps.removeLock(scratch);
  }
};

/**
 * The findings comment's body, naming the PR URL, the reviewed head and the
 * counts, followed by the reviewer's verdict text.
 *
 * @param sha - the reviewed head.
 * @param prUrl - the PR's URL.
 * @param counts - the verdict's counts.
 * @param verdictText - the reviewer's final answer.
 * @param run - this run's marker, shared with the status description so a
 *   reader can match the two.
 * @returns the comment body.
 */
const findingsBody = (
  sha: string,
  prUrl: string,
  counts: ReviewCounts,
  verdictText: string,
  run: string,
): string => [
  `The reviewer found HIGH ${counts.high}, MEDIUM ${counts.medium}, LOW ${counts.low} on ${prUrl} at ${sha}.`,
  '',
  verdictText.trim(),
  '',
  `run ${run}`,
].join('\n');

/**
 * The most UTF-8 bytes a PR comment body may hold. GitHub caps a comment at
 * 65,536 characters, and a character is at least one byte, so a byte cap of the
 * same number holds under it. It also keeps the body, which reaches `gh` as one
 * argv string, under Linux's 128 KiB limit for a single argument.
 */
const PR_COMMENT_BYTES = 65536;

const utf8Bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

/** The marker one PR's findings comment carries, so a later run edits it instead of posting a second. */
const findingsMarker = (pr: number): string => `<!-- plot-review-findings pr-${pr} -->`;

/**
 * The PR comment that carries a review's findings, cut to {@link PR_COMMENT_BYTES}.
 *
 * Only the verdict text is cut, at a code-point boundary, so the counts line
 * and the closing `run` marker always survive. A cut comment names the verdict
 * file by its basename: the full path is the reviewing machine's and a PR
 * reader cannot open it.
 *
 * @param text - builds the comment from a (possibly cut) verdict text.
 * @param verdictText - the reviewer's final answer, verbatim.
 * @param verdictFile - the local path holding the uncut verdict.
 * @returns the comment body, at most {@link PR_COMMENT_BYTES} UTF-8 bytes.
 */
const prCommentBody = (text: (verdict: string) => string, verdictText: string, verdictFile: string): string => {
  const whole = text(verdictText);
  if (utf8Bytes(whole) <= PR_COMMENT_BYTES) return whole;
  const note = `\n\n…truncated; the full verdict is in ${path.basename(verdictFile)} under the reviewing machine's plot/state/reviews/`;
  const room = PR_COMMENT_BYTES - utf8Bytes(text('')) - utf8Bytes(note);
  let kept = '';
  let used = 0;
  for (const point of verdictText.trim()) {
    used += utf8Bytes(point);
    if (used > room) break;
    kept += point;
  }
  return text(kept + note);
};

/**
 * Reads the head's `plot/review` status, then writes this run's `pending`
 * status with `run <run id>` in its description.
 *
 * The read comes first because `pending` becomes the newest status on the
 * head: a `failure` written before this run is only visible before that
 * write. A head that reads `failure` gets no `pending` write, so a run that
 * stops before its final write leaves the `failure` in place.
 *
 * @param deps - the ports.
 * @param pr - the pull request under review.
 * @param sha - the reviewed head.
 * @param lock - this run's lock, whose run id the description carries.
 * @returns null where `pending` was written; otherwise the refusal, which
 *   names a failed read, a reading for another head, an existing `failure`,
 *   or a refused write.
 */
const markPending = async (deps: ReviewDeps, pr: Pr, sha: string, lock: RunLock): Promise<ReviewOutcome | null> => {
  const before = await deps.host.prReview(pr.number);
  if (!before.ok) return refuse(`the host did not answer the review status of PR #${pr.number}`);
  if (before.value.sha !== sha) return refuse(`the host read the review status of PR #${pr.number} on ${before.value.sha}, not on ${sha}`);
  if (before.value.state === 'failure') return refuse(`${sha} already carries a failure status; no run replaces it`);
  const pending = await deps.host.commitStatus({
    sha, state: 'pending', context: REVIEW_CONTEXT, description: `run ${lock.runId}`, targetUrl: pr.url,
  });
  return pending.ok ? null : refuse(`the host did not accept the pending status on ${sha}`);
};

/**
 * Runs one review.
 *
 * @param deps - the ports and file operations.
 * @param ref - the PR number, or `''` for the current branch's PR.
 * @returns the exit code and the lines to print.
 */
export const reviewPr = async (deps: ReviewDeps, ref: string): Promise<ReviewOutcome> => {
  const asked = ref === '' ? deps.currentBranch : ref;
  if (asked === '') return refuse('no PR number given and the current branch is unknown');
  const looked = await deps.host.prState(asked);
  if (!looked.ok) return refuse(`the host did not answer for ${asked}`);
  const pr = looked.value;
  if (pr === null) return refuse(`${asked} has no pull request`);
  if (pr.state !== 'OPEN') return refuse(`PR #${pr.number} is ${pr.state}, not open`);
  const sha = pr.headSha ?? '';
  if (sha === '') return refuse(`the host named no head commit for PR #${pr.number}`);
  if (pr.url === '') return refuse(`the host named no URL for PR #${pr.number}`);
  if (pr.base === '') return refuse(`the host named no base branch for PR #${pr.number}`);

  const charter = readCharter('reviewer', deps.readCharterText());
  if (charter.read !== 'declared') {
    return refuse(`${charterPath('reviewer')} is not usable: ${charter.read === 'unreadable' ? charter.why : charter.read}`);
  }

  const key = `${pr.number}-${sha}`;
  const reviews = path.join(deps.commonDir, 'plot', 'state', 'reviews');
  const verdictFile = path.join(reviews, `${key}.md`);
  const diffFile = path.join(reviews, `${key}.diff`);
  const lockFile = path.join(reviews, `${key}.lock`);
  const lines: string[] = [];

  const command = reviewerCommand(charter.charter, [reviews]);
  if (command.read === 'refused') return refuse(command.why);
  const agentRun = deps.agentRun(command.command);

  const lock = acquireRunLock(deps, lockFile);
  if (lock === null) return refuse(`PR #${pr.number} at ${sha} is already under review: review-running`);
  try {
    const started = await markPending(deps, pr, sha, lock);
    if (started !== null) return started;

    deps.removeFile(verdictFile);
    deps.removeFile(diffFile);
    const tree = path.join(deps.repoRoot, '.worktrees', `review-${pr.number}-${sha.slice(0, 7)}`);
    const logFile = path.join(deps.repoRoot, '.plot', 'logs', `review-${pr.number}-${sha.slice(0, 7)}.log`);
    if (!(await deps.fetchSha(sha))) return refuse(`commit ${sha} is not available locally and could not be fetched`);
    await deps.trees.prune();
    const added = await deps.trees.add(tree, sha);
    if (!added.ok) return refuse(`could not create the review worktree ${tree}`);
    let ran;
    try {
      const change = await deps.readChange(tree, pr.base, sha);
      if (!change.ok) return refuse(`the change of PR #${pr.number} could not be read: ${change.why}`);
      const diffWrite = writeTextOutcome(deps, diffFile, change.diff);
      if (diffWrite !== null) return diffWrite;
      const request = reviewRequestBlock({
        pr: pr.number,
        headSha: sha,
        base: pr.base,
        mergeBase: change.mergeBase,
        files: change.files,
        diffPath: diffFile,
        diff: change.diff,
      });
      ran = await agentRun.run({
        worktree: tree,
        prompt: `${charter.charter.prompt}\n\n${request}`,
        resumeId: '',
        role: 'reviewer',
        harness: charter.charter.harness,
        model: charter.charter.model,
        effort: charter.charter.effort,
        maxTurns: 0,
        maxSpendUsd: 0,
        boundSeconds: REVIEW_BOUND_SECONDS,
        contextWindow: 0,
        capabilities: [...new Set(['read-only', ...charter.charter.capabilities])],
        env: {},
        logFile,
        onStarted: () => {},
      });
    } finally {
      await deps.trees.removeOnly(tree);
    }
    if (!ran.ok) return refuse('the reviewer run could not be started');
    if (ran.value.end.answer !== 'ran') return refuse(`the reviewer run ended without finishing: ${ran.value.end.answer}`);

    const verdictText = ran.value.finalText ?? '';
    if (verdictText.trim() === '') return refuse('the reviewer gave no final answer');
    const verdictWrite = writeTextOutcome(deps, verdictFile, verdictText);
    if (verdictWrite !== null) return verdictWrite;
    const verdict = reviewVerdict(verdictText);
    if (verdict.read === 'refused') return refuse(`verdict ${verdictFile} refused: ${verdict.why}`);

    return finishReview(deps, pr, sha, verdictFile, verdictText, verdict.counts, lock, lines);
  } finally {
    deps.removeLock(lockFile);
  }
};

/**
 * Writes the status tail alone, for a run that already has a verdict file
 * from an earlier, interrupted attempt: no fetch, no worktree, no agent.
 * Takes the same lock and the same two write-time guards as a full run.
 *
 * @param deps - the ports and file operations.
 * @param ref - the PR number, or `''` for the current branch's PR.
 * @returns the exit code and the lines to print.
 */
export const reviewStatusOnly = async (deps: ReviewDeps, ref: string): Promise<ReviewOutcome> => {
  const asked = ref === '' ? deps.currentBranch : ref;
  if (asked === '') return refuse('no PR number given and the current branch is unknown');
  const looked = await deps.host.prState(asked);
  if (!looked.ok) return refuse(`the host did not answer for ${asked}`);
  const pr = looked.value;
  if (pr === null) return refuse(`${asked} has no pull request`);
  if (pr.state !== 'OPEN') return refuse(`PR #${pr.number} is ${pr.state}, not open`);
  const sha = pr.headSha ?? '';
  if (sha === '') return refuse(`the host named no head commit for PR #${pr.number}`);
  if (pr.url === '') return refuse(`the host named no URL for PR #${pr.number}`);

  const key = `${pr.number}-${sha}`;
  const reviews = path.join(deps.commonDir, 'plot', 'state', 'reviews');
  const verdictFile = path.join(reviews, `${key}.md`);
  const lockFile = path.join(reviews, `${key}.lock`);
  const lines: string[] = [];

  const verdictText = deps.readText(verdictFile);
  if (verdictText === null) return refuse(`no verdict file ${verdictFile} to write a status from`);
  const verdict = reviewVerdict(verdictText);
  if (verdict.read === 'refused') return refuse(`verdict ${verdictFile} refused: ${verdict.why}`);

  const lock = acquireRunLock(deps, lockFile);
  if (lock === null) return refuse(`PR #${pr.number} at ${sha} is already under review: review-running`);
  try {
    const started = await markPending(deps, pr, sha, lock);
    if (started !== null) return started;
    return finishReview(deps, pr, sha, verdictFile, verdictText, verdict.counts, lock, lines);
  } finally {
    deps.removeLock(lockFile);
  }
};

/**
 * The status-write tail, shared by a full run and `--status-only`: posts the
 * findings comment, then writes the final status under the newest-pending
 * and no-replace-failure guards.
 */
const finishReview = async (
  deps: ReviewDeps,
  pr: Pr,
  sha: string,
  verdictFile: string,
  verdictText: string,
  counts: ReviewCounts,
  lock: RunLock,
  lines: string[],
): Promise<ReviewOutcome> => {
  const after = await deps.host.prState(String(pr.number));
  if (after.ok && after.value !== null && (after.value.headSha ?? '') !== sha) {
    lines.push(`plot-review: the head of PR #${pr.number} moved to ${after.value.headSha} during review; the status is written on the reviewed ${sha}`);
  }

  const findings = counts.high + counts.medium + counts.low;
  const run = deps.now();
  const decision = reviewIssue(counts);
  let posted = true;
  if (findings !== 0 && decision === 'none') {
    const marker = findingsMarker(pr.number);
    const body = prCommentBody(
      (v) => `${marker}\n${findingsBody(sha, pr.url, counts, v, run)}`,
      verdictText,
      verdictFile,
    );
    const result = await deps.host.prComment(pr.number, body, marker);
    if (!result.ok) {
      posted = false;
      const why = result.why === 'unaskable'
        ? result.reason ?? 'this git host cannot take PR comments'
        : deps.host.lastRefusal()?.said ?? 'the host answered failed with no reason';
      lines.push(`plot-review: the findings were not posted on the PR: ${why}; they are only in ${verdictFile}`);
    }
  }

  const reading = await deps.host.prReview(pr.number);
  if (reading.ok && reading.value.sha === sha) {
    if (reading.value.state === 'failure') {
      return { code: EXIT.refused, lines: [...lines, `plot-review: ${sha} already carries a failure status; no run replaces it`] };
    }
    const newest = reading.value.description;
    if (reading.value.state === 'pending' && newest !== `run ${lock.runId}`) {
      return { code: EXIT.refused, lines: [...lines, `plot-review: superseded by ${newest || 'another run'} before the status could be written`] };
    }
  }

  const state = counts.high === 0 ? 'success' : 'failure';
  const description = counts.high === 0 ? 'no HIGH findings' : `${counts.high} HIGH finding${counts.high === 1 ? '' : 's'}`;
  const written = await deps.host.commitStatus({
    sha,
    state,
    context: REVIEW_CONTEXT,
    description: findings === 0
      ? description
      : posted ? `${description}; run ${run}` : `${description}; findings not posted`,
    targetUrl: pr.url,
  });
  if (!written.ok) {
    return { code: EXIT.refused, lines: [...lines, `plot-review: the host did not accept the status on ${sha}`] };
  }
  const summary = counts.high === 0 ? 'no HIGH findings' : `${counts.high} HIGH`;
  lines.push(`plot-review: PR #${pr.number} ${sha} ${state}, ${summary}`);
  return { code: posted ? EXIT.ok : EXIT.issueNotOpened, lines };
};

/** `git`, run in `cwd`. */
const git = (cwd: string, args: readonly string[], maxBuffer?: number) =>
  runProcess('git', ['-C', cwd, ...args], maxBuffer === undefined ? {} : { maxBuffer });

/** The largest diff, in bytes, that a review reads; a larger one refuses. */
export const REVIEW_DIFF_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Reads the change between `origin/<base>` and `sha` in `tree`.
 *
 * @param tree - the review worktree, checked out at `sha`.
 * @param base - the base branch name.
 * @param sha - the head commit.
 * @returns the merge base, the changed files and the diff, or the step that failed.
 */
export const readChange = async (tree: string, base: string, sha: string): Promise<ReviewChange> => {
  const fetched = await git(tree, ['fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`]);
  if (fetched.code !== 0) return { ok: false, why: `git fetch of origin/${base} failed` };
  const merged = await git(tree, ['merge-base', `origin/${base}`, sha]);
  const mergeBase = merged.stdout.trim();
  if (merged.code !== 0 || mergeBase === '') return { ok: false, why: `no merge base of origin/${base} and ${sha}` };
  const range = `${mergeBase}..${sha}`;
  const names = await git(tree, ['diff', '--no-ext-diff', '--name-only', range], REVIEW_DIFF_MAX_BYTES);
  if (names.code !== 0) return { ok: false, why: `git diff --name-only ${range} failed` };
  const diff = await git(tree, ['diff', '--no-ext-diff', '--no-color', range], REVIEW_DIFF_MAX_BYTES);
  if (diff.code !== 0) return { ok: false, why: `git diff ${range} failed or exceeded ${REVIEW_DIFF_MAX_BYTES} bytes` };
  return { ok: true, mergeBase, files: names.stdout.split('\n').filter((line) => line !== ''), diff: diff.stdout };
};

/**
 * Builds the dependencies from the machine this process runs on.
 *
 * @param cwd - a directory inside the repository or one of its linked trees.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @returns the dependencies, or null outside a repository.
 */
const machineDeps = async (cwd: string, scriptDir: string): Promise<ReviewDeps | null> => {
  const common = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const commonDir = common.stdout.trim();
  if (common.code !== 0 || commonDir === '') return null;
  const repoRoot = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : cwd;
  const context = { repoRoot, scriptDir };
  const host = hostShell(context);
  const branch = await git(cwd, ['branch', '--show-current']);
  const head = await git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const boundedRun = boundedRunProcess(processesShell(context));
  return {
    host,
    trees: treesGit(context),
    agentRun: (command) =>
      agentRunCommand({ boundedRun, fragment: command, limitPatterns: HARNESS_LIMIT_LINES.claude, now: Date.now }),
    repoRoot,
    commonDir,
    base: head.code === 0 ? head.stdout.trim().replace(/^origin\//, '') : 'main',
    currentBranch: branch.stdout.trim(),
    fetchSha: async (sha) => (await git(repoRoot, ['cat-file', '-e', `${sha}^{commit}`])).code === 0
      || (await git(repoRoot, ['fetch', '--quiet', 'origin', sha])).code === 0,
    readChange,
    readCharterText: () => {
      const file = path.join(repoRoot, charterPath('reviewer'));
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    },
    readText: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null),
    writeText: (file, text) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, text);
      renameSync(`${file}.tmp`, file);
    },
    removeFile: (file) => rmSync(file, { force: true }),
    now: () => new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    pid: () => process.pid,
    runId: () => randomUUID(),
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ESRCH') return false;
        if (code === 'EPERM') return true;
        return null;
      }
    },
    publishLock: (scratch, target) => {
      try {
        linkSync(scratch, target);
        return 'taken';
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'held' : 'failed';
      }
    },
    removeLock: (file) => rmSync(file, { force: true }),
  };
};

/**
 * The command line.
 *
 * @param argv - the arguments after the script name.
 * @param cwd - a directory inside the repository or one of its linked trees.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where output goes.
 * @param warn - where refusals go.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
  let statusOnly = false;
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === '--status-only') statusOnly = true;
    else positional.push(arg);
  }
  if (positional.length > 1 || (positional[0] !== undefined && !/^\d+$/.test(positional[0]))) {
    warn('plot-review: usage: plot-review.mjs [<pr-number>] [--status-only]\n');
    return EXIT.usage;
  }
  const deps = await machineDeps(cwd, scriptDir);
  if (deps === null) {
    warn('plot-review: not a git repository — run this from inside the checkout\n');
    return EXIT.usage;
  }
  const outcome = statusOnly
    ? await reviewStatusOnly(deps, positional[0] ?? '')
    : await reviewPr(deps, positional[0] ?? '');
  const out = outcome.code === EXIT.ok ? write : warn;
  for (const line of outcome.lines) out(`${line}\n`);
  return outcome.code;
};

// Only when RUN as plot-review.mjs, never when imported — bundles share
// `import.meta.url`, so the basename tells this one from a bundle that includes it.
if (
  process.argv[1] &&
  path.basename(process.argv[1]) === 'plot-review.mjs' &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
