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
import type { TokenCountsRecord } from '../entities/slice-spend.js';
import { tokenCountValue } from './agent-run-tokens.js';
import { timeLeft, timeLeftValue } from './agent-time-left.js';
import { FIXER_ATTEMPTS_BUDGET } from './fixer-attempts.js';
import { TICKETS_ANCHOR } from './tickets-section.js';

/** The seven columns of a Delivery row, in the order they render. */
export const ROW_COLUMNS = ['kind', 'item', 'where', 'status', 'by', 'age', 'do'] as const;
export type RowColumn = (typeof ROW_COLUMNS)[number];

/** The four columns of a You row, in the order they render: what to do, on what, what waits on it, and the `⋯`. */
export const YOU_COLUMNS = ['verb', 'object', 'consequence', 'menu'] as const;
export type YouColumn = (typeof YOU_COLUMNS)[number];

/** The header of each You column. */
export const YOU_COLUMN_LABELS: Record<YouColumn, string> = { verb: 'Do', object: 'Item', consequence: 'Waits', menu: 'Actions' };

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
  | { to: 'checks'; pr: number }
  | { to: 'slice'; id: string }
  | { to: 'item'; id: string }
  | { to: 'agent'; id: string }
  | { to: 'person'; handle: string }
  | { to: 'question'; id: string }
  | { to: 'log'; id: string }
  | { to: 'action'; action: string; id: string }
  /** The `⋯` menu of the row of item `id`: the link opens it and runs nothing. */
  | { to: 'menu'; id: string };

/** One cell: a value, never a sentence, and the targets it links to. A cell nobody asked for is `null`. */
export interface Cell {
  value: string;
  links: LinkTarget[];
  /** Marks that each carry their own link, joined by ` · ` into `value`. Absent where the cell has one value. */
  parts?: CellPart[];
  /** The agent a By cell names: its role (the chip) and, for a fixer, its attempt text such as `1/2`. Absent on every other cell. */
  agent?: { role: AgentRole; attempt: string | null };
}

/** One mark of a cell, with the single place it links to; `null` where it links nowhere. */
export interface CellPart {
  value: string;
  link: LinkTarget | null;
  /** The reading behind a gate mark. Absent on a part that is no gate mark, such as the PR state or the unpushed count. */
  outcome?: GateOutcome;
}

/** What a gate read as: `none` is a review nobody asked for, which differs from a gate nobody read (no part). */
export type GateOutcome = 'pass' | 'pending' | 'fail' | 'none';

/** A gate mark of `gatesCell`: a part whose `outcome` is always read. */
export interface GatePart extends CellPart {
  outcome: GateOutcome;
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
  /** The slice an earlier slice must finish first; `''` where the item waits and the server names no slice. */
  waitsOn?: string;
  /** The item's brief must be written before anyone can start it, as `WorkItemReading.needsBrief` reads. Set only where true. */
  needsBrief?: boolean;
  /** The person the item waits on, as a handle. */
  person?: string;
  /** The display name of `person`, resolved through `People`; absent where the directory declares none. */
  personName?: string;
  /** A plan's phase, where it is `draft` or `design`: another person's plan waits on them. */
  phase?: 'draft' | 'design';
  /** The approval the lifecycle needs from `person`. */
  approvalOwed?: 'plan' | 'spike' | 'release';
  /** Commits the local branch holds that the remote does not; absent where the pulse read none, `0` is never set. */
  unpushed?: number;
  /** The last commit of a loose branch, as `<sha7>`. */
  lastCommit?: string;
  /** The id of the question a stopped agent asked. */
  question?: string;
  /** Minutes in this state. */
  ageMinutes?: number;
  /** Interrogation rounds a Draft plan records; absent where it records none. */
  rounds?: number;
  /** Merged PR numbers of a plan in Testing. */
  mergedPrs?: number[];
  /** The agents acting on the item, in `placement.agents` order; absent where none were read. */
  agents?: ItemAgentFacts[];
  /**
   * A claim that holds no work: the branch carries only its claim commit. `elsewhere` is `true` where this machine
   * holds no worktree for the claim. Absent where the branch carries work or nobody read it.
   */
  claim?: { elsewhere: boolean };
}

