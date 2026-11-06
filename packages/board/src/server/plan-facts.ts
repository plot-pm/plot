import {
  planCardFacts,
  withActionAvailability,
  type ActionAvailability,
  SprintStateSchema,
  StoryStatusSchema,
  type PersonDirectory,
  type PlanRecordsReading,
  type PlanSliceBranch,
  type PlanSlicesReading,
  type PlanSprintReading,
  type PlanStoryReading,
} from '@plot-pm/domain';
import type { CardFacts, Known } from '@plot-pm/domain/entities/card-facts';
import type { Card, Column, DispatchInfo, SprintCard, StoryCard } from '../contract/schema.js';

/** A plan card before its facts are attached. */
export type CardFields = Omit<Card, 'facts'>;

/** What a plan's facts read beyond the card's own fields. */
export interface PlanFactsExtras {
  /** The plan's dated records; absent reads as none recorded. */
  records?: PlanRecordsReading;
  /**
   * The plan's slices as the pulse reports them; absent derives them from
   * `card.sliceSummary`, which carries no complete count.
   */
  slices?: PlanSlicesReading | null;
  /** The spike branch; absent reads as no spike. */
  spike?: PlanSliceBranch | null;
  /** Each PR's head branch by number; absent reads as `''`. */
  prHeads?: ReadonlyMap<number, string>;
  /** The board's stories, archived included; `null` where they could not be read; absent reads as none. */
  stories?: readonly StoryCard[] | null;
  /** The slugs of the archived stories. */
  archived?: ReadonlySet<string>;
  /** The board's sprints; `null` where they could not be read. */
  sprints?: readonly SprintCard[] | null;
  /** Whether the spend record was read; `false` makes the cost unknown. */
  spendRead?: boolean;
  /** The declared `People` spellings. */
  directory?: PersonDirectory;
}

const NO_RECORDS: PlanRecordsReading = {
  designRaw: '', approvedRaw: '', startedRaw: '', deliveredRaw: '', releasedRaw: '',
};

/**
 * The slices a card's summary can say: a total, and the eligible count where a
 * pulse covers the plan. The summary counts no complete slices, so `complete`
 * is never read from it.
 */
const slicesOfSummary = (card: CardFields): PlanSlicesReading | null => {
  const s = card.sliceSummary;
  if (!s || s.slices === 0) return null;
  const scanned = s.claimed !== undefined && s.eligible !== undefined;
  return { total: s.slices, complete: null, eligible: scanned ? s.eligible ?? 0 : null, waitsOn: [] };
};

const storyOf = (
  slug: string, stories: readonly StoryCard[] | null, archived: ReadonlySet<string>,
): Known<PlanStoryReading> => {
  if (stories === null) return { unknown: 'failed' };
  const story = stories.find((s) => s.slug === slug);
  if (!story) return { value: { slug, title: slug, status: null, archived: false } };
  const status = StoryStatusSchema.safeParse(story.status);
  return { value: { slug, title: story.title, status: status.success ? status.data : null, archived: archived.has(slug) } };
};

const sprintOf = (slug: string, sprints: readonly SprintCard[] | null): Known<PlanSprintReading> => {
  if (sprints === null) return { unknown: 'failed' };
  const sprint = sprints.find((s) => s.slug === slug);
  if (!sprint) return { value: { slug, title: slug, state: null } };
  const state = SprintStateSchema.safeParse(sprint.phase);
  return { value: { slug, title: sprint.title, state: state.success ? state.data : null } };
};

/**
 * A plan card's facts, from the card's own fields and what the build read
 * beside them, through the domain's `planCardFacts`.
 *
 * @param card - the plan card's fields.
 * @param extras - what the build read beyond the card.
 * @returns the card's facts.
 */
export const planFactsOf = (card: CardFields, extras: PlanFactsExtras = {}): CardFacts => {
  const cost = card.cost;
  return planCardFacts({
    slug: card.slug,
    title: card.title,
    path: card.path,
    type: card.type,
    assignee: card.assignee ?? '',
    issues: card.issues,
    records: extras.records ?? NO_RECORDS,
    status: card.status ?? 'approved',
    controls: card.controls,
    deliverable: card.deliverable === true,
    rounds: card.rounds ?? null,
    slices: extras.slices !== undefined ? extras.slices : slicesOfSummary(card),
    spike: extras.spike ?? null,
    prs: {
      value: card.prs.map((pr) => ({
        number: pr.number, branch: extras.prHeads?.get(pr.number) ?? '', checks: pr.checks, mergeable: pr.mergeable,
        checksLookup: pr.checksLookup ?? null,
      })),
    },
    verification: card.verification ? { state: card.verification.state, refuted: card.verification.refuted } : null,
    cost: cost === undefined || cost.slices === 0
      ? null
      : extras.spendRead === false
        ? { unknown: 'failed' }
        : { value: { ...cost, fromRuns: cost.fromRuns ?? 0 } },
    story: card.story ? storyOf(card.story, extras.stories === undefined ? [] : extras.stories, extras.archived ?? new Set()) : null,
    sprint: card.sprint ? sprintOf(card.sprint, extras.sprints === undefined ? [] : extras.sprints) : null,
    notPushed: card.notPushed === true,
  }, extras.directory ?? {});
};

/** The capability answers a board payload carries; absent where the board has not said. */
export interface BoardCapabilities {
  dispatch?: DispatchInfo;
  approve?: DispatchInfo;
  interrogate?: DispatchInfo;
  deliver?: DispatchInfo;
}

/**
 * Which card actions a board runs, from its capability answers. An action whose
 * capability the board has not stated is left unnamed, and so left as it is.
 *
 * @param caps - the board's capability answers.
 * @returns the availability `withActionAvailability` reads.
 */
export const actionAvailabilityOf = (caps: BoardCapabilities): ActionAvailability => {
  const out: ActionAvailability = {};
  const set = (info: DispatchInfo | undefined, ...actions: (keyof ActionAvailability)[]) => {
    if (info !== undefined) for (const a of actions) out[a] = info.available;
  };
  set(caps.dispatch, 'start-work');
  set(caps.approve, 'approve', 'approve-spike', 'confirm-slices', 'needs-design');
  set(caps.interrogate, 'interrogate');
  set(caps.deliver, 'deliver');
  return out;
};

/**
 * The board's columns with every card's actions marked against what this board
 * runs — what `/api/board` sends.
 *
 * @param columns - the built columns.
 * @param caps - the board's capability answers.
 * @returns the columns, each card's facts passed through `withActionAvailability`.
 */
export const columnsWithAvailability = <C extends Pick<Column, 'cards'>>(columns: readonly C[], caps: BoardCapabilities): C[] => {
  const available = actionAvailabilityOf(caps);
  return columns.map((column) => ({
    ...column,
    cards: column.cards.map((card) => (card.facts ? { ...card, facts: withActionAvailability(card.facts, available) } : card)),
  }));
};
