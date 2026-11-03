import type { Host, Refs, Trees } from '@plot-pm/domain';
import type { OpenPr } from '@plot-pm/domain/rules/plan-pr';

/** How many open PRs a listing reads at most. */
export const PRS_LISTED = 100;

/** The ports {@link openPrsOf} and {@link holdsCommit} need from a caller's `Context`. */
export interface OpenPrsContext {
  repoRoot: string;
  host: Host;
  refs: Refs;
  trees: Trees;
}

/** An own-repo open row the host listed that could not be turned into an {@link OpenPr}. */
export interface UnreadPr {
  /** The PR's number. */
  number: number;
  /** Why it could not be read. */
  reason: 'the host named no head commit' | 'git does not hold its head commit' | 'its changed files could not be read';
}

/** {@link openPrsOf}'s answer: the readable rows, and the own-repo rows that were not. */
export interface OpenPrsReading {
  open: readonly OpenPr[];
  unread: readonly UnreadPr[];
}

/**
 * The line a `plan-not-found` refusal adds when some open PRs could not be
 * read: `''` where every row was read, so a caller can append it unchanged.
 *
 * @param unread - the rows {@link openPrsOf} could not turn into an {@link OpenPr}.
 */
export const unreadPrsLine = (unread: readonly UnreadPr[]): string => {
  if (unread.length === 0) return '';
  const names = unread.map((pr) => `#${pr.number} (${pr.reason})`).join(', ');
  const count = unread.length === 1 ? '1 open PR could not be read' : `${unread.length} open PRs could not be read`;
  return `${count}: ${names}`;
};

/**
 * Resolves a possibly-short commit sha to the full oid git holds for it.
 *
 * @param sha - a commit sha, in full or as a prefix.
 * @returns the full oid, or `''` where git does not hold the commit.
 */
export const resolvedCommit = async (ctx: OpenPrsContext, sha: string): Promise<string> => {
  if (sha === '') return '';
  const resolved = await ctx.refs.resolve(`${sha}^{commit}`);
  return resolved.ok ? resolved.value : '';
};

/** Whether git holds a commit. */
export const holdsCommit = async (ctx: OpenPrsContext, sha: string): Promise<boolean> =>
  (await resolvedCommit(ctx, sha)) !== '';

/**
 * The open PRs, each with the full head sha and the paths its head changes
 * against its merge base with the default branch.
 *
 * ONE HOST CALL: `pr-list --state open --limit 100`, which names every open
 * PR's head branch and head commit. The heads git does not hold are fetched
 * in ONE `git fetch`. Whether a head changes the plan file is then a git
 * question, which spends no host quota. The head sha is resolved through git
 * rather than kept as the host reported it, so a Bitbucket row's 12-hex short
 * sha becomes the 40-hex oid a merge pin and a changed-files lookup both key
 * on.
 *
 * A PR from a fork is skipped and not counted as unread: it is never read at
 * `origin/<head>`, which may not be the commit the merge would be pinned to.
 * An own-repo row the host named with no head commit, whose head git cannot
 * resolve after the fetch, or whose changed files git cannot list, is named
 * in {@link OpenPrsReading.unread} rather than silently dropped.
 *
 * @param refuseOnPrListFailure - the message to refuse with when `pr-list` fails; named by the caller, because each controller's repair text differs.
 * @throws Error (the caller's own class) where the host cannot list its open PRs.
 */
export const openPrsOf = async (
  ctx: OpenPrsContext,
  refuseOnPrListFailure: () => Error,
): Promise<OpenPrsReading> => {
  const listed = await ctx.host.prList('open', PRS_LISTED);
  if (!listed.ok) throw refuseOnPrListFailure();
  const own = listed.value.filter((pr) => pr.repo === '');
  const missing: string[] = [];
  for (const pr of own) {
    const headSha = pr.headSha ?? '';
    if (headSha !== '' && !(await holdsCommit(ctx, headSha))) missing.push(pr.head);
  }
  if (missing.length > 0) await ctx.trees.fetch(ctx.repoRoot, missing);
  const open: OpenPr[] = [];
  const unread: UnreadPr[] = [];
  for (const pr of own) {
    const askedSha = pr.headSha ?? '';
    if (askedSha === '') {
      unread.push({ number: pr.number, reason: 'the host named no head commit' });
      continue;
    }
    const headSha = await resolvedCommit(ctx, askedSha);
    if (headSha === '') {
      unread.push({ number: pr.number, reason: 'git does not hold its head commit' });
      continue;
    }
    const changed = await ctx.refs.changedFiles(headSha);
    if (!changed.ok) {
      unread.push({ number: pr.number, reason: 'its changed files could not be read' });
      continue;
    }
    open.push({ number: pr.number, head: pr.head, draft: pr.draft, headSha, changed: changed.value });
  }
  return { open, unread };
};
