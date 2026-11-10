import {
  DELIVERY_LAYOUT,
  placeDelivery,
  type AgentPlacement,
  type DeliveryPlacement,
  type DeliverySection,
  type ItemPlacement,
  type Unplaced,
} from '@plot-pm/domain';
import type { AgentRow, DraftPlan, IssueRow, Slice } from '../../../contract/schema.js';
import type { DeliveryMapping, RegistryAgent } from './delivery-readings.js';
import { isUnbegun } from './row-identity.js';
import { groupBySlice, type SliceGroup } from './slices.js';
import { rowInSlice } from './delivery-readings.js';
import { headSliceNames, showsSliceFold, slicesElsewhere } from './sections.js';
import { hasExceptions } from './stuck.js';
import { HOST_ANSWER_HINT, type HostAnswer } from './host-notes.js';

/** Every key a collapse toggle can hold: a section or one of its groups. */
export type DeliveryKey = string;

const SECTION_LABELS: Record<DeliverySection, { icon: string; label: string; hint: string }> = {
  'release-delivery': { icon: '📦', label: 'Release delivery', hint: 'what has left the fleet' },
  you: { icon: '⚠', label: 'You', hint: 'review, merge, decide' },
  'work-items': { icon: '📋', label: 'Work items', hint: 'what the fleet is carrying' },
  fleet: { icon: '🤖', label: 'Fleet', hint: 'the agents' },
  machine: { icon: '🖥', label: 'Machine', hint: 'processes and rate limits' },
};

const GROUP_LABELS: Record<string, { label: string; hint: string }> = {
  'input-to-the-fleet': { label: 'Input to the fleet', hint: 'a plan or approval waits for you' },
  'review-a-result': { label: 'Review a result', hint: 'a PR or a delivered plan waits for you' },
  unblock: { label: 'Unblock', hint: 'the fleet cannot go on alone' },
  'at-a-gate': { label: 'At a gate', hint: 'CI, review or another gate holds it' },
  'being-built': { label: 'Being built', hint: 'an agent works on it' },
  queued: { label: 'Queued', hint: 'nobody has taken it' },
  working: { label: 'Working', hint: 'an agent acts on an item' },
  blocked: { label: 'Blocked', hint: 'an agent waits on a gate' },
  free: { label: 'Free agents', hint: 'an agent holds no item' },
};

/** The YOU reasons as a short sentence, so a row says why it sits under You. */
const REASON_WORDS: Record<string, string> = {
  'draft-plan': 'a draft plan needs your input',
  'plan-approval': 'the plan needs your approval',
  'spike-approval': 'the spike needs your approval',
  'release-approval': 'the release needs your approval',
  'test-delivered-plan': 'a delivered plan waits for your test',
  'review-pr': 'the PR waits for your review',
  'blocked-marker': 'the desk holds a PLOT-BLOCKED marker',
  'fleet-stuck': 'the fleet cannot pass the gate alone',
  'merge-conflict': 'the PR conflicts and no agent works on it',
  'agent-died': 'the agent died and left the slice unbuilt',
  'ticket-assigned': 'a ticket is assigned to you and no plan names it',
};

export const reasonWords = (reason: string): string => REASON_WORDS[reason] ?? reason;

/** One work item the rule placed, with the payload rows it stands for. */
export interface PlacedItemView {
  /** What the rule placed; `null` for a delivered item, which the rule places in no section. */
  placement: ItemPlacement | null;
  rows: AgentRow[];
  draft: DraftPlan | null;
  /** The ticket the item stands for; `null` for every other kind. */
  ticket: IssueRow | null;
  /** The label a link to this item shows. */
  label: string;
  /** The DOM id a link to this item scrolls to. */
  anchor: string;
  /** The agents acting on the item, as links. */
  links: LinkView[];
}

/** One agent the rule placed, with its registry entry. */
export interface PlacedAgentView {
  placement: AgentPlacement;
  entry: RegistryAgent | null;
  /** The row of the branch the agent acts on, where the payload holds one. */
  row: AgentRow | null;
  label: string;
  anchor: string;
  /** The item the agent acts on, as a link; `null` while it holds none or the item is unknown. */
  links: LinkView[];
}

export interface LinkView {
  label: string;
  anchor: string;
}

