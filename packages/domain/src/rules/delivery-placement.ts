import type { Ownership } from './ownership.js';

/**
 * The sections of the Delivery tab, top to bottom, and the groups inside the
 * three that hold rows.
 *
 * `release-delivery` and `machine` carry no groups: the rule places no row in
 * either. Release delivery is an overview scoped to the target release, and
 * machine is a reading of load and service limits. The tab imports this
 * constant for its section and group order.
 */
export const DELIVERY_LAYOUT = [
  { section: 'release-delivery', groups: [] },
  { section: 'you', groups: ['blocks-delivery', 'input-to-the-fleet', 'unblock'] },
  { section: 'work-items', groups: ['at-a-gate', 'being-built', 'queued'] },
  { section: 'fleet', groups: ['working', 'blocked', 'free'] },
  { section: 'machine', groups: [] },
] as const;

export type DeliverySection = (typeof DELIVERY_LAYOUT)[number]['section'];
export type YouGroup = 'blocks-delivery' | 'input-to-the-fleet' | 'unblock';

/** The marker a You group draws: red, blue and grey "clean up". */
export type YouMarker = 'blocks-delivery' | 'input' | 'clean-up';
export type WorkItemGroup = 'at-a-gate' | 'being-built' | 'queued';
export type FleetGroup = 'working' | 'blocked' | 'free';

/** What stops an agent or holds a slice: any gate, not only a person. */
export type DeliveryGate = 'ci' | 'review' | 'machine' | 'rate-limit' | 'person';

/** The Mine filter's three modes, passed as a value because the filter lives in the board app. */
export type DeliveryMine = 'off' | 'mine' | 'strict';

/** How far a slice, PR or branch has come. */
export type ItemStage = 'queued' | 'building' | 'pr';

export type ItemKind = 'plan' | 'slice' | 'pr' | 'branch' | 'release' | 'ticket';

/** The facts of one open PR. `unread` is a reading nobody took, never `false`. */
export interface PrReading {
  ci: 'running' | 'failed' | 'passed' | 'unread';
  review: 'pending' | 'high' | 'passed' | 'none' | 'unread';
}

/** What was measured of one work item. Every optional field is absent when nobody read it. */
export interface WorkItemReading {
  id: string;
  kind: ItemKind;
  /** Who the item belongs to, as the ownership rule answers for the reader. */
  ownership: Ownership;
  /** A plan's phase. `draft` and `design` need the person who owns the plan. */
  phase?: 'draft' | 'design' | 'approved' | 'delivered' | 'released';
  /** An approval the lifecycle needs from a person. */
  approvalOwed?: 'plan' | 'spike' | 'release';
  /** A delivered plan waits for a person to test it. */
  testOwed?: boolean;
  /** A `PLOT-BLOCKED` marker sits on the item's desk. */
  blockedMarker?: boolean;
  /** The PR conflicts with the default branch. */
  mergeConflict?: boolean;
  /** A person's comment on the PR is unanswered, bound to the PR's head and last update. */
  personComment?: boolean;
  /** The fleet cannot pass the gate holding the item alone. */
  gateUnpassable?: boolean;
  /** A slice's merged PR, or a plan in Delivered or Released, has left the fleet's hands. */
  delivered?: boolean;
  stage?: ItemStage;
  pr?: PrReading;
  /** Fixer attempts spent on the open PR. */
  corrections?: number;
  /** A gate outside the item that holds it, such as a red default branch. */
  heldBy?: Exclude<DeliveryGate, 'person' | 'ci' | 'review'>;
  /** The slice an earlier slice must finish first. */
  waitsOn?: string;
  /** A ticket that a plan names: the plan places it, so no section of its own holds it. */
  planned?: boolean;
  /** A ticket's planned release versions: `[]` where the tracker was asked and named none, absent where it was not asked. */
  releases?: readonly string[];
  /** What was measured to decide whether a PR or branch is loose; absent where nobody asked. */
  loose?: LooseReading;
}

/**
 * The facts that decide whether a PR or a branch is loose: no plan names it and
 * nobody works on it. Each is absent where nobody read it, never `false`.
 */
