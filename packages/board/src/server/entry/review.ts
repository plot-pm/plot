// THROUGH THE NARROW PATHS, as `verify.ts` does, so the bundle carries the
// adapters and rules this command uses and no more.
import { hostShell } from '@plot-pm/domain/adapters/host/host-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { treesGit } from '@plot-pm/domain/adapters/trees/trees-git';
import { runProcess } from '@plot-pm/domain/adapters/run-script';
import { processesShell } from '@plot-pm/domain/adapters/processes/processes-shell';
import { boundedRunProcess } from '@plot-pm/domain/adapters/bounded-run/bounded-run-process';
import { agentRunCommand } from '@plot-pm/domain/adapters/agent-run/agent-run-command';
import { HARNESS_LIMIT_LINES } from '@plot-pm/domain/adapters/harness/limit-lines';
import { reviewIssueUrl } from '@plot-pm/domain/adapters/tracker/tracker-issue-url';
import { trackerForIssues } from '@plot-pm/domain/adapters/tracker/tracker-resolve';
import type { Host, Tracker, Trees } from '@plot-pm/domain';
import type { AgentRun } from '@plot-pm/domain/ports/agent-run';
import { charterPath, readCharter } from '@plot-pm/domain/entities/charter';
import {
  reviewerCommand,
  reviewRequestBlock,
  reviewVerdict,
  type ReviewCounts,
} from '@plot-pm/domain/rules/review-verdict';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
 * outcome. The agent runs read-only on the `command` runner with the fragment
 * `reviewerCommand` builds: read and search tools only, no MCP server, no
 * settings from the reviewed tree, and never the `Verify command` fragment.
 * The agent's final answer is written to a verdict file under the git common
 * directory and read through `reviewVerdict`, never as free text.
 *
 * Zero HIGH findings writes `success` with `no HIGH findings` and opens no
 * issue. One or more writes `failure` and opens one follow-up issue; the
 * status's `target_url` is that issue. The issue id is recorded per PR and head
 * SHA, so a second run against the same head reuses the recorded issue and
 * opens none. A run whose recorded entry is `pending` — an earlier run asked
 * the tracker and recorded no answer — refuses, as `plot-verify` does.
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
} as const;

/** The commit-status context this command writes. */
export const REVIEW_CONTEXT = 'plot/review';

/** How long one review may run before it is ended, in seconds. */
export const REVIEW_BOUND_SECONDS = 3600;

/** What a review run touches, so a test can supply values instead of a machine. */
export interface ReviewDeps {
  host: Host;
  tracker: Tracker;
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
  /** The charter file's text, or null where absent. */
  readCharterText: () => string | null;
  readText: (file: string) => string | null;
  writeText: (file: string, text: string) => void;
  removeFile: (file: string) => void;
}

/** What one review run answered. */
export interface ReviewOutcome {
  /** The exit code. */
  code: number;
  /** The lines to print, without newlines. */
  lines: string[];
}

const refuse = (why: string): ReviewOutcome => ({ code: EXIT.refused, lines: [`plot-review: ${why}`] });

/**
 * The follow-up issue's title and body.
 *
 * @param pr - the PR number.
 * @param sha - the reviewed head.
 * @param prUrl - the PR's URL.
 * @param counts - the verdict's counts.
 * @param verdictText - the reviewer's final answer.
 * @returns the issue text.
 */
