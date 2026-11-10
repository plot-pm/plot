import {
  ownership,
  type AgentPlacementReading,
  type AgentRole,
  type DeliveryInput,
  type DeliveryMine,
  type DeliveryReadings,
  type MineMode,
  type Ownership,
  type Reader,
  type WorkItemReading,
} from '@plot-pm/domain';
import type { AgentEntry, AgentRow, DraftPlan, IssueRow, Slice, TicketSourceShape } from '../../../contract/schema.js';
import { ownedFromCard, ownedFromRow, ownedFromTicket } from './mine-filter.js';
import { sliceKeyOf } from './sections.js';
import { SLICE_LINKING_KINDS } from './slices.js';

/** The two `## Plot Config` keys the rule reads, as the server carried them. */
export interface DeliveryConfig {
  autoReview?: boolean | undefined;
  correctionBudget?: number | undefined;
}

/** A registry entry, with the role the registry declares where it declares one. */
export type RegistryAgent = AgentEntry & { role?: AgentRole };

export interface DeliveryMapInput {
  rows: readonly AgentRow[];
  slices: readonly Slice[];
  agents: readonly RegistryAgent[];
  drafts: readonly DraftPlan[];
  reader: Reader;
  mode: MineMode;
  config: DeliveryConfig;
  /** The tickets the server chose for the reader (`fleet.waiting.tickets`); `null` or absent where the index was not read. */
  tickets?: readonly IssueRow[] | null | undefined;
  /** How the tickets name their assignees; `null` where unknown. */
  ticketSource?: TicketSourceShape | null | undefined;
  /** The target releases of the selected sprints; absent where the Sprint filter is off. */
  releases?: readonly string[] | undefined;
}

/** What `placeDelivery` reads, and the payload rows each subject id stands for. */
export interface DeliveryMapping {
  readings: DeliveryReadings;
  input: DeliveryInput;
  /** Item id → the branch rows it holds, in payload order. A draft plan holds none. */
  rowsByItem: Record<string, AgentRow[]>;
  /** Item id → the Draft plan it stands for. */
  draftsByItem: Record<string, DraftPlan>;
  /** Agent id → the registry entry. */
  agentsById: Record<string, RegistryAgent>;
  /** Item id → the ticket it stands for. */
  ticketsByItem: Record<string, IssueRow>;
}

/** The domain index exports a different `PrReading` from `branch-state`; this names the placement rule's. */
type PrFacts = NonNullable<WorkItemReading['pr']>;

const MINE: Record<MineMode, DeliveryMine> = { all: 'off', 'mine-and-unknown': 'mine', mine: 'strict' };

/** The payload's workflow phase words, and the lifecycle phase the placement rule reads for each. */
const PHASE_OF: Readonly<Record<string, NonNullable<WorkItemReading['phase']>>> = {
  Discovery: 'draft',
  Design: 'design',
  Development: 'approved',
  Testing: 'delivered',
  Released: 'released',
};

const phaseOf = (value: string | null): WorkItemReading['phase'] =>
  value === null ? undefined : PHASE_OF[value];

export const sliceItemId = (plan: string, wave: string): string => `slice:${sliceKeyOf(plan, wave)}`;
export const branchItemId = (branch: string): string => `branch:${branch}`;
export const draftItemId = (plan: string): string => `plan:${plan}`;
export const ticketItemId = (number: string): string => `ticket:${number}`;
export const agentId = (agent: AgentEntry): string =>
  `agent:${agent.session || agent.branch || agent.worktree || agent.pid}`;

/** Whether a payload row is a branch of a slice: it names a wave and is not a kind that only links to one. */
export const rowInSlice = (row: AgentRow): boolean => row.wave !== '' && !SLICE_LINKING_KINDS.has(row.kind);

/** The item id a payload row belongs to. */
export const itemIdOfRow = (row: AgentRow): string =>
  rowInSlice(row) ? sliceItemId(row.plan, row.wave) : branchItemId(row.branch);