export interface LooseReading {
  /** A plan names the item, whatever its state. */
  named?: boolean;
  /** A desk on this machine, a registry manifest or a running worker holds the branch. A claim commit alone is not a hold. */
  held?: boolean;
  /** A fleetd fixer runs on the item's open PR now. Read for a `pr` only. */
  fixing?: boolean;
  /** The item's PR is closed unmerged. A closed PR has no fixer, so `fixing` is not asked of it. Read for a `pr` only. */
  closed?: boolean;
  /** Every commit the branch holds beyond the default branch is an empty claim marker. */
  claimOnly?: boolean;
  /** The claim was made where this machine holds no worktree for the branch. Read where `claimOnly` holds. */
  claimElsewhere?: boolean;
}

export type AgentRole = 'loop' | 'fixer' | 'reviewer' | 'approver' | 'idea' | 'brief' | 'design' | 'verify';

/** What was measured of one agent. */
export interface AgentPlacementReading {
  id: string;
  role: AgentRole;
  /** The process: absent when unread. */
  process?: 'running' | 'stopped';
  /** The id of the work item it acts on, or `null` while it holds none. */
  actsOn: string | null;
  /** The gate it waits on, or `null`. */
  blockedOn: DeliveryGate | null;
  /** Epoch milliseconds of the start; `null` where the source carries none; absent where nobody read it. */
  startedAt?: number | null;
}

export interface DeliveryReadings {
  items: readonly WorkItemReading[];
  agents: readonly AgentPlacementReading[];
}

export interface DeliveryInput {
  mine: DeliveryMine;
  /** The `Auto-review` config key. */
  autoReview: boolean;
  /** The `Correction budget` config key. */
  correctionBudget: number;
  /**
   * The target releases of the selected sprints; absent where the Sprint filter is off.
   * Where present, a ticket places only if one of its `releases` is named here.
   */
  releases?: readonly string[];
}

/** Why an item sits under You. */
export type YouReason =
  | 'draft-plan'
  | 'plan-approval'
  | 'spike-approval'
  | 'release-approval'
  | 'test-delivered-plan'
  | 'review-pr'
  | 'blocked-marker'
  | 'fleet-stuck'
  | 'merge-conflict'
  | 'person-comment'
  | 'agent-died'
  | 'loose';

export type ItemPlacement =
  | { id: string; kind: ItemKind; section: 'you'; group: YouGroup; marker: YouMarker; reason: YouReason; agents: string[] }
  | { id: string; kind: ItemKind; section: 'work-items'; group: WorkItemGroup; reason: null; agents: string[] };

export interface AgentPlacement {
  id: string;
  role: AgentRole;
  section: 'fleet';
  group: FleetGroup;
  actsOn: string | null;
  /** Whether `actsOn` names an item in the readings. */
  linked: boolean;
  blockedOn: DeliveryGate | null;
}

/**
 * A subject no section holds, with the reason: `delivered` has left the fleet's
 * hands, `unread` lacks a reading, `planned` shows through its plan, and
 * `filtered` lies outside the Mine mode or the Sprint filter.
 */
export interface Unplaced {
  id: string;
  subject: 'item' | 'agent';
  reason: 'delivered' | 'unread' | 'planned' | 'filtered';
}

/** A ticket the Tickets section holds: no plan names it and it is open. `ownership` says whose it is. */
export interface TicketPlacement {
  id: string;
  ownership: Ownership;
}

export interface DeliveryPlacement {
  items: ItemPlacement[];
  /** The tickets the Tickets section holds; no ticket is also an entry of `items`. */
  tickets: TicketPlacement[];
  /** The ids of the release items the release cards hold; no release is also an entry of `items`. */
  releases: string[];
  agents: AgentPlacement[];
  unplaced: Unplaced[];
}

/**
 * The marker each You group draws, and the words it shows beside the group's
 * label. No group carries words: each group's title names it, so the marker
 * adds the colour only.
 */
export const YOU_GROUP_MARKERS: Record<YouGroup, { marker: YouMarker; words: string | null }> = {
  'blocks-delivery': { marker: 'blocks-delivery', words: null },
  'input-to-the-fleet': { marker: 'input', words: null },
  unblock: { marker: 'clean-up', words: null },
};

