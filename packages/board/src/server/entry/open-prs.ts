import type { Host, Refs, Trees } from '@plot-pm/domain';
import { planPrOf, type NamedPr, type OpenPr, type PlanPrFound, type PlanPrReadings, type PlanPrRefusal } from '@plot-pm/domain/rules/plan-pr';

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
 * @param against - the branch the changed paths are read against; the default branch where absent.
 * @throws Error (the caller's own class) where the host cannot list its open PRs.
 */
export const openPrsOf = async (
  ctx: OpenPrsContext,
  refuseOnPrListFailure: () => Error,
  against?: string,
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
    const changed = await ctx.refs.changedFiles(headSha, against);
    if (!changed.ok) {
      unread.push({ number: pr.number, reason: 'its changed files could not be read' });
      continue;
    }
    open.push({ number: pr.number, head: pr.head, draft: pr.draft, headSha, changed: changed.value });
  }
  return { open, unread };
};

/**
 * Reads a PR's head: fetches `branch` when git does not already hold the
 * host's reported sha, resolves it to the full oid, and reads the files it
 * changes against the default branch.
 *
 * This is `planPrOf`'s `named-head` reading: the one answer that serves the
 * record read, the `plot/review` status write and the merge's `--match-head`
 * pin, so none of the three can land on a sha a later push has moved past.
 *
 * @param branch - the PR's head branch.
 * @param askedSha - the sha the host reported for it; `''` where it named none.
 * @param against - the branch the changed paths are read against; the default branch where absent.
 * @returns the full sha and its changed files, or `null` where git does not
 *   hold the commit after fetching.
 */
export const readHeadOf = async (
  ctx: OpenPrsContext,
  branch: string,
  askedSha: string,
  against?: string,
): Promise<{ sha: string; changed: readonly string[] } | null> => {
  if (askedSha !== '' && !(await holdsCommit(ctx, askedSha))) await ctx.trees.fetch(ctx.repoRoot, branch);
  const sha = await resolvedCommit(ctx, askedSha !== '' ? askedSha : branch);
  if (sha === '') return null;
  const changed = await ctx.refs.changedFiles(sha, against);
  if (!changed.ok) return null;
  return { sha, changed: changed.value };
};

/**
 * Asks {@link planPrOf} until it answers, reading each reading it names.
 *
 * Host refusals throw, and the caller holds them until the domain has judged
 * the phase and the review channel.
 *
 * @param onUnread - told the own-repo open rows that could not be read, where
 *   the open PRs were listed at all.
 * @param refuseOnHostFailure - the message to refuse with when a host call
 *   fails; named by the caller, because each controller's repair text differs.
 * @param against - the branch a PR head's changed paths are read against; the
 *   default branch where absent.
 * @returns the PR {@link planPrOf} found, its own refusal passed through
 *   unevaluated, or `undefined` where the plan has no PR to find.
 */
export const choosePlanPr = async (
  ctx: OpenPrsContext,
  readings: PlanPrReadings,
  main: string,
  file: string,
  onUnread: (unread: readonly UnreadPr[]) => void,
  refuseOnHostFailure: (detail: string) => Error,
  against?: string,
): Promise<PlanPrFound | PlanPrRefusal | undefined> => {
  let current = readings;
  for (;;) {
    const answer = planPrOf(current);
    if (answer.outcome === 'none') return undefined;
    if (answer.outcome === 'found') return answer;
    if (answer.outcome === 'refused') return answer;
    switch (answer.ask) {
      case 'named': {
        const lookup = await ctx.host.prState(`idea/${current.slug}`);
        if (!lookup.ok) {
          throw refuseOnHostFailure(lookup.why === 'unaskable'
            ? `the host backend has no answer for the PR state of 'idea/${current.slug}' (plot-host.sh pr-state exited 4).`
            : `the host could not be asked for the PR of 'idea/${current.slug}' (plot-host.sh pr-state refused the call).`);
        }
        const pr = lookup.value;
        const named: NamedPr | null = pr !== null && (pr.state === 'MERGED' || pr.state === 'OPEN' || pr.state === 'CLOSED')
          ? { number: pr.number, state: pr.state, draft: pr.draft, headSha: pr.headSha }
          : null;
        current = { ...current, named };
        break;
      }
      case 'named-head': {
        if (current.named === undefined || current.named === null) throw refuseOnHostFailure('the named PR vanished between readings.');
        const head = await readHeadOf(ctx, `idea/${current.slug}`, current.named.headSha ?? '', against);
        current = { ...current, namedHead: head };
        break;
      }
      case 'open': {
        const reading = await openPrsOf(ctx, () => refuseOnHostFailure("the host could not list its open PRs to find the one that changes the plan (plot-host.sh pr-list refused the call)."), against);
        onUnread(reading.unread);
        current = { ...current, open: reading.open };
        break;
      }
      case 'addition': {
        const added = await ctx.refs.firstParentAddition(`origin/${main}`, file);
        const sha = added.ok ? added.value : '';
        const second = sha === '' ? undefined : await ctx.refs.resolve(`${sha}^2`);
        current = { ...current, addition: { sha, secondParent: second?.ok ? second.value : '' } };
        break;
      }
      case 'merged': {
        const listed = await ctx.host.prList('merged', PRS_LISTED);
        if (!listed.ok) {
          throw refuseOnHostFailure("the host could not list its merged PRs to find the one that brought the plan onto the default branch (plot-host.sh pr-list refused the call).");
        }
        current = { ...current, merged: listed.value.map((pr) => ({ number: pr.number, headSha: pr.headSha ?? '' })) };
        break;
      }
      case 'confirm': {
        const asked = await ctx.host.prState(answer.number);
        if (!asked.ok) {
          throw refuseOnHostFailure(asked.why === 'unaskable'
            ? `the host backend has no answer for the PR state of PR #${answer.number} (plot-host.sh pr-state exited 4).`
            : `the host could not be asked for PR #${answer.number} (plot-host.sh pr-state refused the call).`);
        }
        current = {
          ...current,
          confirmed: asked.value === null ? null : { state: asked.value.state, mergeCommit: asked.value.mergeCommit },
        };
        break;
      }
    }
  }
};