/**
 * One slice item under a plan head: the slice row it renders and the rows that
 * render on their own beside it.
 */
export interface SliceBlockView {
  item: PlacedItemView;
  /** The slice row's group; `null` where every row of the item renders on its own. */
  slice: SliceGroup | null;
  /** Rows of the item that render as branch rows, not inside the slice row. */
  loose: AgentRow[];
}

/**
 * A plan head over the slice items of that plan one group holds.
 *
 * `start` draws the slices as unbegun work with a Start control; `progress`
 * draws each slice with its sole branch's status. A plan whose slices land in
 * several groups gets one head per group, each over that group's slices only.
 */
export interface PlanBlockView {
  kind: 'plan';
  /** Unique per group and plan: the key a fold override is stored under. */
  key: string;
  plan: string;
  planFile: string;
  /** Every row the head stands for: its own plan row, if placed here, and its slices' rows. */
  rows: AgentRow[];
  /** The plan's own row item, absorbed into the head; `null` where it sits elsewhere or does not exist. */
  head: PlacedItemView | null;
  slices: SliceBlockView[];
  /** Items of the plan that are neither its plan row nor a slice. */
  loose: PlacedItemView[];
  mode: 'start' | 'progress';
  /** How many slices of the plan sit under another head or no head. */
  elsewhere: number;
  /** The freshest age of the head's rows; `undefined` where none has one. */
  ageMinutes: number | undefined;
  /** Whether a plan row heads the slices. Being built lists its slice rows with no plan head: an agent's rows name their plan. */
  headed: boolean;
}

/** One item that renders on its own: a plan-less row, a Draft plan, or a plan with no slice here. */
export interface ItemBlockView {
  kind: 'item';
  key: string;
  item: PlacedItemView;
}

export type BlockView = PlanBlockView | ItemBlockView;

export interface GroupView {
  key: string;
  label: string;
  hint: string;
  items: PlacedItemView[];
  agents: PlacedAgentView[];
  /** The group's items, nested: plan heads over their slices, then the rest. */
  blocks: BlockView[];
  /** Every payload row the group renders, for the heading's activity mark. */
  rows: AgentRow[];
  count: number;
  /** What the heading counts: the items, or `N plans · M slices` where plan heads and slices differ. */
  tally: string;
}

export interface SectionView {
  key: DeliverySection;
  icon: string;
  label: string;
  hint: string;
  groups: GroupView[];
  /** Every payload row the section renders, for the heading's activity mark. */
  rows: AgentRow[];
  count: number;
}

/** A subject the rule did not place, with the reason in words. */
export interface UnplacedView {
  id: string;
  subject: Unplaced['subject'];
  reason: Unplaced['reason'];
  label: string;
  note: string;
  /** The payload rows of an item subject, rendered beside the note; empty for an agent. */
  rows: AgentRow[];
}

export interface DeliveryView {
  sections: SectionView[];
  /** Subjects with a reading nobody took — shown in a note, never dropped. */
  notPlaced: UnplacedView[];
  /** The Release delivery line: delivered, held at gates, blocked. */
  releaseLine: string;
  delivered: UnplacedView[];
  /** The delivered items, nested as a group's are; rendered under the release line. */
  deliveredBlocks: BlockView[];
  /** Every payload row the delivered items hold. */
  deliveredRows: AgentRow[];
}

export const itemAnchor = (id: string): string => `delivery-item-${id}`;
export const agentAnchor = (id: string): string => `delivery-agent-${id}`;

const itemLabel = (id: string, rows: readonly AgentRow[], draft: DraftPlan | null, ticket: IssueRow | null = null): string => {
  if (ticket !== null) return `${ticket.number} ${ticket.title}`;
  const first = rows[0];
  if (first !== undefined) {
    if (first.wave !== '') return `${first.plan} › ${first.wave}`;
    return first.branch || first.plan || id;
  }
  return draft?.plan ?? id;
};

const agentLabel = (id: string, entry: RegistryAgent | null): string =>
  entry?.branch || entry?.worktree || id;

const unreadNote = (subject: Unplaced['subject'], ticket = false): string =>
  subject === 'item'
    ? ticket
      ? 'not placed: the ticket\'s releases were not read, so the Sprint filter cannot place it'
      : 'not placed: a reading the scan did not take (CI, review or stage is unread)'
    : 'not placed: the process of this agent was not read';