/** One agent acting on an item, as its By cell names it. */
export interface ItemAgentFacts {
  id: string;
  /** From the agent's reading, never parsed from `id`. */
  role: AgentRole;
  /** The text of the agent's Agent cell on its Fleet row. */
  name: string;
  /** A fixer's current attempt on the finding it answers, from 1; absent where none is read. */
  attempt?: number;
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
  /** The desk the agent's worker runs in, shown in Acting on while the agent acts on no item. */
  desk?: string;
  /** Minutes since the agent's transcript last changed. */
  idleMinutes?: number;
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
  /** What a fixer answers: a red CI run, a HIGH review finding, or a merge conflict with the base. */
  fixerFinding?: 'ci' | 'high' | 'conflict';
  /** The number of the fixer's current attempt, from 1. */
  fixerAttempt?: number;
  /** The PR the agent acts on. */
  pr?: AgentPrFacts;
  /** The connector's window: `exhausted` stops the agent, `free` and `unknown` do not. */
  rateLimit?: 'exhausted' | 'free' | 'unknown';
  /** Whether the agent's process runs now; a run in progress has no token reading. */
  running?: boolean;
  /** The context size of the agent's run in progress, in tokens; absent where nobody read it. */
  contextTokens?: number;
  /** The tokens the agent's run in progress has spent so far; absent where nobody read it. */
  contextSpend?: number;
  /** The pace of the agent's desk: `fast` while it writes or holds a lock, `slow` otherwise; absent where no desk was read. */
  pace?: AgentPace;
  /** The four counters of the agent's last finished run; `null` or absent where none is read. */
  lastRun?: TokenCountsRecord | null;
  /** Epoch milliseconds of the agent's start; `null` or absent where none is known. */
  startedAt?: number | null;
  /** The bound that applies to the agent's role, in seconds; `null` or absent where it has none. */
  boundSeconds?: number | null;
  /** Epoch milliseconds the Time left cell is measured at. */
  now?: number;
}

export const GATE_MARK = { running: '⟳', failed: '✗', passed: '✓' } as const;

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
  'person-comment': 'comment',
  'agent-died': 'agent died',
  loose: 'loose',
};

/** The tone of a You row's verb: red where delivery waits, amber where the fleet waits on input, grey for clean-up. */
export type VerbTone = 'red' | 'amber' | 'grey';

/** The counts a You row's consequence reads. */
export interface ConsequenceFacts {
  /** How many slices the item's plan holds; `undefined` where nobody counted them. */
  slices?: number;
}

/** What a You reason offers: the verb its row leads with, the action the Do link names, the verb's tone, and what waits. */
export interface ReasonDo {
  verb: string;
  action: string;
  tone: VerbTone;
  /** The consequence phrase without the age; `null` where the reason has none. */
  consequence: (facts: ConsequenceFacts) => string | null;
}

const slicesWait = ({ slices }: ConsequenceFacts): string =>
  slices === undefined ? 'the slices wait' : slices === 1 ? '1 slice waits' : `${slices} slices wait`;
const fixed = (text: string) => (): string => text;

/**
 * The verb, action, tone and consequence of every You reason. `release-approval` reaches no row,
 * because `placeDelivery` sends release items to no section, so it has no consequence.
 */
