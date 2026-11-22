import type { Issue, IssueAnswer } from '../entities/issue.js';
import type { DeliveryMine } from './delivery-placement.js';
import { isMineStrict, mineOwnership, ownedTicket, ownership, type Reader, type TicketSource } from './ownership.js';
import { findOpenReviewIssue } from './review-issue.js';
import { ticketPhase, type TicketPlan } from './ticket-phase.js';
import type { PlanItReason } from './tickets-section.js';

/** The sentence each scope group shows under its rows where the tracker read is incomplete. */
export const SCOPE_INCOMPLETE = 'The tracker read is incomplete; this list may miss tickets.';

/** The reason Create plan refuses on a ticket that a plan already names. */
export const PLAN_NAMED_REASON = 'a plan names this ticket';

/** The reason Create story refuses on a ticket the board holds no row for. */
export const NO_TICKET_ROW_REASON = 'the board holds no row for this ticket';

/** The reason Open on host refuses where no address resolves for a ticket key. */
export const NO_ADDRESS_REASON = 'no address';

/** The member of a sprint as the scope reads it. */
export interface ScopeSprintMember {
  readonly slug: string;
  readonly tier?: string;
}

/** A sprint of the scope, as its members name its plans. */
export interface ScopeTicketSprint {
  readonly members: readonly ScopeSprintMember[];
}

/** The owners of a plan, as the `plan` arm of `ownership` reads them. */
export interface ScopePlanOwners {
  readonly assignee?: string;
  readonly author?: string;
  readonly approver?: string;
}

/** A plan card as the scope groups read it. */
export interface ScopeTicketCard extends ScopePlanOwners {
  readonly slug: string;
  /** The ticket keys the plan's `Issue:` names. */
  readonly issues: readonly string[];
  /** The numbers of the plan's pull requests. */
  readonly prs: readonly number[];
  /** The issue keys its `## Verification` names for refuted claims. */
  readonly refutedIssues: readonly string[];
}

/** A row of the fleet payload's `planTicketRows`, as the scope groups read it. */
export interface ScopeTicketRow {
  readonly number: string;
  readonly title: string;
  readonly url: string;
  readonly state: 'open' | 'closed';
  readonly complete: boolean;
  readonly assignees: readonly string[];
}

/** What {@link scopeTickets} reads. */
export interface ScopeTicketsInput<T extends ScopeTicketRow> {
  /** The sprints of the scope: every Active sprint for `release`, the sprints `deliveryScope` returns for `my-sprint`. */
  readonly sprints: readonly ScopeTicketSprint[];
  /** The plan cards the board read; a card whose slug no scope sprint names adds nothing. */
  readonly cards: readonly ScopeTicketCard[];
  /** The fleet payload's `planTicketRows`. */
  readonly rows: readonly T[];
  /** The fleet payload's `ticketPlans`, keyed by ticket key with no leading `#`. */
  readonly ticketPlans: Readonly<Record<string, readonly TicketPlan[]>>;
  /** The waiting read's hidden counts and the keys behind them; `null` where the payload carries no waiting read. */
  readonly waiting: {
    readonly unassigned: number;
    readonly assignedToOthers: number;
    readonly complete: boolean;
    readonly unassignedKeys: readonly string[];
    readonly assignedToOthersKeys: readonly string[];
  } | null;
  /** Whether the tracker answered; `null` where nobody asked. */
  readonly answer: IssueAnswer | null;
  readonly reader: Reader;
  /** How this read's tickets name their assignees; `null` where unresolved. */
  readonly source: TicketSource | null;
  readonly mine: DeliveryMine;
  /** The address of a ticket key, or `undefined` where the board holds none. */
  readonly ticketHref: (key: string) => string | undefined;
}

/** How a scope row's Create plan or Create story item answers. */
export type ScopeMenuArm =
  | { readonly kind: 'tickets' }
  | { readonly kind: 'disabled'; readonly reason: string; readonly code?: PlanItReason };