/** A host that answers `none` reports that no check gates the PR, which is a reading; `unknown` is the host not answering. */
const ciOf = (pr: NonNullable<AgentRow['pr']>): PrFacts['ci'] => {
  switch (pr.ciChecks) {
    case 'green':
    case 'none': return 'passed';
    case 'pending': return 'running';
    case 'failing': return 'failed';
    default: break;
  }
  if (pr.ciChecks !== undefined) return 'unread';
  switch (pr.state) {
    case 'green':
    case 'none': return 'passed';
    case 'pending': return 'running';
    case 'failing': return 'failed';
    default: return 'unread';
  }
};

const reviewOf = (pr: NonNullable<AgentRow['pr']>): PrFacts['review'] => {
  switch (pr.plotReview) {
    case 'success': return 'passed';
    case 'failure': return 'high';
    case 'pending': return 'pending';
    case 'absent': return 'none';
    default: return 'unread';
  }
};

const hasOpenPr = (row: AgentRow): boolean =>
  row.pr !== null && row.state !== 'merged' && row.pr.state !== 'closed' && row.pr.open !== false;

const ownershipOfRows = (rows: readonly AgentRow[], reader: Reader): Ownership => {
  const readings = rows.map((row) => ownership(ownedFromRow(row), reader));
  if (readings.includes('mine')) return 'mine';
  return readings.includes('theirs') ? 'theirs' : 'unknown';
};

const rowItem = (id: string, rows: readonly AgentRow[], slice: Slice | undefined, reader: Reader): WorkItemReading => {
  const first = rows[0]!;
  const open = rows.find(hasOpenPr);
  const item: WorkItemReading = {
    id,
    kind: first.kind === 'release' ? 'release' : !rowInSlice(first) ? (first.pr ? 'pr' : 'branch') : 'slice',
    ownership: ownershipOfRows(rows, reader),
  };
  const phase = phaseOf(first.phase);
  if (phase !== undefined) item.phase = phase;
  if (rows.some((r) => r.question !== null && r.question !== undefined)) item.blockedMarker = true;
  const merged = slice !== undefined ? slice.complete : rows.every((r) => r.state === 'merged');
  if (merged || phase === 'delivered' || phase === 'released') item.delivered = true;
  // A row the last scan never held says nothing about its stage: absent, so the rule lists it as unread.
  if (rows.every((r) => r.group === null)) return item;
  if (open !== undefined && open.pr !== null) {
    item.stage = 'pr';
    item.pr = { ci: ciOf(open.pr), review: reviewOf(open.pr) };
    if (open.pr.state === 'conflicts') item.mergeConflict = true;
  } else if (rows.some((r) => r.state === 'wip' || r.state === 'claimed')) {
    item.stage = 'building';
  } else if (!merged) {
    item.stage = 'queued';
  }
  const blockedBy = rows.find((r) => r.blockedBy !== null)?.blockedBy;
  if (blockedBy) item.waitsOn = blockedBy;
  return item;
};

/**
 * The target releases the Sprint filter narrows tickets to.
 *
 * Each selected sprint's `Release:`, once per distinct name, so two sprints that
 * name one release feed it once. A sprint that names none adds nothing.
 *
 * @param sprints - the active sprints.
 * @param selected - the selected sprints' slugs.
 * @returns the release names, or `undefined` where no selected sprint names one: the filter then has no release to narrow by.
 */
export const sprintReleases = (
  sprints: readonly { slug: string; release: string }[],
  selected: readonly string[],
): string[] | undefined => {
  const names = sprints.filter((s) => selected.includes(s.slug)).map((s) => s.release.trim()).filter((r) => r !== '');
  return names.length === 0 ? undefined : [...new Set(names)];
};

/**
 * One ticket reading per ticket the server chose. Ownership comes from the
 * assignees and the source; `planned` and `releases` are copied as the wire
 * states them, and a ticket the tracker categorises `Done` is `delivered`.
 */