export const REASON_DO: Record<YouReason, ReasonDo> = {
  'draft-plan': { verb: 'Interrogate', action: 'interrogate', tone: 'amber', consequence: slicesWait },
  'plan-approval': { verb: 'Approve', action: 'approve', tone: 'red', consequence: slicesWait },
  'spike-approval': { verb: 'Approve spike', action: 'approve-spike', tone: 'red', consequence: fixed('the spike waits') },
  'release-approval': { verb: 'Approve release', action: 'release-approve', tone: 'red', consequence: () => null },
  'test-delivered-plan': { verb: 'Test', action: 'deliver', tone: 'red', consequence: fixed('the release waits') },
  'review-pr': { verb: 'Review', action: 'review', tone: 'red', consequence: fixed('the merge waits') },
  'blocked-marker': { verb: 'Answer', action: 'continue', tone: 'red', consequence: fixed('the agent waits') },
  'fleet-stuck': { verb: 'Unblock', action: 'unblock', tone: 'red', consequence: fixed('the fleet waits') },
  'merge-conflict': { verb: 'Resolve', action: 'resolve-conflict', tone: 'red', consequence: fixed('the merge waits') },
  'person-comment': { verb: 'Answer', action: 'answer-comment', tone: 'red', consequence: fixed('the merge waits') },
  'agent-died': { verb: 'Restart', action: 'restart', tone: 'red', consequence: fixed('the slice stopped') },
  loose: { verb: 'Release or delete', action: 'release-or-delete', tone: 'grey', consequence: () => null },
};

/**
 * The word the Kind cell of a You row shows for an item kind: `PR` for a PR, the kind itself otherwise.
 *
 * @param kind - the placed item's kind.
 */
export const youKindWord = (kind: ItemKind): string => (kind === 'pr' ? 'PR' : kind);

/** The verb a You row leads with, which the DO column and the to-do list's lines also show. */
export const reasonVerb = (reason: YouReason): string => REASON_DO[reason].verb;

/** The gate readings of a PR as `CI ⟳ #3234` and `review ✗`; absent where a gate was not read. */
const gateValue = (pr: PrReading | undefined, ciRun: string | undefined): string | null => {
  if (pr === undefined) return null;
  if (pr.ci !== 'unread') return `CI ${GATE_MARK[pr.ci]}${ciRun === undefined ? '' : ` ${ciRun}`}`;
  if (pr.review === 'pending') return 'review ⟳';
  if (pr.review === 'high') return 'review ✗';
  if (pr.review === 'passed') return 'review ✓';
  return null;
};

/** The two gate marks of a PR: `CI ✗` and `review –`. A gate nobody read is `null`; a review nobody asked reads `–`. */
export interface GateMarks {
  ci: string | null;
  review: string | null;
}

/**
 * The CI mark and the review mark of a PR, each on its own.
 *
 * @param pr - the PR's gate readings.
 * @returns one mark per gate; `unread` yields `null`, and `review: 'none'` yields `–`.
 */
export const gateMarks = (pr: PrReading): GateMarks => {
  const review = ((): string | null => {
    switch (pr.review) {
      case 'pending': return `review ${GATE_MARK.running}`;
      case 'high': return `review ${GATE_MARK.failed}`;
      case 'passed': return `review ${GATE_MARK.passed}`;
      case 'none': return 'review –';
      case 'unread': return null;
    }
  })();
  return { ci: pr.ci === 'unread' ? null : `CI ${GATE_MARK[pr.ci]}`, review };
};

const CI_OUTCOME = { running: 'pending', failed: 'fail', passed: 'pass' } as const;
const REVIEW_OUTCOME = { pending: 'pending', high: 'fail', passed: 'pass', none: 'none' } as const;

/**
 * The Gates cell of a work item at a gate: one mark per gate, each linked to its own page.
 *
 * @param pr - the PR's gate readings, or `undefined` where none was read.
 * @param number - the PR number the links point at, or `undefined` where unknown.
 * @returns the cell, or `null` where neither gate was read. Each part carries an `outcome` read from `pr`, never from the mark's glyph.
 */