/** The ⋯ items of a scope row that {@link scopeTickets} decides. */
export interface ScopeRowMenu {
  readonly openOnHost: { readonly href: string; readonly reason: string | null };
  readonly createPlan: ScopeMenuArm;
  readonly createStory: ScopeMenuArm;
}

/** The kind of a scope row. */
export type ScopeRowKind = 'delivered' | 'review-finding' | 'verification-finding';

/** One row of a scope group. */
export interface ScopeTicketRowView<T extends ScopeTicketRow> {
  /** The ticket key, with no leading `#`. */
  readonly key: string;
  readonly kind: ScopeRowKind;
  /** The kind as the row prints it. */
  readonly kindLabel: string;
  /** The ticket's row; `null` for a key-only row. */
  readonly issue: T | null;
  /** The slug of the plan the row belongs to or was found on. */
  readonly plan: string;
  /** The PR a review finding was found on; `null` for every other kind. */
  readonly pr: number | null;
  /** The plan's `ticketPhase` word for a delivered row; `null` for a finding or where no record exists. */
  readonly phase: string | null;
  /** `open` or `closed` where the row holds the ticket; `null` for a key-only row. */
  readonly ticketState: 'open' | 'closed' | null;
  /** The State cell: the phase word, then `closed` where the row holds a closed ticket, joined by ` · `; `''` where neither applies. */
  readonly stateText: string;
  readonly menu: ScopeRowMenu;
}

/** One scope group. */
export interface ScopeTicketGroup<T extends ScopeTicketRow> {
  readonly key: 'tickets-delivered' | 'tickets-found';
  readonly label: string;
  /** The fold control's text: `<label> · N`, or `<label> · ?` where the tracker is unread. */
  readonly heading: string;
  /** The rows Mine keeps. */
  readonly rows: readonly ScopeTicketRowView<T>[];
  /** The row count, or `null` where the tracker is unread. */
  readonly count: number | null;
  /** The rows Mine hides. */
  readonly hiddenByMine: number;
  /** `— none`, or `— none · N hidden by Mine`, where no row shows; `null` otherwise. */
  readonly empty: string | null;
  /** {@link SCOPE_INCOMPLETE} where the tracker read is incomplete; `null` otherwise. */
  readonly incomplete: string | null;
  /** Whether part of the group could not be read: the tracker is unread. */
  readonly unread: boolean;
}

/** What {@link scopeTickets} answers. */
export interface ScopeTickets<T extends ScopeTicketRow> {
  readonly delivered: ScopeTicketGroup<T>;
  readonly found: ScopeTicketGroup<T>;
  /** The keys of every finding in the scope, before Mine; they leave the "no plan" group. */
  readonly findingKeys: ReadonlySet<string>;
  /** The "no plan" group's hidden counts without the finding keys; `null` where no waiting read exists. */
  readonly noPlan: { readonly unassigned: number; readonly assignedToOthers: number; readonly hidden: number } | null;
}

