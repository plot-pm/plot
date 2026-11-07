import type { Action, CardFacts, Known, Ref } from '../entities/card-facts.js';
import { resolvePerson, type PersonDirectory } from '../entities/person.js';
import type { PlanStatus } from './phase.js';
import { storyIsLive } from './story-issue.js';
import type { TicketLane } from './ticket-lane.js';
import type { TicketLaneRow } from './ticket-lanes.js';
import type { TicketPlan } from './ticket-phase.js';

/** What `ticketCardFacts` reads of one ticket. */
export interface TicketCardFactsReadings {
  /** The ticket, as `ticketLanes` grouped it. */
  row: TicketLaneRow;
  /** The lane the ticket renders in. */
  lane: TicketLane;
  /** The plans whose `Issue:` names the ticket; `unknown` where the plans could not be read. */
  plans: Known<readonly TicketPlan[]>;
  /** The stories that answer the ticket, from the ticket → story index; `unknown` where the index could not be built. */
  stories: Known<readonly Ref[]>;
}

const enabled = (action: Action['action']): Action => ({ action, enabled: true, reason: null });

/** The `YYYY-MM-DD…` prefix of an ISO date, or `''` where the value is not one. */
const isoDate = (value: string | null): string => /^\d{4}-\d{2}-\d{2}/.exec((value ?? '').trim())?.[0] ?? '';

/** States a plan holds once the ticket's work stopped counting on it. */
const WITHDRAWN = new Set(['rejected', 'superseded']);

/** The measured status a plan's `State:` and merged count read as. */
const statusOf = (plan: TicketPlan): PlanStatus => {
  if (plan.state === 'approved') return plan.merged !== null && plan.merged > 0 ? 'in-progress' : 'approved';
  if (plan.state === 'delivered' || plan.state === 'released') return plan.state;
  return 'draft';
};

/** A story that can receive a plan. */
const isLive = (story: Ref): boolean => story.kind === 'story' && story.status !== null && storyIsLive({ status: story.status, archived: story.archived });

/**
 * What is true about one ticket, as its card shows it.
 *
 * `lineage.plans` holds the plans whose `Issue:` names it, minus `rejected` and
 * `superseded` ones; `lineage.stories` holds the stories the ticket → story
 * index names for it. `progress.work` is `null` with no plan, that plan's
 * slices with one, and the plans themselves (done being Delivered or Released)
 * with two or more.
 *
 * `next` follows the lineage, never the lane alone. A ticket in the `done` or
 * `hidden` lane offers nothing. With the plans unread, or the stories unread
 * where a plan could still be offered, *Create plan* is the primary, disabled
 * with `lineage-unknown`, and nothing else is offered. Otherwise:
 *
 * - a plan and a story: nothing;
 * - a plan, no story: *Create story*;
 * - no plan, two or more live stories: *Create plan*, disabled with
 *   `linked-from-many-stories` naming them;
 * - no plan, one live story: *Create plan*, which belongs inside that story;
 * - no plan, no live story: *Create plan*, outside any story, and *Create
 *   story* as a secondary where no story of any status exists.
 *
 * @param readings - the ticket row, its lane, its plans and its stories.
 * @param directory - the declared `People` spellings; `{}` where none is declared.
 * @returns the ticket's card facts.
 */
export const ticketCardFacts = (readings: TicketCardFactsReadings, directory: PersonDirectory = {}): CardFacts => {
  const { row, lane, plans, stories } = readings;
  const answering: Known<readonly TicketPlan[]> = 'unknown' in plans
    ? plans
    : { value: plans.value.filter((p) => !WITHDRAWN.has(p.state)) };

  let next: CardFacts['next'] = { primary: null, secondary: [] };
  if (lane === 'open' || lane === 'in-progress') {
    if ('unknown' in answering) {
      next = {
        primary: { action: 'create-plan', enabled: false, reason: { kind: 'lineage-unknown', relation: 'plans', reach: answering.unknown } },
        secondary: [],
      };
    } else if (answering.value.length > 0) {
      const storyless = 'value' in stories && stories.value.length === 0;
      next = { primary: storyless ? enabled('create-story') : null, secondary: [] };
    } else if ('unknown' in stories) {
      next = {
        primary: { action: 'create-plan', enabled: false, reason: { kind: 'lineage-unknown', relation: 'stories', reach: stories.unknown } },
        secondary: [],
      };
    } else {
      const live = stories.value.filter(isLive);
      if (live.length >= 2) {
        next = {
          primary: { action: 'create-plan', enabled: false, reason: { kind: 'linked-from-many-stories', stories: live } },
          secondary: [],
        };
      } else {
        next = {
          primary: enabled('create-plan'),
          secondary: stories.value.length === 0 ? [enabled('create-story')] : [],
        };
      }
    }
  }

  const ticket: Ref = { kind: 'ticket', key: row.id, title: row.title, lane };
  const opened = isoDate(row.createdAt);
  const assignees = row.assignees.map((name) => resolvePerson(name, directory).handle);

  return {
    identity: { kind: 'ticket', id: row.id, key: row.id, title: row.title, summary: null, type: null, opens: ticket, alerts: [] },
    lineage: {
      tickets: { value: [] },
      stories: 'unknown' in stories ? stories : { value: [...stories.value] },
      plans: 'unknown' in answering
        ? answering
        : { value: answering.value.map((p): Ref => ({ kind: 'plan', slug: p.slug, key: row.id, title: p.title, status: statusOf(p) })) },
      sprints: { value: [] },
    },
    progress: {
      state: { value: { kind: 'ticket', lane } },
      work: 'unknown' in answering || answering.value.length === 0
        ? null
        : answering.value.length === 1
          ? workOfOne(answering.value[0] as TicketPlan)
          : {
            unit: 'plans',
            done: { value: answering.value.filter((p) => p.state === 'delivered' || p.state === 'released').length },
            total: answering.value.length,
          },
      prs: { value: [] },
      design: null,
      verification: null,
      cost: { value: { tokens: null, measured: 0, absent: 0, unreadable: 0, fromRuns: 0, slices: 0 } },
    },
    next,
    ownership: {
      assignees: { value: assignees },
      assignedFrom: assignees.length === 0 ? null : { source: 'assigned' },
      since: opened === '' ? null : { at: opened, event: 'opened' },
      source: ticket,
    },
  };
};

const workOfOne = (plan: TicketPlan): NonNullable<CardFacts['progress']['work']> | null =>
  plan.total === 0
    ? null
    : { unit: 'slices', done: plan.merged === null ? { unknown: 'unasked' } : { value: plan.merged }, total: plan.total };
