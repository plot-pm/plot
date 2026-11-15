import { releaseChainStep, type ReleaseChainHop, type ReleaseChainStep } from '@plot-pm/domain/rules/release-chain';
import { carriesMergeOf } from '@plot-pm/domain/rules/merge-subject';
import { mergeSubjectForms } from '@plot-pm/domain/adapters/host/merge-subjects';
import { ownerOfRemote } from '@plot-pm/domain/rules/remote-owner';
import type { Host } from '@plot-pm/domain/ports/host';
import type { Refs } from '@plot-pm/domain/ports/refs';

/**
 * The release-chain walk, shared by `release-chain.ts` and `deliver.ts`.
 *
 * Its own module because an entry file cannot be imported: see
 * `stack-readings.ts`. This module has no main block.
 */

/** What the scan knows about the plan's PR. */
export interface ResolveInput {
  /** The PR number the plan names last. */
  readonly pr: string;
  /** The PR's merge commit, or `''` where the host named none. */
  readonly mergeCommit: string;
  /** When the PR itself merged, ISO-8601, or `''` where the host did not say. */
  readonly mergedAt: string;
  /** The branch the PR merged into, or `''` where the host did not say. */
  readonly base: string;
  /** The PR's head branch, or `''` where the host did not say. */
  readonly head?: string;
  /** The repository's default branch. */
  readonly defaultBranch: string;
  /** The scan's PR source: the CLI name `gh` or `bb`, or a status word. */
  readonly prSource: string;
  /** Whether the scan ran `--no-fetch`/`--offline`, skipping `git fetch`. */
  readonly noFetch: boolean;
}

/** The ports a walk reads. */
export interface ResolvePorts {
  readonly host: Pick<Host, 'prMergeDests' | 'lastRefusal' | 'backend'>;
  readonly refs: Pick<Refs, 'contains' | 'tagsContaining' | 'commitSubjects' | 'remoteUrl'>;
}

/**
 * Walks a PR's release chain from the branch it merged into to the merge
 * commit on the default branch, asking {@link releaseChainStep} for each step.
 *
 * Each candidate is tested two ways: by ancestry through the refs port, and,
 * where ancestry does not answer `yes`, by whether the candidate's merge
 * brought the host's merge subject for the previous step's PR. The second
 * test proves a hop across a branch that was rewritten after the PR merged.
 *
 * @param input - the PR, its merge commit, merge time, base and head, and the default branch.
 * @param ports - the host and refs ports the walk reads.
 * @param warn - where a host refusal's own words go.
 * @returns the walk's last step: `resolved` with the default branch's merge commit, or `refused`.
 */
export const walkReleaseChain = async (
  input: Pick<ResolveInput, 'pr' | 'mergeCommit' | 'mergedAt' | 'base' | 'head' | 'defaultBranch'>,
  ports: ResolvePorts,
  warn: (s: string) => void,
): Promise<Exclude<ReleaseChainStep, { outcome: 'ask' }>> => {
  let subjectReading: SubjectReading | undefined;
  const subjectReadingOf = async (): Promise<SubjectReading> => {
    if (subjectReading === undefined) {
      const backend = await ports.host.backend();
      const url = await ports.refs.remoteUrl('origin');
      subjectReading = {
        forms: backend.ok ? mergeSubjectForms(backend.value) : [],
        owner: url.ok ? ownerOfRemote(url.value) : null,
      };
    }
    return subjectReading;
  };
  const number = Number(input.pr);
  const planPr = input.head !== undefined && input.head !== '' && Number.isInteger(number) ? { number, head: input.head } : undefined;
  const hops: ReleaseChainHop[] = [];
  for (;;) {
    const step = releaseChainStep({
      defaultBranch: input.defaultBranch,
      planCommit: planPr === undefined ? { commit: input.mergeCommit, mergedAt: input.mergedAt } : { commit: input.mergeCommit, mergedAt: input.mergedAt, pr: planPr },
      destination: input.base,
      hops,
    });
    if (step.outcome !== 'ask') return step;
    const merged = await ports.host.prMergeDests(step.branch);
    if (!merged.ok) {
      const said = ports.host.lastRefusal()?.said ?? '';
      warn(`release chain: pr-merge-dest ${step.branch} failed${said === '' ? '' : `: ${said}`}\n`);
      hops.push({ answered: false });
      continue;
    }
    const candidates = [];
    for (const dest of merged.value) {
      const contains = await ports.refs.contains(step.previous, dest.mergeCommit);
      const answer = contains.ok ? contains.value : ('unknown' as const);
      const carries = answer !== 'yes' && step.previousPr !== undefined && (await carriesSubject(dest.mergeCommit, step.previousPr, await subjectReadingOf(), ports));
      candidates.push({ ...dest, contains: answer, carries });
    }
    hops.push({ answered: true, candidates });
  }
};

/** The host's merge-subject forms and the repository's own owner, read once per walk. */
interface SubjectReading {
  readonly forms: readonly string[];
  readonly owner: string | null;
}

/** Whether the commits one merge brought hold the host's merge subject for a PR. */
const carriesSubject = async (
  mergeCommit: string,
  pr: { readonly number: number; readonly head: string },
  { forms, owner }: SubjectReading,
  ports: ResolvePorts,
): Promise<boolean> => {
  if (forms.length === 0) return false;
  const brought = await ports.refs.commitSubjects(`${mergeCommit}^1..${mergeCommit}`);
  if (!brought.ok) return false;
  return carriesMergeOf({ subjects: brought.value.map((c) => c.subject), number: pr.number, branch: pr.head, forms, owner });
};

/**
 * The merge commit on the default branch that carried a PR merged into another
 * branch, and the tags containing it — for a PR whose own merge commit no tag
 * contains.
 *
 * @param pr - the PR's number, merge commit, merge time, base and head.
 * @param defaultBranch - the repository's default branch.
 * @param ports - the host and refs ports the walk reads.
 * @param warn - where a host refusal's own words go.
 * @returns the carried merge commit and its tags; `null` where the PR merged
 *   into the default branch, the walk refused, or git could not read the tags.
 */
export const carriedRelease = async (
  pr: { readonly number: number; readonly mergeCommit: string; readonly mergedAt: string; readonly base: string; readonly head: string },
  defaultBranch: string,
  ports: ResolvePorts,
  warn: (s: string) => void,
): Promise<{ readonly mergeCommit: string; readonly containingTags: readonly string[] } | null> => {
  if (pr.base === '' || pr.base === defaultBranch) return null;
  const step = await walkReleaseChain(
    { pr: String(pr.number), mergeCommit: pr.mergeCommit, mergedAt: pr.mergedAt, base: pr.base, head: pr.head, defaultBranch },
    ports,
    warn,
  );
  if (step.outcome !== 'resolved') return null;
  const tags = await ports.refs.tagsContaining(step.mergeCommit);
  return tags.ok ? { mergeCommit: step.mergeCommit, containingTags: tags.value } : null;
};