/** A ticket key with no leading `#`. */
const keyOf = (key: string): string => key.replace(/^#/, '').trim();

/**
 * The slugs of the plans in the scope: every member slug of each sprint, leaving out the `deferred` tier and bare members.
 *
 * @param sprints - the sprints of the scope.
 * @returns the plan slugs.
 */
export const scopePlanSlugs = (sprints: readonly ScopeTicketSprint[]): ReadonlySet<string> =>
  new Set(sprints.flatMap((s) => s.members.filter((m) => m.tier !== 'deferred' && m.slug !== '').map((m) => m.slug)));

/**
 * Whether a scope ticket stays in view under a «Mine» mode.
 *
 * `off` keeps every ticket. `mine` keeps a ticket where `mineOwnership` over the ticket's arm and each plan's arm is not
 * `theirs`. `strict` keeps a ticket only where `isMineStrict` accepts its assignees; a plan does not count.
 *
 * @param ticket - the ticket's assignees; `[]` for a key-only ticket.
 * @param source - how this read's tickets name their assignees; `null` where unresolved.
 * @param plans - the owners of the plans the ticket belongs to or was found on.
 * @param reader - who is reading.
 * @param mode - the Delivery tab's Mine mode.
 * @returns true where the ticket stays in view.
 */
export const ticketIsMine = (
  ticket: { readonly assignees: readonly string[] },
  source: TicketSource | null,
  plans: readonly ScopePlanOwners[],
  reader: Reader,
  mode: DeliveryMine,
): boolean => {
  if (mode === 'off') return true;
  const arm = ownedTicket(ticket.assignees, source);
  if (mode === 'strict') return isMineStrict(arm, reader);
  return mineOwnership([
    ownership(arm, reader),
    ...plans.map((p) => ownership({ kind: 'plan', assignee: p.assignee, author: p.author, approver: p.approver }, reader)),
  ]) !== 'theirs';
};

/** A planTicketRows row as the domain `Issue` that `findOpenReviewIssue` reads. */
const issueOf = (row: ScopeTicketRow): Issue => ({
  id: row.number, title: row.title, url: row.url, createdAt: null, body: null,
  status: row.state, statusCategory: '', closedAt: null, assignees: [...row.assignees],
});

/** The open-on-host item of a key: the row's URL, else the ticket href, else disabled. */
const openOnHost = (row: ScopeTicketRow | null, key: string, ticketHref: (key: string) => string | undefined): ScopeRowMenu['openOnHost'] => {
  const href = row?.url || ticketHref(key) || '';
  return { href, reason: href === '' ? NO_ADDRESS_REASON : null };
};

const TICKETS_RULE: ScopeMenuArm = { kind: 'tickets' };
const NO_ROW: ScopeMenuArm = { kind: 'disabled', reason: NO_TICKET_ROW_REASON };
const PLAN_NAMED: ScopeMenuArm = { kind: 'disabled', reason: PLAN_NAMED_REASON, code: 'plan-named' };

/** The State cell of a row. */
const stateTextOf = (phase: string | null, ticketState: 'open' | 'closed' | null): string =>
  [phase, ticketState === 'closed' ? 'closed' : null].filter((w): w is string => w !== null).join(' · ');

/** The empty hint of a group. */
const emptyOf = (shown: number, hidden: number): string | null =>
  shown > 0 ? null : hidden > 0 ? `— none · ${hidden} hidden by Mine` : '— none';

/**
 * The Tickets section's two scope groups, Delivered by the sprint and Found during the sprint, and the counts of the
 * "no plan" group without the scope's findings.
 *
 * Delivered holds one row per (ticket, scope plan) for each key a scope plan's `issues` names. A key `rows` holds shows
 * its title and its open or closed state; another key shows its key and plan only, with no state. Found holds the open
 * review findings whose PR a scope plan names (`findOpenReviewIssue`), and the keys a scope plan's `refutedIssues`
 * names: on an answered read a key whose row is closed is left out, and a key `rows` lacks shows key and plan only.
 *
 * While the tracker is unread (`failed`, `unsupported`, or `null`), Delivered and the verification findings show key +
 * plan rows, review findings cannot be matched, and each group's `count` is `null`.
 *
 * @param input - the scope, the payload's rows and plans, the waiting read, the reader and the Mine mode.
 * @returns both groups, the finding keys, and the "no plan" group's adjusted hidden counts.
 */
export const scopeTickets = <T extends ScopeTicketRow>(input: ScopeTicketsInput<T>): ScopeTickets<T> => {
  const { rows, ticketPlans, reader, source, mine, ticketHref } = input;
  const answered = input.answer === 'answered';
  const inScope = scopePlanSlugs(input.sprints);
  const cards = input.cards.filter((c) => inScope.has(c.slug));
  const byKey = new Map(rows.map((r) => [keyOf(r.number), r]));
  const read = (key: string): T | null => (answered ? byKey.get(key) ?? null : null);
  const deliveredKeys = new Set(cards.flatMap((c) => c.issues.map(keyOf)));

  const delivered: ScopeTicketRowView<T>[] = [];
  for (const card of cards) {
    for (const key of new Set(card.issues.map(keyOf).filter((k) => k !== ''))) {
      const issue = read(key);
      const record = (ticketPlans[key] ?? []).find((p) => p.slug === card.slug);
      const phase = record === undefined ? null : ticketPhase([record])?.label ?? null;
      const ticketState = issue?.state ?? null;
      delivered.push({
        key, kind: 'delivered', kindLabel: 'Ticket', issue, plan: card.slug, pr: null,
        phase, ticketState, stateText: stateTextOf(phase, ticketState),
        menu: {
          openOnHost: openOnHost(issue, key, ticketHref),
          createPlan: PLAN_NAMED,
          createStory: issue === null ? NO_ROW : TICKETS_RULE,
        },
      });
    }
  }

  const found: ScopeTicketRowView<T>[] = [];
  const findingMenu = (issue: T | null, key: string): ScopeRowMenu => ({
    openOnHost: openOnHost(issue, key, ticketHref),
    createPlan: deliveredKeys.has(key) ? PLAN_NAMED : issue === null ? NO_ROW : TICKETS_RULE,
    createStory: issue === null ? NO_ROW : TICKETS_RULE,
  });
  const openIssues = answered ? rows.filter((r) => r.state === 'open') : [];
  const issues = openIssues.map(issueOf);
  const seen = new Set<string>();
  for (const card of cards) {
    for (const pr of card.prs) {
      const match = findOpenReviewIssue(issues, pr);
      if (match === null) continue;
      const key = keyOf(match.id);
      if (seen.has(key)) continue;
      seen.add(key);
      const issue = byKey.get(key) ?? null;
      found.push({ key, kind: 'review-finding', kindLabel: 'Review finding', issue, plan: card.slug, pr, phase: null, ticketState: issue?.state ?? null, stateText: stateTextOf(null, issue?.state ?? null), menu: findingMenu(issue, key) });
    }
  }
  for (const card of cards) {
    for (const key of card.refutedIssues.map(keyOf)) {
      if (key === '' || seen.has(key)) continue;
      const issue = read(key);
      if (issue !== null && issue.state === 'closed') continue;
      seen.add(key);
      found.push({ key, kind: 'verification-finding', kindLabel: 'Verification finding', issue, plan: card.slug, pr: null, phase: null, ticketState: issue?.state ?? null, stateText: stateTextOf(null, issue?.state ?? null), menu: findingMenu(issue, key) });
    }
  }

  const cardBySlug = new Map(cards.map((c) => [c.slug, c]));
  const keep = (row: ScopeTicketRowView<T>): boolean =>
    ticketIsMine({ assignees: row.issue?.assignees ?? [] }, source, [cardBySlug.get(row.plan) ?? {}], reader, mine);
  const complete = rows.length > 0 ? rows.every((r) => r.complete) : input.waiting?.complete ?? true;
  const incomplete = answered && !complete ? SCOPE_INCOMPLETE : null;
  const group = (key: ScopeTicketGroup<T>['key'], label: string, all: readonly ScopeTicketRowView<T>[]): ScopeTicketGroup<T> => {
    const shown = all.filter(keep);
    const hiddenByMine = all.length - shown.length;
    return { key, label, heading: `${label} · ${answered ? shown.length : '?'}`, rows: shown, count: answered ? shown.length : null, hiddenByMine, empty: emptyOf(shown.length, hiddenByMine), incomplete, unread: !answered };
  };

  const findingKeys: ReadonlySet<string> = seen;
  const waiting = input.waiting;
  const less = (n: number, keys: readonly string[]): number => Math.max(0, n - keys.filter((k) => findingKeys.has(keyOf(k))).length);
  const noPlan = waiting === null ? null : (() => {
    const unassigned = less(waiting.unassigned, waiting.unassignedKeys);
    const assignedToOthers = less(waiting.assignedToOthers, waiting.assignedToOthersKeys);
    return { unassigned, assignedToOthers, hidden: unassigned + assignedToOthers };
  })();

  return {
    delivered: group('tickets-delivered', 'Delivered by the sprint', delivered),
    found: group('tickets-found', 'Found during the sprint', found),
    findingKeys,
    noPlan,
  };
};
