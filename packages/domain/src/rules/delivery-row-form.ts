import type {
  AgentPlacement,
  AgentRole,
  DeliveryPlacement,
  DeliverySection,
  ItemKind,
  ItemPlacement,
  PrReading,
  YouReason,
} from './delivery-placement.js';

/** The seven columns of a Delivery row, in the order they render. */
export const ROW_COLUMNS = ['kind', 'item', 'where', 'status', 'do', 'by', 'age'] as const;
export type RowColumn = (typeof ROW_COLUMNS)[number];

/** What a cell link points at. Each kind of target is one kind of place on the tab or the host. */
export type LinkTarget =
  | { to: 'plan'; plan: string; slice: string | null }
  | { to: 'plan-pr'; pr: number }
  | { to: 'branch'; branch: string }
  | { to: 'pr'; pr: number }
  | { to: 'compare'; branch: string }
  | { to: 'ci-run'; run: string }
  | { to: 'review'; pr: number }
  | { to: 'slice'; id: string }
  | { to: 'item'; id: string }
  | { to: 'agent'; id: string }
  | { to: 'person'; handle: string }
  | { to: 'question'; id: string }
  | { to: 'log'; id: string }
  | { to: 'action'; action: string; id: string };

/** One cell: a value, never a sentence, and the targets it links to. A cell nobody asked for is `null`. */
export interface Cell {
  value: string;
  links: LinkTarget[];
}

/** One row in the seven columns. DO is `null` outside the You section. */
export type RowCells = Record<RowColumn, Cell | null>;

/** Which row of the design's *Links by Row* table a work item is. */
export type RowShape =
  | 'slice-queued'
  | 'slice-being-built'
  | 'slice-at-a-gate'
  | 'slice-stuck'
  | 'pr-no-plan'
  | 'plan-input'
  | 'plan-testing'
  | 'release'
  | 'branch-loose-end';

/** The names and numbers a row's links point at. Every field is absent where nobody read it. */
export interface ItemRowFacts {
  plan?: string;
  slice?: string;
  branch?: string;
  pr?: number;
  /** The PR of the plan file's idea branch. */
  planPr?: number;
  /** The id of the failed or running CI run, as the host names it. */
  ciRun?: string;
  /** The gate's own PR reading. */
  prReading?: PrReading;
  /** The slice an earlier slice must finish first. */
  waitsOn?: string;
  /** The person the item waits on, as a handle. */
  person?: string;
  /** The last commit of a loose branch, as `<sha7>`. */
  lastCommit?: string;
  /** The id of the question a stopped agent asked. */
  question?: string;
  /** Minutes in this state. */
  ageMinutes?: number;
  /** Merged PR numbers of a plan in Testing. */
  mergedPrs?: number[];
}

/** The names a row's agent cells point at. */
export interface AgentRowFacts {
  /** The id of the question the agent asked, while it waits on a person. */
  question?: string;
  /** What blocks it, as the gate's number: `#3234`. */
  gateRef?: string;
  /** Who started it: `fleetd` or a handle. */
  startedBy?: string;
  ageMinutes?: number;
}

const GATE_MARK = { running: '⟳', failed: '✗', passed: '✓' } as const;

/**
 * Minutes as the AGE column shows them: `5m`, `3h`, `2d`.
 *
 * @param minutes - time in the state; negative values read as zero.
 * @returns the shortest whole unit.
 */
export const ageValue = (minutes: number): string => {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
};

/** What a You reason says in the STATUS column: a short value, not the sentence the reason carries. */
const REASON_STATUS: Record<YouReason, string> = {
  'draft-plan': 'draft',
  'plan-approval': 'approval',
  'spike-approval': 'spike approval',
  'release-approval': 'release approval',
  'test-delivered-plan': 'to test',
  'review-pr': 'review',
  'blocked-marker': 'blocked',
  'fleet-stuck': 'stuck',
  'merge-conflict': 'conflict',
  'agent-died': 'agent died',
  loose: 'loose',
  'ticket-assigned': 'assigned',
};

/** What a You reason offers in the DO column: one verb with `›`. */
const REASON_DO: Record<YouReason, { verb: string; action: string }> = {
  'draft-plan': { verb: 'open', action: 'open-plan' },
  'plan-approval': { verb: 'approve', action: 'approve' },
  'spike-approval': { verb: 'approve spike', action: 'approve-spike' },
  'release-approval': { verb: 'approve release', action: 'release-approve' },
  'test-delivered-plan': { verb: 'test', action: 'deliver' },
  'review-pr': { verb: 'review', action: 'review' },
  'blocked-marker': { verb: 'answer', action: 'continue' },
  'fleet-stuck': { verb: 'unblock', action: 'unblock' },
  'merge-conflict': { verb: 'resolve', action: 'resolve-conflict' },
  'agent-died': { verb: 'restart', action: 'restart' },
  loose: { verb: 'plan', action: 'create-plan' },
  'ticket-assigned': { verb: 'plan', action: 'create-plan' },
};