const followUpIssue = (
  pr: number,
  sha: string,
  prUrl: string,
  counts: ReviewCounts,
  verdictText: string,
): { title: string; body: string } => ({
  title: `plot-review: ${counts.high} HIGH finding${counts.high === 1 ? '' : 's'} on PR #${pr}`,
  body: [
    `The reviewer found HIGH ${counts.high}, MEDIUM ${counts.medium}, LOW ${counts.low} on ${prUrl} at ${sha}.`,
    '',
    verdictText.trim(),
  ].join('\n'),
});

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

  const charter = readCharter('reviewer', deps.readCharterText());
  if (charter.read !== 'declared') {
    return refuse(`${charterPath('reviewer')} is not usable: ${charter.read === 'unreadable' ? charter.why : charter.read}`);
  }

  const key = `${pr.number}-${sha}`;
  const reviews = path.join(deps.commonDir, 'plot', 'state', 'reviews');
  const verdictFile = path.join(reviews, `${key}.md`);
  const issueFile = path.join(reviews, `${key}.issue`);
  const lines: string[] = [];

  const command = reviewerCommand(charter.charter);
  if (command.read === 'refused') return refuse(command.why);
  const agentRun = deps.agentRun(command.command);

  deps.removeFile(verdictFile);
  const tree = path.join(deps.repoRoot, '.worktrees', `review-${pr.number}-${sha.slice(0, 7)}`);
  const logFile = path.join(deps.repoRoot, '.plot', 'logs', `review-${pr.number}-${sha.slice(0, 7)}.log`);
  if (!(await deps.fetchSha(sha))) return refuse(`commit ${sha} is not available locally and could not be fetched`);
  await deps.trees.prune();
  const added = await deps.trees.add(tree, sha);
  if (!added.ok) return refuse(`could not create the review worktree ${tree}`);
  let ran;
  try {
    ran = await agentRun.run({
      worktree: tree,
      prompt: `${charter.charter.prompt}\n\n${reviewRequestBlock({ pr: pr.number, headSha: sha, base: deps.base })}`,
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
  deps.writeText(verdictFile, verdictText);
  const verdict = reviewVerdict(verdictText);
  if (verdict.read === 'refused') return refuse(`verdict ${verdictFile} refused: ${verdict.why}`);
  const { counts } = verdict;

  const after = await deps.host.prState(String(pr.number));
  if (after.ok && after.value !== null && (after.value.headSha ?? '') !== sha) {
    lines.push(`plot-review: the head of PR #${pr.number} moved to ${after.value.headSha} during review; the status is written on the reviewed ${sha}`);
  }

  if (counts.high === 0) {
    const written = await deps.host.commitStatus({
      sha,
      state: 'success',
      context: REVIEW_CONTEXT,
      description: 'no HIGH findings',
      targetUrl: pr.url,
    });
    if (!written.ok) return refuse(`the host did not accept the status on ${sha}`);
    lines.push(`plot-review: PR #${pr.number} ${sha} success, no HIGH findings`);
    return { code: EXIT.ok, lines };
  }

  const recorded = deps.readText(issueFile);
  if (recorded?.trim() === 'pending') {
    return refuse(`the issue may exist: an earlier run asked the tracker for PR #${pr.number} at ${sha} and recorded no answer; remove ${issueFile} once checked`);
  }
  let issueId = recorded?.trim() ?? '';
  if (issueId === '') {
    deps.writeText(issueFile, 'pending');
    const opened = await deps.tracker.issueOpen({
      ...followUpIssue(pr.number, sha, pr.url, counts, verdictText),
      labels: ['ai-generated'],
    });
    if (!opened.ok) {
      deps.removeFile(issueFile);
      return refuse(`the tracker did not open the follow-up issue: ${deps.tracker.lastRefusal() ?? opened.why}`);
    }
    issueId = opened.value.id;
    deps.writeText(issueFile, issueId);
  }
  const { scheme, baseUrl } = deps.tracker.config();
  const issueUrl = reviewIssueUrl(scheme, baseUrl, issueId, pr.url);
  if (issueUrl === null) {
    return refuse(`issue ${issueId} was opened for PR #${pr.number}, but its URL cannot be composed for tracker '${scheme}'; no status written`);
  }
  const written = await deps.host.commitStatus({
    sha,
    state: 'failure',
    context: REVIEW_CONTEXT,
    description: `${counts.high} HIGH finding${counts.high === 1 ? '' : 's'}`,
    targetUrl: issueUrl,
  });
  if (!written.ok) return refuse(`the host did not accept the status on ${sha}`);
  lines.push(`plot-review: PR #${pr.number} ${sha} failure, ${counts.high} HIGH, issue ${issueUrl}`);
  return { code: EXIT.ok, lines };
};

/** `git`, run in `cwd`. */
const git = (cwd: string, args: readonly string[]) => runProcess('git', ['-C', cwd, ...args]);

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
  const scripts = scriptsShell(context);
  const host = hostShell(context);
  const declared = await scripts.config('Tracker', '');
  const backend = await host.backend();
  const branch = await git(cwd, ['branch', '--show-current']);
  const head = await git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const boundedRun = boundedRunProcess(processesShell(context));
  return {
    host,
    tracker: trackerForIssues(declared.ok ? declared.value.trim() : '', backend.ok ? backend.value : '', context),
    trees: treesGit(context),
    agentRun: (command) =>
      agentRunCommand({ boundedRun, fragment: command, limitPatterns: HARNESS_LIMIT_LINES.claude, now: Date.now }),
    repoRoot,
    commonDir,
    base: head.code === 0 ? head.stdout.trim().replace(/^origin\//, '') : 'main',
    currentBranch: branch.stdout.trim(),
    fetchSha: async (sha) => (await git(repoRoot, ['cat-file', '-e', `${sha}^{commit}`])).code === 0
      || (await git(repoRoot, ['fetch', '--quiet', 'origin', sha])).code === 0,
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
  if (argv.length > 1 || (argv[0] !== undefined && !/^\d+$/.test(argv[0]))) {
    warn('plot-review: usage: plot-review.mjs [<pr-number>]\n');
    return EXIT.usage;
  }
  const deps = await machineDeps(cwd, scriptDir);
  if (deps === null) {
    warn('plot-review: not a git repository — run this from inside the checkout\n');
    return EXIT.usage;
  }
  const outcome = await reviewPr(deps, argv[0] ?? '');
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
  process.exit(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