/** What an item needs from a person: the group it sits in, why, and the marker the group draws. */
export interface YouCase {
  group: YouGroup;
  reason: YouReason;
  marker: YouMarker;
}

const YOU_GROUP_OF: Record<YouReason, YouGroup> = {
  'draft-plan': 'input-to-the-fleet',
  'plan-approval': 'blocks-delivery',
  'spike-approval': 'blocks-delivery',
  'release-approval': 'blocks-delivery',
  'test-delivered-plan': 'blocks-delivery',
  'review-pr': 'blocks-delivery',
  'blocked-marker': 'blocks-delivery',
  'fleet-stuck': 'blocks-delivery',
  'merge-conflict': 'blocks-delivery',
  'person-comment': 'blocks-delivery',
  'agent-died': 'blocks-delivery',
  loose: 'unblock',
};

const YOU_CASES = Object.fromEntries(
  (Object.entries(YOU_GROUP_OF) as [YouReason, YouGroup][]).map(([reason, group]) =>
    [reason, { group, reason, marker: YOU_GROUP_MARKERS[group].marker }]),
) as Record<YouReason, YouCase>;

/**
 * The case of a You reason: its group and marker.
 *
 * @param reason - the reason an item sits under You.
 * @returns the case; it does not depend on who reads the board.
 */
export const youCaseOf = (reason: YouReason): YouCase => YOU_CASES[reason];

const STUCK_REASONS: readonly YouReason[] = ['blocked-marker', 'fleet-stuck', 'merge-conflict', 'agent-died', 'loose'];

/**
 * Whether a reason names an item the fleet cannot take further alone.
 *
 * The set is the one the former Unblock group held, so a count over it does not
 * move with the fold of Review a result into Blocks delivery.
 *
 * @param reason - the reason an item sits under You.
 * @returns true for `blocked-marker`, `fleet-stuck`, `merge-conflict`, `agent-died` and `loose`.
 */
export const isStuckReason = (reason: YouReason): boolean => STUCK_REASONS.includes(reason);

/**
 * Whether a PR or a branch is loose, from the readings taken of it.
 *
 * Loose means no plan names the item, no desk or manifest holds it, and, for a
 * PR, no fixer runs on it. A delivered item has left the fleet and is never
 * loose. An item with no `loose` reading was never asked and is `not-loose`;
 * one with a reading that lacks a fact the decision needs is `unread`, because
 * an absent fact is not a false one.
 */
const looseOf = (item: WorkItemReading): 'loose' | 'not-loose' | 'unread' => {
  if (item.kind !== 'pr' && item.kind !== 'branch') return 'not-loose';
  const facts = item.loose;
  if (facts === undefined || item.delivered === true) return 'not-loose';
  if (facts.named === true || facts.held === true || facts.fixing === true) return 'not-loose';
  if (facts.named === undefined || facts.held === undefined) return 'unread';
  if (item.kind === 'pr' && facts.closed !== true && facts.fixing === undefined) return 'unread';
  return 'loose';
};

/** Which actions a loose item offers. */
export interface LooseActions {
  /** `loose-delete` accepts the item: a branch with work and no claim-only history, or a branch whose PR is closed. */
  delete: boolean;
  /**
   * `release-claim` accepts the item: a branch that holds only its claim and no PR. `elsewhere` where this
   * machine holds no worktree for the claim, so the claim belongs to another machine; `null` where release refuses.
   */
  release: 'here' | 'elsewhere' | null;
}

/**
 * The actions a loose item offers, following the refusals of `loose-delete` and `release-claim`.
 *
 * `loose-delete` refuses `claimed` for a branch whose only commits are claim markers, and `release-claim`
 * refuses a branch that carries work, so a branch offers exactly one of the two. A branch whose claim
 * nobody read offers neither.
 *
 * @param item - the item's kind and loose reading.
 * @returns Release for a claim-only branch, Delete for a branch with work or a closed PR, and neither for an
 *   open PR, an unread claim or an item with no loose reading.
 */
