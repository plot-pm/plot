import type { Ownership } from './ownership.js';
import { releaseOf } from './release-of.js';

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
  { section: 'you', groups: ['input-to-the-fleet', 'review-a-result', 'unblock'] },
  { section: 'work-items', groups: ['at-a-gate', 'being-built', 'queued'] },
  { section: 'fleet', groups: ['working', 'blocked', 'free'] },
  { section: 'machine', groups: [] },
] as const;

export type DeliverySection = (typeof DELIVERY_LAYOUT)[number]['section'];
export type YouGroup = 'input-to-the-fleet' | 'review-a-result' | 'unblock';
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
}

export type AgentRole = 'loop' | 'fixer' | 'reviewer' | 'approver' | 'idea' | 'brief';

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
  | 'agent-died'
  | 'ticket-assigned';

export type ItemPlacement =
  | { id: string; kind: ItemKind; section: 'you'; group: YouGroup; reason: YouReason; agents: string[] }
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

export interface DeliveryPlacement {
  items: ItemPlacement[];
  agents: AgentPlacement[];
  unplaced: Unplaced[];
}

type YouCase = { group: YouGroup; reason: YouReason };

const mineAllows = (mode: DeliveryMine, ownership: Ownership): boolean =>
  mode === 'off' || (mode === 'strict' ? ownership === 'mine' : ownership !== 'theirs');

/** The person-facing case an item meets, in the order the rule checks them; `null` when none. */
const youCase = (
  item: WorkItemReading,
  input: DeliveryInput,
  live: number,
  stopped: number,
): YouCase | null => {
  if (item.kind === 'ticket') return item.ownership === 'mine' ? { group: 'input-to-the-fleet', reason: 'ticket-assigned' } : null;
  if (item.phase === 'draft' || item.phase === 'design') return { group: 'input-to-the-fleet', reason: 'draft-plan' };
  if (item.approvalOwed === 'plan') return { group: 'input-to-the-fleet', reason: 'plan-approval' };
  if (item.approvalOwed === 'spike') return { group: 'input-to-the-fleet', reason: 'spike-approval' };
  if (item.approvalOwed === 'release') return { group: 'review-a-result', reason: 'release-approval' };
  if (item.testOwed === true) return { group: 'review-a-result', reason: 'test-delivered-plan' };
  if (item.delivered === true) return null;
  if (item.blockedMarker === true) return { group: 'unblock', reason: 'blocked-marker' };
  const pr = item.pr;
  if (item.stage === 'pr' && pr !== undefined) {
    const spent = (item.corrections ?? 0) >= input.correctionBudget;
    const failing = pr.ci === 'failed' || pr.review === 'high';
    if (item.gateUnpassable === true || (failing && spent)) return { group: 'unblock', reason: 'fleet-stuck' };
    if (item.mergeConflict === true && live === 0) return { group: 'unblock', reason: 'merge-conflict' };
    if (!input.autoReview && pr.ci === 'passed' && (pr.review === 'pending' || pr.review === 'none')) {
      return { group: 'review-a-result', reason: 'review-pr' };
    }
  }
  if (item.stage === 'building' && live === 0 && stopped > 0) return { group: 'unblock', reason: 'agent-died' };
  return null;
};

/** The Work items group of an item no person must act on first, or `null` where a needed reading is absent. */
const workGroup = (item: WorkItemReading, live: number): WorkItemGroup | null => {
  if (item.kind === 'ticket') return 'queued';
  if (item.phase === 'draft' || item.phase === 'design') return 'queued';
  if (item.approvalOwed !== undefined) return 'queued';
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
 * Why a ticket sits in no section, or `null` where it places.
 *
 * A planned ticket shows through its plan, and a closed one (`delivered`) has
 * left the fleet. With the Sprint filter on, a ticket whose `releases` were never
 * read is `unread`, and one whose `releases` name no target is `filtered`.
 */
const ticketUnplaced = (item: WorkItemReading, input: DeliveryInput): Unplaced['reason'] | null => {
  if (item.planned === true) return 'planned';
  if (item.delivered === true) return 'delivered';
  if (!mineAllows(input.mine, item.ownership)) return 'filtered';
  const targets = input.releases;
  if (targets === undefined) return null;
  const releases = item.releases;
  if (releases === undefined) return 'unread';
  const row = { number: item.id, title: '', url: '', releases: [...releases] };
  return targets.some((version) => releaseOf(row, version)) ? null : 'filtered';
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
 * A work item goes to You where a person must act first and to Work items
 * otherwise. An agent goes to Fleet. Each placement names the other side of the
 * link: an item lists the agents acting on it, and an agent carries the id of
 * its item. An agent blocks on any gate, not only on a person.
 *
 * A ticket assigned to the reader goes to You › Input to the fleet, and any
 * other ticket to Work items › Queued, unless a plan names it, it is closed, or
 * the Mine mode or the Sprint filter (`input.releases`) excludes it; each of
 * those appears in `unplaced`.
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
  for (const item of readings.items) {
    const acting = readings.agents.filter((a) => a.actsOn === item.id);
    const live = acting.filter((a) => a.process === 'running').length;
    const stopped = acting.filter((a) => a.process === 'stopped').length;
    const names = acting.map((a) => a.id).sort();

    if (item.kind === 'ticket') {
      const why = ticketUnplaced(item, input);
      if (why !== null) {
        unplaced.push({ id: item.id, subject: 'item', reason: why });
        continue;
      }
    }

    const you = youCase(item, input, live, stopped);
    if (you !== null && mineAllows(input.mine, item.ownership)) {
      items.push({ id: item.id, kind: item.kind, section: 'you', ...you, agents: names });
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

  return { items, agents, unplaced };
};