/** The gate readings of a PR as `CI ⟳ #3234` and `review ✗`; absent where a gate was not read. */
const gateValue = (pr: PrReading | undefined, ciRun: string | undefined): string | null => {
  if (pr === undefined) return null;
  if (pr.ci !== 'unread') return `CI ${GATE_MARK[pr.ci]}${ciRun === undefined ? '' : ` ${ciRun}`}`;
  if (pr.review === 'pending') return 'review ⟳';
  if (pr.review === 'high') return 'review ✗';
  if (pr.review === 'passed') return 'review ✓';
  return null;
};

/**
 * The row shape of a placed work item: which line of the design's *Links by Row*
 * table it is.
 *
 * @param placement - what `placeDelivery` returned for the item.
 * @param facts - the names the item's links point at.
 * @returns the shape, or `null` where the item has none of the table's rows.
 */
export const rowShape = (placement: ItemPlacement, facts: ItemRowFacts): RowShape | null => {
  const kind: ItemKind = placement.kind;
  if (kind === 'ticket') return null;
  if (kind === 'release') return 'release';
  if (kind === 'branch') return 'branch-loose-end';
  if (kind === 'plan') {
    if (placement.section === 'you' && placement.reason === 'test-delivered-plan') return 'plan-testing';
    return placement.section === 'you' ? 'plan-input' : null;
  }
  if (kind === 'pr' && facts.plan === undefined) return 'pr-no-plan';
  if (placement.section === 'you') {
    return ['fleet-stuck', 'blocked-marker', 'agent-died', 'merge-conflict'].includes(placement.reason)
      ? 'slice-stuck' : 'slice-at-a-gate';
  }
  switch (placement.group) {
    case 'queued': return 'slice-queued';
    case 'being-built': return 'slice-being-built';
    case 'at-a-gate': return 'slice-at-a-gate';
  }
};

const link = (value: string, ...links: LinkTarget[]): Cell => ({ value, links });

const planLink = (facts: ItemRowFacts): LinkTarget[] =>
  facts.plan === undefined ? [] : [{ to: 'plan', plan: facts.plan, slice: facts.slice ?? null }];

const itemName = (facts: ItemRowFacts, fallback: string): string =>
  facts.slice !== undefined ? facts.slice : facts.plan ?? fallback;

const branchLinks = (facts: ItemRowFacts, withPr: boolean): LinkTarget[] => [
  ...(facts.branch === undefined ? [] : [{ to: 'branch', branch: facts.branch } as const]),
  ...(withPr && facts.pr !== undefined ? [{ to: 'pr', pr: facts.pr } as const] : []),
];

const whereValue = (facts: ItemRowFacts, withPr: boolean): Cell | null => {
  const links = branchLinks(facts, withPr);
  if (links.length === 0) return null;
  const parts = [
    ...(facts.branch === undefined ? [] : [facts.branch]),
    ...(withPr && facts.pr !== undefined ? [`#${facts.pr}`] : []),
  ];
  return link(parts.join(' · '), ...links);
};

/** BY: the agents acting on the item, as links to their Fleet rows. The first names the cell. */
const byAgents = (agents: readonly string[], person: string | undefined): Cell | null => {
  const [first] = agents;
  if (first !== undefined) return link(first, ...agents.map((id): LinkTarget => ({ to: 'agent', id })));
  if (person !== undefined) return link(person, { to: 'person', handle: person });
  return null;
};

const ageCell = (minutes: number | undefined): Cell | null =>
  minutes === undefined ? null : link(ageValue(minutes));

/**
 * The seven cells of a work-item row, with each cell's link targets per the
 * design's *Links by Row* table.
 *
 * A cell holds a value and never a sentence. A fact nobody read yields a `null`
 * cell, never a default word. DO is non-null under You only.
 *
 * @param placement - what `placeDelivery` returned for the item.
 * @param facts - the names and numbers the links point at.
 * @returns the cells, or `null` where the item has no row shape.
 */