export const looseActions = (item: Pick<WorkItemReading, 'kind' | 'loose'>): LooseActions => {
  const none: LooseActions = { delete: false, release: null };
  if (item.loose === undefined) return none;
  if (item.kind === 'pr') return item.loose.closed === true ? { delete: true, release: null } : none;
  if (item.kind !== 'branch' || item.loose.claimOnly === undefined) return none;
  if (item.loose.claimOnly) return { delete: false, release: item.loose.claimElsewhere === true ? 'elsewhere' : 'here' };
  return { delete: true, release: null };
};

/** Whether a Mine mode shows a ticket of this ownership; no other item asks it. */
const mineAllows = (mode: DeliveryMine, ownership: Ownership): boolean =>
  mode === 'off' || (mode === 'strict' ? ownership === 'mine' : ownership !== 'theirs');

/**
 * The person-facing case an item meets, in the order the rule checks them.
 *
 * @param item - the item's reading.
 * @param input - the `Auto-review` key and the `Correction budget`.
 * @param live - the running agents acting on the item.
 * @param stopped - the stopped agents acting on the item.
 * @returns the case, or `null` where none applies. The answer ignores ownership and the Mine mode.
 */
export const youCaseOfItem = (
  item: WorkItemReading,
  input: DeliveryInput,
  live: number,
  stopped: number,
): YouCase | null => {
  if (item.phase === 'draft' || item.phase === 'design') return YOU_CASES['draft-plan'];
  if (item.approvalOwed === 'plan') return YOU_CASES['plan-approval'];
  if (item.approvalOwed === 'spike') return YOU_CASES['spike-approval'];
  if (item.testOwed === true) return YOU_CASES['test-delivered-plan'];
  if (item.delivered === true) return null;
  if (item.blockedMarker === true) return YOU_CASES['blocked-marker'];
  const pr = item.pr;
  if (item.stage === 'pr' && pr !== undefined) {
    const spent = (item.corrections ?? 0) >= input.correctionBudget;
    const failing = pr.ci === 'failed' || pr.review === 'high';
    if (item.gateUnpassable === true || (failing && spent)) return YOU_CASES['fleet-stuck'];
    if (item.mergeConflict === true && live === 0) return YOU_CASES['merge-conflict'];
    if (item.personComment === true) return YOU_CASES['person-comment'];
    if (!input.autoReview && pr.ci === 'passed' && (pr.review === 'pending' || pr.review === 'none')) {
      return YOU_CASES['review-pr'];
    }
  }
  if (item.stage === 'building' && live === 0 && stopped > 0) return YOU_CASES['agent-died'];
  if (looseOf(item) === 'loose') return YOU_CASES['loose'];
  return null;
};

/** The Work items group of an item no person must act on first, or `null` where a needed reading is absent. */
const workGroup = (item: WorkItemReading, live: number): WorkItemGroup | null => {
  if (item.heldBy !== undefined) return 'at-a-gate';
  switch (item.stage) {
    case 'pr':
      return item.pr === undefined || item.pr.ci === 'unread' ? null : 'at-a-gate';
    case 'building':
      return live > 0 ? 'being-built' : 'queued';
    case 'queued':
      return 'queued';
    default:
      return null;
  }
};

/**
 * Why a ticket sits in no section, or `null` where the Tickets section holds it.
 *
 * A planned ticket shows through its plan, and a closed one (`delivered`) has
 * left the fleet. The Sprint filter (`input.releases`) does not apply: the
 * Tickets section is unscoped.
 */
const ticketUnplaced = (item: WorkItemReading, input: DeliveryInput): Unplaced['reason'] | null => {
  if (item.planned === true) return 'planned';
  if (item.delivered === true) return 'delivered';
  if (!mineAllows(input.mine, item.ownership)) return 'filtered';
  return null;
};

const agentGroup = (agent: AgentPlacementReading): FleetGroup | null => {
  if (agent.process === undefined) return null;
  if (agent.process === 'stopped') return agent.actsOn === null ? 'free' : 'blocked';
  if (agent.blockedOn !== null) return 'blocked';
  return agent.actsOn === null ? 'free' : 'working';
};