const isPlanRow = (item: PlacedItemView): boolean =>
  item.rows.length > 0 && item.rows.every((r) => r.kind === 'plan' && r.wave === '' && r.plan !== '');

const planOfItem = (item: PlacedItemView): string => item.rows[0]?.plan ?? '';

const isSliceItem = (item: PlacedItemView): boolean => item.rows.length > 0 && rowInSlice(item.rows[0]!);

/**
 * Nests a list of placed items: one plan head per plan that has a slice item in
 * the list, holding that plan's slice items, its plan row and its other items;
 * every other item on its own. Heads and lone items keep the order of their first
 * item.
 *
 * @param scope - prefix for the block keys, unique per group.
 * @param items - the items one group (or the delivered list) holds, in placement order.
 * @param slices - the payload's slices, for the count of slices under no head here.
 * @returns the blocks, each item in exactly one.
 */
export const nestItems = (scope: string, items: readonly PlacedItemView[], slices?: Slice[]): BlockView[] => {
  const withSlice = new Set(items.filter(isSliceItem).map(planOfItem).filter((p) => p !== ''));
  const blocks: BlockView[] = [];
  const heads = new Map<string, PlanBlockView>();
  for (const item of items) {
    const plan = planOfItem(item);
    if (plan === '' || !withSlice.has(plan) || item.draft !== null) {
      blocks.push({ kind: 'item', key: item.anchor, item });
      continue;
    }
    let head = heads.get(plan);
    if (head === undefined) {
      const first = item.rows[0]!;
      head = {
        kind: 'plan', key: `${scope}\u0000${plan}`, plan, planFile: first.planFile,
        rows: [], head: null, slices: [], loose: [], mode: 'progress', elsewhere: 0, ageMinutes: undefined,
        headed: scope !== 'being-built',
      };
      heads.set(plan, head);
      blocks.push(head);
    }
    head.rows.push(...item.rows);
    if (scope !== 'being-built' && isPlanRow(item) && head.head === null) head.head = item;
    else if (isSliceItem(item)) head.slices.push({ item, slice: null, loose: [] });
    else head.loose.push(item);
  }
  for (const head of heads.values()) {
    head.planFile = head.rows.find((r) => r.planFile !== '')?.planFile ?? head.planFile;
    head.mode = head.rows.every((r) => r.group === 'not-started') ? 'start' : 'progress';
    for (const s of head.slices) {
      const rows = head.mode === 'start' ? s.item.rows.filter(isUnbegun) : s.item.rows;
      s.slice = groupBySlice(rows)[0] ?? null;
      s.loose = head.mode === 'start' ? s.item.rows.filter((r) => !isUnbegun(r)) : [];
    }
    head.elsewhere = slicesElsewhere(slices, head.plan, 'not-started', headSliceNames({ plan: head.plan, planFile: head.planFile, rows: head.rows }));
    const ages = head.rows.map((r) => r.ageMinutes).filter((a): a is number => a !== null && a !== undefined);
    head.ageMinutes = ages.length > 0 ? Math.min(...ages) : undefined;
  }
  return oldestFirst(blocks);
};

/** How long a block has waited: its oldest row's age, or its plan clock in minutes where no branch has an age. */
const blockWait = (block: BlockView): number => {
  const rows = block.kind === 'plan' ? block.rows : block.item.rows;
  return rows.reduce((n, r) => Math.max(n, r.ageMinutes ?? 0, (r.waitingDays ?? 0) * 1440), 0);
};

/** Orders blocks by what has waited longest first; blocks that tie keep their placement order. */
const oldestFirst = (blocks: BlockView[]): BlockView[] =>
  blocks.map((b, i) => ({ b, i, wait: blockWait(b) }))
    .sort((a, b) => b.wait - a.wait || a.i - b.i)
    .map((x) => x.b);

/**
 * Whether a plan head's slices are on the page, or `null` where the head has no fold.
 *
 * A head with an exception among its rows stays open. A `start` head over one
 * slice row has no fold; over several it is folded until opened. A `progress`
 * head over several slices is folded until opened, over one it is open until shut.
 *
 * @param block - the plan head.
 * @param overrides - the reader's fold overrides, keyed `open:<key>` and `shut:<key>`.
 */