export const itemRowCells = (placement: ItemPlacement, facts: ItemRowFacts): RowCells | null => {
  const shape = rowShape(placement, facts);
  if (shape === null) return null;
  const you = placement.section === 'you';
  const reasonStatus = placement.section === 'you' ? REASON_STATUS[placement.reason] : null;
  const gate = gateValue(facts.prReading, facts.ciRun);
  const gateLinks: LinkTarget[] = [
    ...(facts.ciRun !== undefined && facts.prReading?.ci !== 'unread' && facts.prReading !== undefined
      ? [{ to: 'ci-run', run: facts.ciRun } as const] : []),
    ...(facts.pr !== undefined && facts.prReading?.review !== undefined && facts.prReading.review !== 'unread'
      && facts.prReading.review !== 'none' ? [{ to: 'review', pr: facts.pr } as const] : []),
  ];
  const statusOf = (): Cell | null => {
    switch (shape) {
      case 'slice-queued':
        return facts.waitsOn === undefined ? null : link(`waits on ${facts.waitsOn}`, { to: 'slice', id: facts.waitsOn });
      case 'slice-being-built':
        return null;
      case 'slice-at-a-gate':
      case 'pr-no-plan':
      case 'release':
        return gate === null ? null : link(gate, ...gateLinks);
      case 'slice-stuck':
        if (facts.question !== undefined) return link('question', { to: 'question', id: facts.question });
        return gate === null ? null : link(gate, ...gateLinks);
      case 'plan-input':
        return null;
      case 'plan-testing':
        return facts.mergedPrs === undefined ? null
          : link(`${facts.mergedPrs.length} merged`, ...facts.mergedPrs.map((pr): LinkTarget => ({ to: 'pr', pr })));
      case 'branch-loose-end':
        return facts.lastCommit === undefined ? null : link(facts.lastCommit);
    }
  };
  const status = reasonStatus !== null && statusOf() === null ? link(reasonStatus) : (() => {
    const s = statusOf();
    return s !== null && reasonStatus !== null ? { ...s, value: `${reasonStatus} · ${s.value}` } : s;
  })();
  const itemCell = ((): Cell => {
    switch (shape) {
      case 'pr-no-plan':
        return link(`#${facts.pr ?? placement.id}`, ...(facts.pr === undefined ? [] : [{ to: 'pr', pr: facts.pr } as const]));
      case 'release':
        return link(`#${facts.pr ?? placement.id}`, ...(facts.pr === undefined ? [] : [{ to: 'pr', pr: facts.pr } as const]));
      case 'branch-loose-end':
        return link(facts.branch ?? placement.id, ...(facts.branch === undefined ? [] : [{ to: 'branch', branch: facts.branch } as const]));
      default:
        return link(itemName(facts, placement.id), ...planLink(facts));
    }
  })();
  const where = ((): Cell | null => {
    switch (shape) {
      case 'slice-queued': return null;
      case 'slice-being-built': return whereValue(facts, false);
      case 'slice-at-a-gate':
      case 'slice-stuck': return whereValue(facts, true);
      case 'pr-no-plan': return whereValue(facts, false);
      case 'plan-input':
        return facts.planPr === undefined ? null : link(`#${facts.planPr}`, { to: 'plan-pr', pr: facts.planPr });
      case 'plan-testing': return null;
      case 'release':
        return facts.branch === undefined ? null : link('branch', { to: 'branch', branch: facts.branch });
      case 'branch-loose-end':
        return facts.branch === undefined ? null : link('compare', { to: 'compare', branch: facts.branch });
    }
  })();
  const byAllowed = shape !== 'slice-queued' && shape !== 'branch-loose-end';
  const by = byAllowed ? byAgents(placement.agents, shape === 'plan-input' || shape === 'plan-testing' ? facts.person : undefined) : null;
  const doCell = you && placement.section === 'you'
    ? link(`${REASON_DO[placement.reason].verb} ›`, { to: 'action', action: REASON_DO[placement.reason].action, id: placement.id })
    : null;
  return {
    kind: link(shape === 'pr-no-plan' ? 'PR' : placement.kind),
    item: itemCell,
    where,
    status,
    do: doCell,
    by,
    age: ageCell(facts.ageMinutes),
  };
};

/**
 * The seven cells of an agent row: its role, the agent's panel, the work item
 * it acts on, its state, who started it and for how long.
 *
 * @param placement - what `placeDelivery` returned for the agent.
 * @param facts - the names the links point at.
 * @returns the cells; DO is always `null`, because an agent row asks nothing of a person.
 */