/**
 * Places every work item and every agent on the Delivery tab, once.
 *
 * A work item goes to You where a person must act first and its ownership is
 * not `'theirs'`, in every Mine mode. An item a person must act on that is
 * `'theirs'` goes to Work items › Queued, a delivered plan to test included.
 * Every other item that is not delivered goes to Work items. An agent goes to
 * Fleet. Each placement names the other side of the link: an item lists the
 * agents acting on it, and an agent carries the id of its item. An agent blocks on any gate, not only on a person.
 *
 * A release item, or an item owing a release approval, goes to `releases` and
 * to no section: the release cards hold it.
 *
 * A ticket goes to `tickets` and to no section of `items`, unless a plan names
 * it, it is closed, or the Mine mode excludes it; each of those appears in
 * `unplaced`. The Sprint filter (`input.releases`) does not apply to tickets.
 *
 * A PR or branch that no plan names, no desk or manifest holds and no fixer
 * works on is loose and goes to You › Unblock with the reason `loose`. One whose
 * loose reading lacks a fact, and that meets no other You case, is `unread` and
 * never loose. A `release` item is never loose.
 *
 * A subject whose needed reading is absent, and a delivered item, appear in
 * `unplaced` with the reason; nothing defaults to Work items. The rule stores
 * nothing and reads nothing outside its arguments.
 *
 * @param readings - the work items and agents as measured.
 * @param input - the Mine mode, the `Auto-review` key and the `Correction budget`.
 * @returns the placement of every subject, with `unplaced` for those no section holds.
 */
export const placeDelivery = (readings: DeliveryReadings, input: DeliveryInput): DeliveryPlacement => {
  const unplaced: Unplaced[] = [];
  const agents: AgentPlacement[] = [];
  const itemIds = new Set(readings.items.map((i) => i.id));

  for (const agent of readings.agents) {
    const group = agentGroup(agent);
    if (group === null) {
      unplaced.push({ id: agent.id, subject: 'agent', reason: 'unread' });
      continue;
    }
    agents.push({
      id: agent.id,
      role: agent.role,
      section: 'fleet',
      group,
      actsOn: agent.actsOn,
      linked: agent.actsOn !== null && itemIds.has(agent.actsOn),
      blockedOn: agent.blockedOn,
    });
  }

  const items: ItemPlacement[] = [];
  const tickets: TicketPlacement[] = [];
  const releases: string[] = [];
  for (const item of readings.items) {
    if (item.kind === 'release' || item.approvalOwed === 'release') {
      releases.push(item.id);
      continue;
    }
    const acting = readings.agents.filter((a) => a.actsOn === item.id);
    const live = acting.filter((a) => a.process === 'running').length;
    const stopped = acting.filter((a) => a.process === 'stopped').length;
    const names = acting.map((a) => a.id).sort();

    if (item.kind === 'ticket') {
      const why = ticketUnplaced(item, input);
      if (why !== null) {
        unplaced.push({ id: item.id, subject: 'item', reason: why });
      } else {
        tickets.push({ id: item.id, ownership: item.ownership });
      }
      continue;
    }

    const you = youCaseOfItem(item, input, live, stopped);
    if (you === null && looseOf(item) === 'unread') {
      unplaced.push({ id: item.id, subject: 'item', reason: 'unread' });
      continue;
    }
    if (you !== null && item.ownership !== 'theirs') {
      items.push({ id: item.id, kind: item.kind, section: 'you', ...you, agents: names });
      continue;
    }
    if (you !== null) {
      items.push({ id: item.id, kind: item.kind, section: 'work-items', group: 'queued', reason: null, agents: names });
      continue;
    }
    if (item.delivered === true) {
      unplaced.push({ id: item.id, subject: 'item', reason: 'delivered' });
      continue;
    }
    const group = workGroup(item, live);
    if (group === null) {
      unplaced.push({ id: item.id, subject: 'item', reason: 'unread' });
      continue;
    }
    items.push({ id: item.id, kind: item.kind, section: 'work-items', group, reason: null, agents: names });
  }

  return { items, tickets, releases, agents, unplaced };
};