const ticketItem = (ticket: IssueRow, source: TicketSourceShape | null, reader: Reader): WorkItemReading => {
  const item: WorkItemReading = {
    id: ticketItemId(ticket.number),
    kind: 'ticket',
    ownership: ownership(ownedFromTicket(ticket, source), reader),
  };
  if (ticket.planned === true) item.planned = true;
  if (ticket.releases !== undefined) item.releases = ticket.releases;
  if (ticket.statusCategory === 'Done') item.delivered = true;
  return item;
};

const processOf = (state: AgentEntry['state']): AgentPlacementReading['process'] => {
  switch (state) {
    case 'running':
    case 'waiting':
      return 'running';
    case 'stalled':
    case 'finished':
    case 'failed':
    case 'ended':
    case 'none':
      return 'stopped';
    default:
      return undefined;
  }
};

/**
 * Maps what the Delivery tab's payload carries to the readings `placeDelivery` takes.
 *
 * One work item per slice (rows sharing a plan and a slice name), one per
 * branch row that names no slice, and one per Draft plan that has no row. One
 * agent per registry entry. The mapper copies facts the payload states and
 * leaves every other field absent: a row with no CI reading carries `ci:
 * 'unread'`, an entry whose process nobody read carries no `process`. It sets
 * no `gateUnpassable`, `approvalOwed`, `testOwed` or `corrections`, because the
 * payload does not state them.
 *
 * @param input - the payload's rows, slices, registry entries and Draft plans, the reader and Mine mode, and the config keys.
 * @returns the readings and input for `placeDelivery`, with the lookups the tab renders from.
 */
export const deliveryMapping = (input: DeliveryMapInput): DeliveryMapping => {
  const rowsByItem: Record<string, AgentRow[]> = {};
  for (const row of input.rows) (rowsByItem[itemIdOfRow(row)] ??= []).push(row);

  const sliceByKey = new Map(input.slices.map((s) => [sliceKeyOf(s.plan, s.name), s]));
  const items: WorkItemReading[] = Object.entries(rowsByItem).map(([id, rows]) => {
    const first = rows[0]!;
    const slice = rowInSlice(first) ? sliceByKey.get(sliceKeyOf(first.plan, first.wave)) : undefined;
    return rowItem(id, rows, slice, input.reader);
  });

  const withRow = new Set(input.rows.map((r) => r.plan).filter((p) => p !== ''));
  const draftsByItem: Record<string, DraftPlan> = {};
  for (const draft of input.drafts) {
    if (withRow.has(draft.plan)) continue;
    const id = draftItemId(draft.plan);
    draftsByItem[id] = draft;
    items.push({
      id,
      kind: 'plan',
      ownership: ownership(ownedFromCard(draft), input.reader),
      phase: 'draft',
    });
  }

  const ticketsByItem: Record<string, IssueRow> = {};
  for (const ticket of input.tickets ?? []) {
    const reading = ticketItem(ticket, input.ticketSource ?? null, input.reader);
    ticketsByItem[reading.id] = ticket;
    items.push(reading);
  }

  const itemOfBranch = new Map<string, string>();
  for (const row of input.rows) if (row.branch !== '') itemOfBranch.set(row.branch, itemIdOfRow(row));

  const agentsById: Record<string, RegistryAgent> = {};
  const agents: AgentPlacementReading[] = input.agents.map((agent) => {
    const id = agentId(agent);
    agentsById[id] = agent;
    const reading: AgentPlacementReading = {
      id,
      role: agent.role ?? 'loop',
      actsOn: agent.branch === '' ? null : itemOfBranch.get(agent.branch) ?? branchItemId(agent.branch),
      blockedOn: agent.state === 'waiting' ? 'person' : null,
    };
    const process = processOf(agent.state);
    if (process !== undefined) reading.process = process;
    return reading;
  });

  return {
    readings: { items, agents },
    input: {
      mine: MINE[input.mode],
      ...(input.releases === undefined ? {} : { releases: input.releases }),
      // A key the payload did not carry stays absent. The rule types both as
      // required, so the cast is the one place the mapper cannot say so.
      ...input.config,
    } as DeliveryInput,
    rowsByItem,
    draftsByItem,
    agentsById,
    ticketsByItem,
  };
};