export const agentRowCells = (placement: AgentPlacement, facts: AgentRowFacts): RowCells => {
  const state = ((): Cell | null => {
    if (placement.blockedOn !== null) {
      const gate = placement.blockedOn === 'ci' ? 'CI' : placement.blockedOn === 'person' ? 'your answer' : placement.blockedOn;
      const value = facts.gateRef === undefined ? gate : `${gate} ${facts.gateRef}`;
      return facts.question !== undefined
        ? link(value, { to: 'question', id: facts.question })
        : link(value, { to: 'log', id: placement.id });
    }
    return link(placement.group, { to: 'log', id: placement.id });
  })();
  return {
    kind: link(placement.role satisfies AgentRole),
    item: link(placement.id, { to: 'agent', id: placement.id }),
    where: placement.actsOn !== null && placement.linked
      ? link(placement.actsOn, { to: 'item', id: placement.actsOn }) : null,
    status: state,
    do: null,
    by: facts.startedBy === undefined ? null
      : link(facts.startedBy, ...(facts.startedBy === 'fleetd' ? [] : [{ to: 'person', handle: facts.startedBy } as const])),
    age: ageCell(facts.ageMinutes),
  };
};

/** The switches that decide what the fleet starts by itself. */
export interface DeliverySwitches {
  autoDispatch: boolean;
  autoReview: boolean;
  autoVerify: boolean;
  autoDesign: boolean;
}

const SWITCH_WORDS = {
  autoDispatch: { name: 'auto-dispatch', action: 'start' },
  autoReview: { name: 'auto-review', action: 'review' },
  autoVerify: { name: 'auto-verify', action: 'verify' },
  autoDesign: { name: 'auto-design', action: 'design' },
} as const;

/** One switch that holds a group back. */
export interface HeldBy {
  switch: keyof DeliverySwitches;
  /** `auto-dispatch off`'s first word: the switch as the header names it. */
  name: string;
  /** The verb of the link that acts on it. */
  action: string;
}

/** The parts of a group header: its label, its count and what holds it back. */
export interface GroupHeader {
  group: string;
  count: number;
  held: HeldBy[];
  /** `Queued (3) · auto-dispatch off · start ›`: the parts joined; just `Queued (3)` where nothing holds the group. */
  text: string;
}

/**
 * Which switches an off reading holds a group back by, given the reasons its
 * items sit there.
 *
 * Queued waits on auto-dispatch. Input to the fleet holds draft plans that
 * auto-design would take. Review a result holds PRs that auto-review would take
 * and delivered plans that auto-verify would take. A group with no item holds
 * nothing.
 */
const holdersOf = (
  section: DeliverySection,
  group: string,
  reasons: readonly (YouReason | null)[],
): (keyof DeliverySwitches)[] => {
  if (reasons.length === 0) return [];
  if (section === 'work-items' && group === 'queued') return ['autoDispatch'];
  if (section !== 'you') return [];
  if (group === 'input-to-the-fleet' && reasons.includes('draft-plan')) return ['autoDesign'];
  if (group === 'review-a-result') {
    return [
      ...(reasons.includes('review-pr') ? ['autoReview' as const] : []),
      ...(reasons.includes('test-delivered-plan') ? ['autoVerify' as const] : []),
    ];
  }
  return [];
};

/**
 * The header of one group, with the switches that hold it back named.
 *
 * @param label - the group's label.
 * @param section - the section the group sits in.
 * @param group - the group's key.
 * @param items - the placements the group holds.
 * @param switches - the four switch readings.
 * @returns the header's parts and the joined text.
 */
export const groupHeader = (
  label: string,
  section: DeliverySection,
  group: string,
  items: readonly ItemPlacement[],
  switches: DeliverySwitches,
): GroupHeader => {
  const reasons = items.map((i) => (i.section === 'you' ? i.reason : null));
  const held = holdersOf(section, group, reasons)
    .filter((s) => !switches[s])
    .map((s): HeldBy => ({ switch: s, ...SWITCH_WORDS[s] }));
  const text = [`${label} (${items.length})`, ...held.map((h) => `${h.name} off · ${h.action} ›`)].join(' · ');
  return { group, count: items.length, held, text };
};

/** Every row's cells, keyed by subject id, for the tab to render. */
export interface DeliveryRowForms {
  items: Map<string, RowCells>;
  agents: Map<string, RowCells>;
}

/**
 * The cells of every placed subject.
 *
 * @param placement - what `placeDelivery` returned.
 * @param itemFacts - the names each item's links point at, by item id.
 * @param agentFacts - the names each agent's links point at, by agent id.
 * @returns the rows by id; an item with no row shape has none.
 */
export const deliveryRowForms = (
  placement: DeliveryPlacement,
  itemFacts: (id: string) => ItemRowFacts,
  agentFacts: (id: string) => AgentRowFacts,
): DeliveryRowForms => {
  const items = new Map<string, RowCells>();
  for (const p of placement.items) {
    const cells = itemRowCells(p, itemFacts(p.id));
    if (cells !== null) items.set(p.id, cells);
  }
  const agents = new Map<string, RowCells>();
  for (const p of placement.agents) agents.set(p.id, agentRowCells(p, agentFacts(p.id)));
  return { items, agents };
};
