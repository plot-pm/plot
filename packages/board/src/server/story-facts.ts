import {
  PlanStatusSchema,
  SprintStateSchema,
  StoryStatusSchema,
  storyCardFacts,
  storyIssueLink,
  ticketStoryIndex,
  withActionAvailability,
  type IndexedPlan,
  type IndexedStory,
  type PersonDirectory,
  type PlanSprintReading,
  type PlanStatus,
  type StoryIssueContext,
  type StoryPlanCardReading,
} from '@plot-pm/domain';
import type { CardFacts, Known, Ref } from '@plot-pm/domain/entities/card-facts';
import type { DispatchInfo, PlanMeta, SprintCard, StoryCard, StoryCardInput } from '../contract/schema.js';
import { planSlug } from '@plot-pm/domain/rules/auto-dispatch';

/** What a story's facts read beyond the story's own fields. */
export interface StoryFactsContext {
  /** The repository's issue prefix and the declared Jira projects. */
  issueContext: StoryIssueContext;
  /** Each plan card's measured status and issue keys, by slug. */
  plans: ReadonlyMap<string, { status: PlanStatus; issues: readonly string[] }>;
  /** The board's sprints; `null` where they could not be read. */
  sprints: readonly SprintCard[] | null;
  /** The declared `People` spellings. */
  directory: PersonDirectory;
}

/** A sprint card as the domain's sprint reading. */
const sprintReading = (sprint: SprintCard): PlanSprintReading => {
  const state = SprintStateSchema.safeParse(sprint.phase);
  const release = sprint.release.trim();
  return { slug: sprint.slug, title: sprint.title, state: state.success ? state.data : null, release: release === '' ? null : release };
};

/** A plan naming the story, read for the story's card. */
const planReading = (meta: PlanMeta, context: StoryFactsContext): StoryPlanCardReading => {
  const slug = planSlug(meta.file);
  const card = context.plans.get(slug);
  const fallback = PlanStatusSchema.safeParse(meta.phase);
  return {
    slug,
    key: card?.issues[0] ?? null,
    title: meta.title || slug,
    status: card?.status ?? (fallback.success ? fallback.data : 'draft'),
    state: meta.phase.toLowerCase(),
    sprint: meta.sprint,
  };
};

/**
 * A story's card facts, from its parsed fields and the plans that name it,
 * through the domain's `storyCardFacts`.
 *
 * @param input - the story as `parseStoryContent` read it, its `status` the one the file writes.
 * @param plans - the plans whose `Story:` names it.
 * @param archived - whether it lives in the archived directory.
 * @param context - what the build read beside the story.
 * @returns the story's card facts.
 */
export const storyFactsOf = (
  input: StoryCardInput, plans: readonly PlanMeta[], archived: boolean, context: StoryFactsContext,
): CardFacts => storyCardFacts({
  slug: input.slug,
  title: input.title,
  path: input.path ?? '',
  status: input.status,
  archived,
  committed: input.committed ?? false,
  author: input.author ?? '',
  created: input.created ?? '',
  updated: input.updated ?? '',
  objective: input.objective ?? '',
  issue: storyIssueLink(input.issue ?? '', context.issueContext),
  plans: { value: plans.map((meta) => planReading(meta, context)) },
  sprints: context.sprints === null ? { unknown: 'failed' } : { value: context.sprints.map(sprintReading) },
}, context.directory);

/**
 * The ticket → story index the board carries: built only from stories
 * committed on the default branch, and `unknown` where that ref could not be
 * read or a committed story's `issue:` needs the repository's address the
 * board has not read yet.
 *
 * @param stories - every story the board collected, archived included.
 * @param refRead - whether the default branch's stories were read.
 * @param plans - the plans the board read.
 * @param issueContext - the repository's issue prefix and the declared Jira projects.
 * @returns each ticket key's story refs, or `unknown`.
 */
export const ticketStoriesOf = (
  stories: readonly StoryCard[], refRead: boolean, plans: readonly PlanMeta[], issueContext: StoryIssueContext,
): Known<Record<string, Ref[]>> => {
  if (!refRead) return { unknown: 'failed' };
  const committed: IndexedStory[] = stories.filter((s) => s.committed).map((s) => {
    const status = StoryStatusSchema.safeParse(s.declaredStatus);
    return {
      slug: s.slug,
      title: s.title,
      status: status.success ? status.data : null,
      archived: s.archived,
      issue: storyIssueLink(s.issue, issueContext),
    };
  });
  // A link the board could not decide would be missing from the index, and a
  // missing entry reads as *no story*: the whole index is then unknown.
  if (committed.some((s) => s.issue.kind === 'unknown')) return { unknown: 'unasked' };
  const indexed: IndexedPlan[] = plans.map((p) => ({ issues: p.issues.map(String), story: p.story }));
  return { value: Object.fromEntries(ticketStoryIndex(committed, indexed)) };
};

/**
 * The stories with *Add plan* marked against what this board runs: it needs the
 * same capability as *Create plan*.
 *
 * @param stories - the collected stories.
 * @param idea - the board's answer for turning an issue into a plan.
 * @returns the stories, each card's facts passed through `withActionAvailability`.
 */
export const storiesWithAvailability = <S extends Pick<StoryCard, 'facts'>>(stories: readonly S[], idea: DispatchInfo): S[] =>
  stories.map((s) => (s.facts ? { ...s, facts: withActionAvailability(s.facts, { 'add-plan': idea.available }) } : s));