export const gatesCell = (pr: PrReading | undefined, number: number | undefined): (Cell & { parts: GatePart[] }) | null => {
  if (pr === undefined) return null;
  const marks = gateMarks(pr);
  const parts: GatePart[] = [
    ...(marks.ci === null || pr.ci === 'unread' ? [] : [{
      value: marks.ci,
      link: number === undefined ? null : { to: 'checks', pr: number } as const,
      outcome: CI_OUTCOME[pr.ci],
    }]),
    ...(marks.review === null || pr.review === 'unread' ? [] : [{
      value: marks.review,
      link: number === undefined || pr.review === 'none' ? null : { to: 'review', pr: number } as const,
      outcome: REVIEW_OUTCOME[pr.review],
    }]),
  ];
  if (parts.length === 0) return null;
  return {
    value: parts.map((p) => p.value).join(' · '),
    links: parts.flatMap((p) => (p.link === null ? [] : [p.link])),
    parts,
  };
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

/**
 * The By cell of a Work items row: the first agent's role, name and attempt,
 * linked to every agent's Fleet row.
 *
 * A row with no agent keeps the plain `by` cell, so a person's link gets no chip.
 * An agent whose facts were not read keeps the plain cell too: the id, no chip.
 *
 * @param plain - the cell `itemRowCells` built.
 * @param agents - the ids acting on the item, in placement order.
 * @param facts - the item's row facts.
 * @returns the cell, with `agent` set where the first agent's facts were read.
 */
export const workByCell = (plain: Cell | null, agents: readonly string[], facts: ItemRowFacts): Cell | null => {
  const [first] = agents;
  const named = first === undefined ? undefined : facts.agents?.find((a) => a.id === first);
  if (plain === null || named === undefined) return plain;
  return {
    ...plain,
    value: named.name,
    agent: { role: named.role, attempt: named.attempt === undefined ? null : `${named.attempt}/${FIXER_ATTEMPTS_BUDGET}` },
  };
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
    by,
    age: ageCell(facts.ageMinutes),
    do: doCell,
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

/** The pace a running spinner turns at: `fast` for local writes, `slow` for a wait on the host. */
export type AgentPace = 'fast' | 'slow';

/**
 * The pace of a Fleet agent's spinner: `facts.pace` for an agent in the `working`
 * group, `slow` where no desk pace was read, and `null` for a blocked or free agent.
 *
 * @param placement - what `placeDelivery` returned for the agent.
 * @param facts - the agent's readings; only `pace` is read.
 * @returns the pace, or `null` where the agent shows no spinner.
 */
export const agentPace = (placement: Pick<AgentPlacement, 'group'>, facts: Pick<AgentRowFacts, 'pace'>): AgentPace | null =>
  placement.group === 'working' ? facts.pace ?? 'slow' : null;

/**
 * The pace of a spinner that stands for several agents: `fast` where any of them
 * is `fast`, `slow` where any other is running, `null` where none is.
 *
 * @param paces - each agent's {@link agentPace}.
 * @returns the fastest pace, or `null`.
 */
export const fleetPace = (paces: readonly (AgentPace | null | undefined)[]): AgentPace | null =>
  paces.includes('fast') ? 'fast' : paces.includes('slow') ? 'slow' : null;

/** One Fleet agent row. A cell nobody read is `null`. */
export interface AgentRowCells extends Record<AgentColumn, Cell | null> {
  /** The spinner that leads the Doing now cell: its pace, or `null` where the agent does not work. */
  doingPace: AgentPace | null;
  /** The branch the agent works on, shown beneath the Acting on cell; `null` where none is read. */
  branch: Cell | null;
  /** The last commit subject shown after a loop agent's Doing now value. */
  doingDetail: string | null;
  /** The header word of the `doing` column for this row. */
  doingLabel: 'Doing now' | 'Waits on';
  /** The Agent cell's tooltip; `null` where the agent has nothing to add. */
  agentTitle: string | null;
  /** `idle 4h`: the time since the agent's transcript last changed; `null` where nobody read it. */
  idle: string | null;
  /** The Tokens cell's tooltip: the three counters the cell does not show; `null` with the cell. */
  tokensTitle: string | null;
  /** The Time left bar: the share left and whether it is red; `null` where the cell is `null`. */
  timeLeftBar: { fraction: number; red: boolean } | null;
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
  if (placement.actsOn === null) return placement.role === 'loop' && facts.running === true ? 'waiting for a slice' : null;
  switch (placement.role) {
    case 'loop':
      return facts.commits !== undefined && facts.commits > 0
        ? `writing code · ${plural(facts.commits, 'commit')}` : 'writing code';
    case 'reviewer':
      return facts.reviewHead === undefined ? 'reviewing' : `reviewing head ${facts.reviewHead}`;
    case 'fixer': {
      const what = facts.fixerFinding === 'ci' ? 'fixing CI ✗'
        : facts.fixerFinding === 'high' ? 'fixing review ✗'
        : facts.fixerFinding === 'conflict' ? 'fixing conflict ✗' : 'fixing';
      return facts.fixerAttempt === undefined ? what : `${what} · attempt ${facts.fixerAttempt} of ${FIXER_ATTEMPTS_BUDGET}`;
    }
    case 'design': return 'designing';
    case 'verify': return 'verifying';
    case 'idea': return 'writing the idea';
    case 'brief': return 'writing the brief';
    case 'approver': return 'approving';
  }
};

const lastFinishedRun = (facts: AgentRowFacts): TokenCountsRecord | null =>
  facts.running === true ? null : facts.lastRun ?? null;

const tokenNumber = (v: number): string => v.toLocaleString('en-US');

const runningContext = (facts: AgentRowFacts): number | null =>
  facts.running === true && facts.contextTokens !== undefined ? facts.contextTokens : null;

const tokensCell = (facts: AgentRowFacts): Cell | null => {
  const context = runningContext(facts);
  if (context !== null) return link(`${tokenCountValue(context)} ctx`);
  const run = lastFinishedRun(facts);
  return run === null ? null : link(`${tokenCountValue(run.outputTokens)} out`);
};

const tokensTitle = (facts: AgentRowFacts): string | null => {
  const context = runningContext(facts);
  if (context !== null) {
    const spend = facts.contextSpend === undefined ? 'not read' : tokenNumber(facts.contextSpend);
    return `Context of the run in progress: ${tokenNumber(context)} tokens. Spent so far: ${spend}`;
  }
  const run = lastFinishedRun(facts);
  if (run === null) return null;
  const n = tokenNumber;
  return `Output tokens of the last finished run: ${n(run.outputTokens)}. Input ${n(run.inputTokens)} · cache creation ${n(run.cacheCreationTokens)} · cache read ${n(run.cacheReadTokens)}`;
};

/**
 * The six cells of a Fleet agent row: the agent, its role, the item it acts on,
 * what it does now or waits on, and the Tokens and Time left columns.
 *
 * Doing now is the activity the role names. A running loop agent that acts on
 * no item reads `waiting for a slice`. A blocked agent's Doing now cell holds
 * the gate it waits on instead ({@link agentWaitsOn}). Acting on names the
 * agent's desk while it acts on no item.
 *
 * A working agent's Doing now cell leads with a spinner at `doingPace`
 * ({@link agentPace}); the cell keeps its slot while the pace is `null`.
 *
 * Tokens shows a running agent's context size (`143k ctx`) from
 * `facts.contextTokens`, with `facts.contextSpend` in `tokensTitle`; a running
 * agent with no `contextTokens` reads `null`. Otherwise it shows the output
 * tokens of the agent's last finished run, with input, cache creation and cache
 * read in `tokensTitle`, and `null` for a run nobody read. Time left is `bound − (now − start)` from
 * `facts.startedAt`, `facts.boundSeconds` and `facts.now`; it and its bar are
 * `null` where any of the three is absent.
 *
 * @param placement - what `placeDelivery` returned for the agent.
 * @param facts - the names and readings the cells are built from.
 * @returns the cells.
 */
export const agentRowCells = (placement: AgentPlacement, facts: AgentRowFacts): AgentRowCells => {
  const blocked = placement.group === 'blocked';
  const on = placement.linked ? placement.actsOn : null;
  const left = facts.now === undefined ? null : timeLeft(facts.startedAt, facts.boundSeconds, facts.now);
  const doing = blocked ? agentWaitsOn(placement, facts)?.cell ?? null : ((): Cell | null => {
    const value = doingValue(placement, facts);
    return value === null ? null : link(value, { to: 'log', id: placement.id });
  })();
  return {
    agent: link(facts.name ?? placement.id, { to: 'agent', id: placement.id }),
    role: link(placement.role satisfies AgentRole),
    actingOn: on !== null
      ? link(facts.itemName ?? on, { to: 'item', id: on })
      : placement.actsOn === null && facts.desk !== undefined ? link(facts.desk) : null,
    branch: facts.branch !== undefined ? link(facts.branch, { to: 'branch', branch: facts.branch }) : null,
    doing,
    doingDetail: !blocked && facts.lastCommit !== undefined && placement.role === 'loop' ? facts.lastCommit : null,
    doingLabel: blocked ? 'Waits on' : 'Doing now',
    doingPace: agentPace(placement, facts),
    tokens: tokensCell(facts),
    timeLeft: left === null ? null : link(timeLeftValue(left.leftMs)),
    agentTitle: facts.unnamedDesk ?? null,
    idle: facts.idleMinutes === undefined ? null : `idle ${ageValue(facts.idleMinutes)}`,
    tokensTitle: tokensTitle(facts),
    timeLeftBar: left === null ? null : { fraction: left.fraction, red: left.red },
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
 * Queued waits on auto-dispatch. In You the switch follows the reason of the
 * items, not the group: a draft plan waits on auto-design, a `review-pr` row on
 * auto-review and a delivered plan on auto-verify. A group with no item holds
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
  return [
    ...(reasons.includes('draft-plan') ? ['autoDesign' as const] : []),
    ...(reasons.includes('review-pr') ? ['autoReview' as const] : []),
    ...(reasons.includes('test-delivered-plan') ? ['autoVerify' as const] : []),
  ];
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

/** One You row: the cells of `YOU_COLUMNS`. */
export type YouRowCells = Record<YouColumn, Cell | null>;

/**
 * The Status value of a You item: the item's state in words.
 *
 * @param reason - why the item is in You.
 * @param facts - the item's row facts; `rounds` words a Draft plan's interrogation.
 */
export const youStatusText = (reason: YouReason, facts: ItemRowFacts): string => {
  if (reason === 'draft-plan') {
    const rounds = facts.rounds;
    return `${facts.phase === 'design' ? 'Design' : 'Draft'} · ${rounds === undefined ? 'not interrogated' : rounds === 1 ? '1 round' : `${rounds} rounds`}`;
  }
  if (reason === 'loose') return 'loose · no plan, nobody works on it';
  return REASON_STATUS[reason];
};

/** One mark of a consequence cell per value, none of them linked. */
const consequenceCell = (values: readonly (string | null)[]): Cell | null => {
  const parts = values.filter((v): v is string => v !== null && v !== '');
  return parts.length === 0 ? null : { value: parts.join(' · '), links: [], parts: parts.map((value) => ({ value, link: null })) };
};

/**
 * The cells of a You row in `YOU_COLUMNS`: the reason's verb, the item's tuple, the consequence and the `⋯`.
 * The verb and the `⋯` both link to the row's menu, so the verb opens the same choice and runs nothing.
 *
 * @param placement - what `placeDelivery` returned for the item.
 * @param facts - the names and numbers the links point at; `slices` counts the plan's slices.
 * @param sprint - `no sprint` where `rowSprintMembership` says so, appended to the consequence; `null` otherwise.
 * @returns the cells, or `null` where the item is not in You or has no row shape.
 */
export const youRowCells = (
  placement: ItemPlacement,
  facts: ItemRowFacts & ConsequenceFacts,
  sprint: string | null = null,
): YouRowCells | null => {
  if (placement.section !== 'you') return null;
  const row = itemRowCells(placement, facts);
  if (row === null) return null;
  const how = REASON_DO[placement.reason];
  const age = facts.ageMinutes === undefined ? null : ageValue(facts.ageMinutes);
  const menu: LinkTarget = { to: 'menu', id: placement.id };
  return {
    verb: { value: how.verb, links: [menu] },
    object: row.item,
    consequence: consequenceCell([how.consequence(facts), age, sprint]),
    menu: { value: '⋯', links: [menu] },
  };
};

/**
 * The age span of a group of items: `36–37 days old` where every item is a day old or more, `5h–3d old` otherwise.
 *
 * @param minutes - each item's age in minutes; an item nobody aged is left out.
 * @returns the span, one age where all are equal, or `null` where no item has an age.
 */
export const ageRangeValue = (minutes: readonly (number | undefined)[]): string | null => {
  const known = minutes.filter((m): m is number => m !== undefined).map((m) => Math.max(0, Math.floor(m)));
  if (known.length === 0) return null;
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  if (lo >= 1440) {
    const [a, b] = [Math.floor(lo / 1440), Math.floor(hi / 1440)];
    return a === b ? `${a} day${a === 1 ? '' : 's'} old` : `${a}–${b} days old`;
  }
  const [a, b] = [ageValue(lo), ageValue(hi)];
  return a === b ? `${a} old` : `${a}–${b} old`;
};

/** The You row that stands for every loose item of the Unblock group. */
export interface LooseGroupRow {
  verb: string;
  tone: VerbTone;
  /** The count: `2 loose branches`. */
  object: string;
  /** The age span only, because the object already counts; `null` where no item has an age. */
  consequence: string | null;
  /** The items, in the order given; each keeps its own `⋯` items. */
  ids: string[];
}

/**
 * The one You row the loose items of Unblock group into.
 *
 * @param items - the loose items, each with its id and age in minutes.
 * @returns the grouped row, or `null` for no item.
 */
export const looseGroupRow = (items: readonly { id: string; ageMinutes?: number }[]): LooseGroupRow | null => {
  if (items.length === 0) return null;
  const n = items.length;
  return {
    verb: REASON_DO.loose.verb,
    tone: REASON_DO.loose.tone,
    object: `${n} loose branch${n === 1 ? '' : 'es'}`,
    consequence: ageRangeValue(items.map((i) => i.ageMinutes)),
    ids: items.map((i) => i.id),
  };
};

/** The line under the You section: the triage link, or the unread notice while the tracker read failed. */
export type YouFooter =
  | { kind: 'triage'; count: number; text: string; anchor: string }
  | { kind: 'unread'; sentence: string; note: string | null };

/**
 * The footer of the You section.
 *
 * @param input - `issueAnswer` is the fleet's tracker answer; `unplanned` counts the tickets assigned to the reader
 *   that no plan names; `note` is the failure and the age of the last good reading.
 * @returns the unread notice where the tracker read failed, whatever rows the section holds; the triage link to the
 *   Tickets section where the read answered and a ticket assigned to the reader has no plan; `null` otherwise.
 */
export const youFooter = (input: {
  issueAnswer: 'answered' | 'failed' | 'unsupported' | null;
  unplanned: number;
  note: string | null;
}): YouFooter | null => {
  if (input.issueAnswer === 'failed') return { kind: 'unread', sentence: 'The tracker gave no answer.', note: input.note };
  if (input.issueAnswer !== 'answered' || input.unplanned === 0) return null;
  const n = input.unplanned;
  return { kind: 'triage', count: n, text: `${n} ticket${n === 1 ? '' : 's'} assigned to you ha${n === 1 ? 's' : 've'} no plan`, anchor: TICKETS_ANCHOR };
};
