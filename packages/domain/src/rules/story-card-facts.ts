import type { Action, Alert, CardFacts, Known, Ref } from '../entities/card-facts.js';
import { resolvePerson, type PersonDirectory } from '../entities/person.js';
import { StoryStatusSchema } from '../entities/story.js';
import { derivedStanding, statusBehind } from '../transitions/story.js';
import type { PlanStatus } from './phase.js';
import type { PlanSprintReading } from './plan-card-facts.js';
import { storyIsLive, type StoryIssueLink } from './story-issue.js';

/** A plan that names the story in its `Story:` field, as the board read it. */
export interface StoryPlanCardReading {
  slug: string;
  /** The plan's first issue key; `null` where it names none. */
  key: string | null;
  title: string;
  /** The plan's measured status. */
  status: PlanStatus;
  /** The plan's `State:`, lowercased; `''` where it could not be read. */
  state: string;
  /** The plan's `Sprint:` slug; `''` where it names none. */
  sprint: string;
}

/** What `storyCardFacts` reads of one story. */
export interface StoryCardFactsReadings {
  slug: string;
  /** The story's title, verbatim. */
  title: string;
  /** The story file's repository-relative path; `''` where no file was found. */
  path: string;
  /** The frontmatter `status:` as written; `''` where absent. */
  status: string;
  /** Whether the story lives in the archived directory. */
  archived: boolean;
  /** The frontmatter `author:`; `''` where absent. */
  author: string;
  /** The frontmatter `created:`; `''` where absent. */
  created: string;
  /** The frontmatter `updated:`; `''` where absent. */
  updated: string;
  /** The objective's opening text, verbatim; `''` where the story has none. */
  objective: string;
  /** What the story's `issue:` names. */
  issue: StoryIssueLink;
  /** The plans naming the story; `unknown` where the plans could not be read. */
  plans: Known<readonly StoryPlanCardReading[]>;
  /** Every sprint the board read; `unknown` where the sprints could not be read. */
  sprints: Known<readonly PlanSprintReading[]>;
}

/** The longest summary a card carries. */
const SUMMARY_MAX = 280;

/** The `YYYY-MM-DD` a frontmatter date starts with, or `''`. */
const isoDate = (value: string): string => /^\d{4}-\d{2}-\d{2}/.exec(value.trim())?.[0] ?? '';

const enabled = (action: Action['action']): Action => ({ action, enabled: true, reason: null });

/** The sprints the story's plans name, each once, in the order the plans name them. */
const sprintRefs = (
  plans: readonly StoryPlanCardReading[], sprints: Known<readonly PlanSprintReading[]>,
): Known<Ref[]> => {
  const slugs = [...new Set(plans.map((p) => p.sprint).filter((s) => s !== ''))];
  if (slugs.length === 0) return { value: [] };
  if ('unknown' in sprints) return { unknown: sprints.unknown };
  return {
    value: slugs.map((slug): Ref => {
      const sprint = sprints.value.find((s) => s.slug === slug);
      return { kind: 'sprint', ...(sprint ?? { slug, title: slug, state: null, release: null }) };
    }),
  };
};

/**
 * What is true about one story, as its card shows it.
 *
 * `identity.key` is the issue its `issue:` names, and `lineage.tickets` holds
 * that issue; an `issue:` this repository does not accept is an
 * `issue-link-unreadable` alert and links no ticket. `progress.state` is the
 * written `status:`, `unknown` where it is absent or not a status the domain
 * admits. `progress.work` counts its plans, done being Delivered or Released;
 * `null` where it has none or they were not read. A `status-behind` alert names the standing its
 * plans prove where the written status is behind it. A live story offers *Add
 * plan*: as the primary where it has no plans, else as a secondary; a done or
 * archived story offers nothing. The assignee is its `author:`, resolved
 * through `People`; `ownership.since` is its `updated:` date, else its
 * `created:` date.
 *
 * @param readings - the story's frontmatter, issue link, plans and the board's sprints.
 * @param directory - the declared `People` spellings; `{}` where none is declared.
 * @returns the story's card facts.
 */
export const storyCardFacts = (readings: StoryCardFactsReadings, directory: PersonDirectory = {}): CardFacts => {
  const parsed = StoryStatusSchema.safeParse(readings.status.trim());
  const status = parsed.success ? parsed.data : null;
  const { plans, issue } = readings;

  const alerts: Alert[] = [];
  if (status !== null && !('unknown' in plans)) {
    const proven = statusBehind(status, derivedStanding(status, plans.value.map((p) => ({ phase: p.state }))));
    if (proven !== null) alerts.push({ kind: 'status-behind', proven });
  }
  if (issue.kind === 'unreadable') alerts.push({ kind: 'issue-link-unreadable', value: issue.value });

  const tickets: Known<Ref[]> = issue.kind === 'key'
    ? { value: [{ kind: 'ticket', key: issue.key, title: issue.key, lane: null }] }
    : issue.kind === 'unknown' ? { unknown: 'unasked' } : { value: [] };

  const live = storyIsLive({ status, archived: readings.archived });
  const hasPlans = 'unknown' in plans || plans.value.length > 0;
  const next: CardFacts['next'] = !live
    ? { primary: null, secondary: [] }
    : hasPlans ? { primary: null, secondary: [enabled('add-plan')] } : { primary: enabled('add-plan'), secondary: [] };

  const author = readings.author.trim();
  const updated = isoDate(readings.updated);
  const created = isoDate(readings.created);
  const summary = readings.objective.trim();

  return {
    identity: {
      kind: 'story',
      id: readings.slug,
      key: issue.kind === 'key' ? issue.key : null,
      title: readings.title,
      summary: summary === '' ? null : summary.slice(0, SUMMARY_MAX),
      type: null,
      opens: { kind: 'story', slug: readings.slug, title: readings.title, status, archived: readings.archived },
      alerts,
    },
    lineage: {
      tickets,
      stories: { value: [] },
      plans: 'unknown' in plans
        ? { unknown: plans.unknown }
        : { value: plans.value.map((p): Ref => ({ kind: 'plan', slug: p.slug, key: p.key, title: p.title, status: p.status })) },
      sprints: 'unknown' in plans ? { unknown: plans.unknown } : sprintRefs(plans.value, readings.sprints),
    },
    progress: {
      state: status === null ? { unknown: 'failed' } : { value: { kind: 'story', status } },
      // Unread plans show as `plans unknown` in the lineage; a count of them would claim a total.
      work: 'unknown' in plans || plans.value.length === 0
          ? null
          : {
            unit: 'plans',
            done: { value: plans.value.filter((p) => p.state === 'delivered' || p.state === 'released').length },
            total: plans.value.length,
          },
      prs: { value: [] },
      design: null,
      verification: null,
      cost: { value: { tokens: null, measured: 0, absent: 0, unreadable: 0, fromRuns: 0, slices: 0 } },
    },
    next,
    ownership: {
      assignees: { value: author === '' ? [] : [resolvePerson(author, directory).handle] },
      assignedFrom: author === '' ? null : { source: 'assigned' },
      since: updated !== '' ? { at: updated, event: 'updated' } : created !== '' ? { at: created, event: 'opened' } : null,
      source: { path: readings.path },
    },
  };
};
