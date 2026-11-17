import type {
  AgentPlacement,
  AgentRole,
  DeliveryPlacement,
  DeliverySection,
  ItemKind,
  ItemPlacement,
  PrReading,
  YouReason,
  DeliveryGate,
} from './delivery-placement.js';
import { FIXER_ATTEMPTS_BUDGET } from './fixer-attempts.js';

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
  | { to: 'url'; url: string }
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

/** The PR an agent acts on, as far as the payload reads it. */
export interface AgentPrFacts {
  ci: PrReading['ci'];
  review: PrReading['review'];
  /** The PR's checks page; absent or `''` where the host has none. */
  checksUrl?: string;
  /** The PR's page on the host; absent or `''` where unknown. */
  url?: string;
}

/** The names and readings an agent row's cells are built from. Every field is absent where nobody read it. */
export interface AgentRowFacts {
  /** The agent's name; the placement id where absent. */
  name?: string;
  /** The id of the question the agent asked, while it waits on a person. */
  question?: string;
  /** The Agent cell's tooltip for a desk no manifest names. */
  unnamedDesk?: string;
  /** The name of the work item the agent acts on. */
  itemName?: string;
  /** The branch the agent works on. */
  branch?: string;
  /** Commits the local branch carries beyond its base. */
  commits?: number;
  /** The subject of the branch's last commit. */
  lastCommit?: string;
  /** The reviewer's head, as `<sha7>`. */
  reviewHead?: string;
  /** What a fixer answers: a red CI run or a HIGH review finding. */
  fixerFinding?: 'ci' | 'high';
  /** The number of the fixer's current attempt, from 1. */
  fixerAttempt?: number;
  /** The PR the agent acts on. */
  pr?: AgentPrFacts;
  /** The connector's window: `exhausted` stops the agent, `free` and `unknown` do not. */
  rateLimit?: 'exhausted' | 'free' | 'unknown';
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

/** The six columns of a Fleet agent row, in the order they render. */
export const AGENT_COLUMNS = ['agent', 'role', 'actingOn', 'doing', 'tokens', 'timeLeft'] as const;
export type AgentColumn = (typeof AGENT_COLUMNS)[number];

/** The header word of each Fleet column; `doing` reads `Waits on` in the Blocked group. */
export const AGENT_COLUMN_LABELS: Record<AgentColumn, string> = {
  agent: 'Agent',
  role: 'Role',
  actingOn: 'Acting on',
  doing: 'Doing now',
  tokens: 'Tokens',
  timeLeft: 'Time left',
};

/** One Fleet agent row. A cell nobody read is `null`. */
export interface AgentRowCells extends Record<AgentColumn, Cell | null> {
  /** The branch shown beneath the Acting on cell. */
  branch: Cell | null;
  /** The last commit subject shown after a loop agent's Doing now value. */
  doingDetail: string | null;
  /** The header word of the `doing` column for this row. */
  doingLabel: 'Doing now' | 'Waits on';
  /** The Agent cell's tooltip; `null` where the agent has nothing to add. */
  agentTitle: string | null;
}

/** The order a blocked agent's gates are named in, first true gate wins. */
export const WAITS_ON_ORDER = ['person', 'rate-limit', 'ci', 'review', 'machine'] as const satisfies readonly DeliveryGate[];

const GATE_WORD: Record<DeliveryGate, string> = {
  person: 'person',
  'rate-limit': 'rate limit',
  ci: 'CI',
  review: 'review',
  machine: 'machine',
};

const hasUrl = (url: string | undefined): url is string => url !== undefined && url !== '';

/**
 * The gate a blocked agent waits on, by the first of {@link WAITS_ON_ORDER}
 * whose own reading holds.
 *
 * `person` holds while the placement says the agent waits on one. `rate-limit`
 * holds on an `exhausted` window only; `unknown` is not exhausted and is not
 * free. `ci` holds while the agent's PR reads `running`, and `review` while its
 * CI passed and its review reads `pending`. A PR with no CI reading gives no
 * gate. `machine` holds where the placement names it.
 *
 * @param placement - what `placeDelivery` returned for the agent.
 * @param facts - the readings of the agent's PR and the connector.
 * @returns the gate and the cell value and links that name it, or `null` where no gate has a reading.
 */
export const agentWaitsOn = (placement: AgentPlacement, facts: AgentRowFacts): { gate: DeliveryGate; cell: Cell } | null => {
  if (placement.group !== 'blocked') return null;
  const holds = (gate: DeliveryGate): boolean => {
    switch (gate) {
      case 'person': return placement.blockedOn === 'person';
      case 'rate-limit': return facts.rateLimit === 'exhausted';
      case 'ci': return facts.pr?.ci === 'running';
      case 'review': return facts.pr?.ci === 'passed' && facts.pr.review === 'pending';
      case 'machine': return placement.blockedOn === 'machine';
    }
  };
  const gate = WAITS_ON_ORDER.find(holds);
  if (gate === undefined) return null;
  const links = ((): LinkTarget[] => {
    switch (gate) {
      case 'person':
        return facts.question !== undefined ? [{ to: 'question', id: facts.question }] : [{ to: 'log', id: placement.id }];
      case 'ci': return hasUrl(facts.pr?.checksUrl) ? [{ to: 'url', url: facts.pr.checksUrl }] : [];
      case 'review': return hasUrl(facts.pr?.url) ? [{ to: 'url', url: facts.pr.url }] : [];
      default: return [];
    }
  })();
  return { gate, cell: link(GATE_WORD[gate], ...links) };
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What an agent does now, as a value; `null` for an agent that holds no work. */
const doingValue = (placement: AgentPlacement, facts: AgentRowFacts): string | null => {
  if (placement.actsOn === null) return null;
  switch (placement.role) {
    case 'loop':
      return facts.commits !== undefined && facts.commits > 0
        ? `writing code · ${plural(facts.commits, 'commit')}` : 'writing code';
    case 'reviewer':
      return facts.reviewHead === undefined ? 'reviewing' : `reviewing head ${facts.reviewHead}`;
    case 'fixer': {
      const what = facts.fixerFinding === 'ci' ? 'fixing CI ✗' : facts.fixerFinding === 'high' ? 'fixing review ✗' : 'fixing';
      return facts.fixerAttempt === undefined ? what : `${what} · attempt ${facts.fixerAttempt} of ${FIXER_ATTEMPTS_BUDGET}`;
    }
    case 'design': return 'designing';
    case 'verify': return 'verifying';
    case 'idea': return 'writing the idea';
    case 'brief': return 'writing the brief';
    case 'approver': return 'approving';
  }
};

/**
 * The six cells of a Fleet agent row: the agent, its role, the item it acts on,
 * what it does now or waits on, and the Tokens and Time left columns.
 *
 * Doing now is the activity the role names. A blocked agent's Doing now cell
 * holds the gate it waits on instead ({@link agentWaitsOn}). Tokens and Time
 * left are columns of the form and stay `null` until a reading fills them.
 *
 * @param placement - what `placeDelivery` returned for the agent.
 * @param facts - the names and readings the cells are built from.
 * @returns the cells.
 */
export const agentRowCells = (placement: AgentPlacement, facts: AgentRowFacts): AgentRowCells => {
  const blocked = placement.group === 'blocked';
  const on = placement.linked ? placement.actsOn : null;
  const doing = blocked ? agentWaitsOn(placement, facts)?.cell ?? null : ((): Cell | null => {
    const value = doingValue(placement, facts);
    return value === null ? null : link(value, { to: 'log', id: placement.id });
  })();
  return {
    agent: link(facts.name ?? placement.id, { to: 'agent', id: placement.id }),
    role: link(placement.role satisfies AgentRole),
    actingOn: on !== null ? link(facts.itemName ?? on, { to: 'item', id: on }) : null,
    branch: on !== null && facts.branch !== undefined ? link(facts.branch, { to: 'branch', branch: facts.branch }) : null,
    doing,
    doingDetail: !blocked && facts.lastCommit !== undefined && placement.role === 'loop' ? facts.lastCommit : null,
    doingLabel: blocked ? 'Waits on' : 'Doing now',
    tokens: null,
    timeLeft: null,
    agentTitle: facts.unnamedDesk ?? null,
  };
};

/** The one line Free collapses into. */
export interface FreeLine {
  count: number;
  names: string[];
  /** `Free · 3 agents ready: a, b, c`; the component adds the `show` control. */
  text: string;
}

/**
 * The Free group as one line.
 *
 * @param names - the names of the agents placed in Free.
 * @returns the line, or `null` for no agent: zero agents render no Free line.
 */
export const freeLine = (names: readonly string[]): FreeLine | null =>
  names.length === 0 ? null : { count: names.length, names: [...names], text: `Free · ${plural(names.length, 'agent')} ready: ${names.join(', ')}` };

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
  agents: Map<string, AgentRowCells>;
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
  const agents = new Map<string, AgentRowCells>();
  for (const p of placement.agents) agents.set(p.id, agentRowCells(p, agentFacts(p.id)));
  return { items, agents };
};