export const planBlockShown = (block: PlanBlockView, overrides: ReadonlySet<string>): boolean | null => {
  if (block.mode === 'start') {
    if (!showsSliceFold({ plan: block.plan, planFile: block.planFile, rows: block.rows })) return null;
    return overrides.has(`open:${block.key}`) || hasExceptions(block.rows);
  }
  if (hasExceptions(block.rows)) return true;
  return block.slices.length > 1 ? overrides.has(`open:${block.key}`) : !overrides.has(`shut:${block.key}`);
};

/** The override a click on a plan head's caret toggles. */
export const planBlockToggleKey = (block: PlanBlockView): string =>
  block.mode === 'start' || block.slices.length > 1 ? `open:${block.key}` : `shut:${block.key}`;

/**
 * Orders the rule's placement as the tab renders it: sections and groups in
 * `DELIVERY_LAYOUT` order, each placed item and agent once, links named from
 * the rule's `agents` and `actsOn` fields.
 *
 * @param mapping - the readings and the payload rows each subject id stands for.
 * @param placement - what `placeDelivery` returned for `mapping`.
 * @param slices - the payload's slices, for each plan head's count of slices elsewhere.
 * @returns the sections, the not-placed note rows and the Release delivery line.
 */
export const deliveryView = (mapping: DeliveryMapping, placement: DeliveryPlacement, slices?: Slice[]): DeliveryView => {
  const rowOf = (item: string): AgentRow | null => mapping.rowsByItem[item]?.[0] ?? null;
  const ownRow = (entry: RegistryAgent | null): AgentRow | null => {
    if (entry === null || entry.branch === '') return null;
    for (const rows of Object.values(mapping.rowsByItem)) {
      const own = rows.find((r) => r.branch === entry.branch);
      if (own !== undefined) return own;
    }
    return null;
  };
  const labelOfItem = (id: string): string =>
    itemLabel(id, mapping.rowsByItem[id] ?? [], mapping.draftsByItem[id] ?? null, mapping.ticketsByItem[id] ?? null);
  const labelOfAgent = (id: string): string => agentLabel(id, mapping.agentsById[id] ?? null);

  const itemViews = placement.items.map((p): PlacedItemView => ({
    placement: p,
    rows: mapping.rowsByItem[p.id] ?? [],
    draft: mapping.draftsByItem[p.id] ?? null,
    ticket: mapping.ticketsByItem[p.id] ?? null,
    label: labelOfItem(p.id),
    anchor: itemAnchor(p.id),
    links: p.agents.map((a) => ({ label: labelOfAgent(a), anchor: agentAnchor(a) })),
  }));
  const agentViews = placement.agents.map((p): PlacedAgentView => ({
    placement: p,
    entry: mapping.agentsById[p.id] ?? null,
    row: p.actsOn === null ? null : ownRow(mapping.agentsById[p.id] ?? null) ?? rowOf(p.actsOn),
    label: labelOfAgent(p.id),
    anchor: agentAnchor(p.id),
    links: p.actsOn !== null && p.linked ? [{ label: labelOfItem(p.actsOn), anchor: itemAnchor(p.actsOn) }] : [],
  }));

  // A plan's own row (its idea-branch PR) heads the plan beside its slices, so a
  // plan row the rule put in Work items follows the plan's first slice there.
  const sliceHome = new Map<string, string>();
  for (const v of itemViews) {
    const at = v.placement;
    if (at !== null && at.section === 'work-items' && isSliceItem(v) && !sliceHome.has(planOfItem(v))) {
      sliceHome.set(planOfItem(v), at.group);
    }
  }
  const homeGroup = (v: PlacedItemView): string | null => {
    const at = v.placement;
    if (at === null || at.section !== 'work-items') return null;
    return isPlanRow(v) ? sliceHome.get(planOfItem(v)) ?? at.group : at.group;
  };

  const sections = DELIVERY_LAYOUT.map(({ section, groups }): SectionView => {
    const groupViews = groups.map((group): GroupView => {
      const items = itemViews.filter((v) => (section === 'work-items'
        ? homeGroup(v) === group
        : v.placement?.section === section && v.placement.group === group));
      const agents = agentViews.filter((v) => section === 'fleet' && v.placement.group === group);
      const meta = GROUP_LABELS[group] ?? { label: group, hint: '' };
      const rows = [...items.flatMap((v) => v.rows), ...agents.flatMap((v) => (v.row === null ? [] : [v.row]))];
      const blocks = nestItems(group, items, slices);
      const heads = blocks.flatMap((b) => (b.kind === 'plan' ? [b] : []));
      const sliceCount = heads.reduce((n, b) => n + b.slices.length, 0);
      const loose = blocks.length - heads.length;
      const count = items.length + agents.length;
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const tally = heads.length > 0 && (heads.length !== sliceCount || loose > 0)
        ? [plural(heads.length, 'plan'), plural(sliceCount, 'slice'), ...(loose > 0 ? [`${loose} ${loose === 1 ? 'branch' : 'branches'}`] : [])].join(' · ')
        : String(count);
      return {
        key: group, ...meta, items, agents, blocks, rows, count,
        tally,
      };
    });
    return {
      key: section, ...SECTION_LABELS[section], groups: groupViews,
      rows: groupViews.flatMap((g) => g.rows), count: groupViews.reduce((n, g) => n + g.count, 0),
    };
  });

  const view = (u: Unplaced): UnplacedView => ({
    id: u.id,
    subject: u.subject,
    reason: u.reason,
    label: u.subject === 'item' ? labelOfItem(u.id) : labelOfAgent(u.id),
    note: u.reason === 'delivered' ? 'delivered' : unreadNote(u.subject, mapping.ticketsByItem[u.id] !== undefined),
    rows: u.subject === 'item' ? mapping.rowsByItem[u.id] ?? [] : [],
  });
  const notPlaced = placement.unplaced.filter((u) => u.reason === 'unread').map(view);
  const delivered = placement.unplaced.filter((u) => u.reason === 'delivered').map(view);

  const slicesTotal = placement.items.filter((p) => p.id.startsWith('slice:')).length
    + placement.unplaced.filter((u) => u.subject === 'item' && u.id.startsWith('slice:')).length;
  const slicesDelivered = delivered.filter((u) => u.id.startsWith('slice:')).length;
  const held = placement.items.filter((p) => p.section === 'work-items' && p.group === 'at-a-gate').length;
  const blocked = placement.items.filter((p) => p.section === 'you' && p.group === 'unblock').length;
  const releaseLine = `${slicesDelivered} of ${slicesTotal} slices delivered · ${held} held at gates · ${blocked} blocked`;

  const deliveredItems = placement.unplaced
    .filter((u) => u.reason === 'delivered' && u.subject === 'item')
    .map((u): PlacedItemView => ({
      placement: null,
      rows: mapping.rowsByItem[u.id] ?? [],
      draft: mapping.draftsByItem[u.id] ?? null,
      ticket: mapping.ticketsByItem[u.id] ?? null,
      label: labelOfItem(u.id),
      anchor: itemAnchor(u.id),
      links: [],
    }));
  const deliveredBlocks = nestItems('delivered', deliveredItems, slices);

  return {
    sections, notPlaced, releaseLine, delivered, deliveredBlocks,
    deliveredRows: deliveredItems.flatMap((v) => v.rows),
  };
};

/** Maps the payload and places it: the one call the tab makes. */
export const placeMapping = (mapping: DeliveryMapping, slices?: Slice[]): DeliveryView =>
  deliveryView(mapping, placeDelivery(mapping.readings, mapping.input), slices);

/**
 * The Machine section's one line: what the host answered, then the processes the payload's rows carry.
 *
 * A host that has not answered is stated as such and never reads as an empty answer: `not checked yet` before the first
 * fetch, `could not reach the host` after a first fetch failed. Once the host has answered, no process reads `none`.
 *
 * @param rows - the payload's rows.
 * @param answer - `hostAnswer` of the fleet's PR age and PR error.
 */
export const machineLine = (rows: readonly AgentRow[], answer: HostAnswer = 'answered'): string => {
  if (answer !== 'answered') return HOST_ANSWER_HINT[answer];
  const processes = rows.reduce((n, r) => n + (r.processes?.length ?? 0), 0);
  return processes === 0 ? 'none — nothing — a machine is working' : `${processes} ${processes === 1 ? 'process' : 'processes'} running`;
};
