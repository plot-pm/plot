import {
  headerCountParts,
  headerCounts,
  type HeaderCountPart,
  headerText,
  releaseTicketWording,
  planRowFacts,
  releaseBlocks,
  releasePersonCards,
  sprintDeliveryGroups,
  sprintDeliveryTitle,
  sprintGroupHeader,
  type DeliveryScopeKind,
  type CountedSlice,
  type PersonCard,
  sliceStateIn,
  type PlanRowFacts,
  type PlanSliceFact,
  type ReleaseCarried,
  DELIVERY_LAYOUT,
  deliveryGroupAnchor,
  looseActions,
  oldestWaitsClause,
  WORK_GROUP_COLUMN,
  fleetCountText,
  workGroupCountText,
  type WorkItemGroup,
  placeDelivery,
  type AgentPlacement,
  type DeliveryPlacement,
  type DeliverySection,
  type ItemPlacement,
  type LooseActions,
  type Unplaced,
} from '@plot-pm/domain';
import type { AgentRow, DraftPlan, FleetSprint, IssueRow, Slice } from '../../../contract/schema.js';
import { agentLabel, draftItemId, sliceItemId, type DeliveryMapping, type RegistryAgent } from './delivery-readings.js';
import { itemRowFactsOf } from './delivery-row-facts.js';
import { isStartable, isUnbegun } from './row-identity.js';
import { groupBySlice, type SliceGroup } from './slices.js';
import { rowInSlice } from './delivery-readings.js';
import { headSliceNames, showsSliceFold, slicesElsewhere } from './sections.js';
import { hasExceptions } from './stuck.js';
import { GLYPH_PATH, type GlyphKind } from '../glyphs.js';

/** Every key a collapse toggle can hold: a section or one of its groups. */
export type DeliveryKey = string;

const SECTION_LABELS: Record<DeliverySection, { icon: GlyphKind; label: string; hint: string }> = {
  'release-delivery': { icon: 'release', label: 'Release delivery', hint: 'what has left the fleet' },
  you: { icon: 'ticket', label: 'You', hint: 'review, merge, decide' },
  'work-items': { icon: 'plan', label: 'Work items', hint: 'what the fleet is carrying' },
  fleet: { icon: 'agent', label: 'Fleet', hint: 'the agents' },
  machine: { icon: 'build', label: 'Machine', hint: 'processes and rate limits' },
};

const GROUP_LABELS: Record<string, { label: string; hint: string }> = {
  'blocks-delivery': { label: 'Blocks delivery', hint: 'delivery waits for you' },
  'input-to-the-fleet': { label: 'Input to the fleet', hint: 'a plan waits for your input' },
  unblock: { label: 'Unblock', hint: 'clean up what no plan names' },
  'at-a-gate': { label: 'At a gate', hint: 'CI, review or another gate holds it' },
  'being-built': { label: 'Being built', hint: 'an agent works on it' },
  queued: { label: 'Queued', hint: 'nobody has taken it' },
  working: { label: 'Working', hint: 'an agent acts on an item' },
  blocked: { label: 'Blocked', hint: 'an agent waits on a gate' },
  free: { label: 'Free agents', hint: 'an agent holds no item' },
};

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
  /** The loose-item actions the domain offers; both false for an item that is not loose. */
  looseActions: LooseActions;
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
  /** The Work items column name of this group (`Gates`, `Progress`, `Waits on`); `null` for the other sections. */
  column: string | null;
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

/** One count of a section's header line: a group, its number, and where the number links. */
export interface SectionCount {
  key: string;
  label: string;
  count: number;
  /** What the header prints for the count: `3 queued` in Work items, `Queued 3` elsewhere. */
  text: string;
  /** What follows the number in every section: `queued`, `Queued`. Holds no number. */
  words: string;
  /** The anchor of the group's heading; `null` where the group has no rows and so renders no body. */
  anchor: string | null;
}

export const groupAnchor = (key: string): string => deliveryGroupAnchor(key);

/**
 * The counts of a section's header line, one per group in layout order. A group with no rows keeps its count of 0
 * and links nowhere, because its heading and body are not rendered.
 */
export const summarise = (groups: readonly GroupView[], section?: DeliverySection): SectionCount[] =>
  groups.map((g) => ({
    key: g.key,
    label: g.label,
    count: g.count,
    text: section === 'work-items' ? workGroupCountText(g.label, g.count) : section === 'fleet' ? fleetCountText(g.key, g.count) : `${g.label} ${g.count}`,
    words: section === 'work-items' ? g.label.toLowerCase() : section === 'fleet' ? g.key : g.label,
    anchor: g.count > 0 ? groupAnchor(g.key) : null,
  }));

/** The path of a section's glyph in the board's glyph table. */
export const sectionGlyph = (section: SectionView): string => GLYPH_PATH[section.icon];

export interface SectionView {
  key: DeliverySection;
  icon: GlyphKind;
  /** The header line: one count per group, empty for a section with no groups. */
  summary: SectionCount[];
  /** `oldest waits <age>`: the oldest row of the whole section. `null` where no row has an age reading. */
  oldest: string | null;
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
  /** The Release delivery blocks: one per target release, each holding one collapsed row per plan. */
  releaseBlocks: ReleaseBlockView[];
  /** The distinct plans the section lists, a plan under two sprint groups counted once. */
  releasePlanCount: number;
  /** Every payload row the plan rows hold, for the section's pace mark. */
  releaseRows: AgentRow[];
  delivered: UnplacedView[];
  /** The plans the section lists and the slices it counts per plan, for the release card no Active sprint names. */
  releaseCarried: ReleaseCarried;
}

/** One plan row of the Release delivery section, with the item anchors its In flight lines link to. */
export interface PlanRowView extends PlanRowFacts {
  /** Slice name → the anchor of its placed item, for the slices that have one. */
  anchors: Record<string, string>;
  /** Slice name → the item id, for the Start action. */
  itemIds: Record<string, string>;
  /** The plan's file, for the plan card Start acts on; `''` where no row names one. */
  planFile: string;
}

/** One target release's block. */
export interface ReleaseBlockView {
  release: string;
  /** The sprint a group belongs to under the `my-sprint` scope, `''` for a release block. */
  sprint: string;
  /** The sprint's name where the scope holds several sprints, `''` otherwise. */
  name: string;
  header: string;
  /** The header's figures, each with its words: the same figures `header` prints, apart from the ticket wording. */
  counts: HeaderCountPart[];
  plans: PlanRowView[];
  /** One card per sprint owner of the release; empty where no sprint names the release. */
  cards: PersonCard[];
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
 * The items of the You section with the slice items of a plan that has its own draft item dropped:
 * that row stands for the plan. A plan with no draft item keeps its slice items and their nesting.
 */
const oneRowPerDraftPlan = (items: readonly PlacedItemView[]): PlacedItemView[] => {
  const hasDraftRow = new Set(items.filter((i) => i.draft !== null).map(planOfItem));
  return items.filter((i) => !(isSliceItem(i) && i.placement?.reason === 'draft-plan' && hasDraftRow.has(planOfItem(i))));
};

/**
 * Nests a list of placed items: one plan head per plan that has a slice item in
 * the list, holding that plan's slice items, its plan row and its other items;
 * every other item on its own. Heads and lone items keep the order of their first
 * item.
 *
 * @param scope - prefix for the block keys, unique per group.
 * @param items - the items one group (or the delivered list) holds, in placement order.
 * @param slices - the payload's slices, for the count of slices under no head here.
 * @param inYou - where the items are the You section's: a Draft or Design plan is then one row and its slice items show as none. The other sections keep the nesting.
 * @returns the blocks, each item in exactly one.
 */
export const nestItems = (scope: string, rawItems: readonly PlacedItemView[], slices?: Slice[], inYou = false): BlockView[] => {
  const items = inYou ? oneRowPerDraftPlan(rawItems) : rawItems;
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
export const deliveryView = (
  mapping: DeliveryMapping,
  placement: DeliveryPlacement,
  slices?: Slice[],
  sprints: readonly Pick<FleetSprint, 'slug' | 'title' | 'release' | 'ownerHandle' | 'members'>[] = [],
  scope: DeliveryViewScope = { kind: 'release', sprints: [] },
  now?: Date,
): DeliveryView => {
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
    looseActions: looseActions(mapping.readings.items.find((i) => i.id === p.id) ?? { kind: 'slice' }),
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

  // A slice that holds no branch (so no agent either) is a To do line of its plan row, never a Work items row.
  const leavesWorkItems = (v: PlacedItemView): boolean =>
    v.placement?.section === 'work-items' && v.placement.group === 'queued' && isSliceItem(v) && v.rows.every((r) => isUnbegun(r) && r.branch === '');
  const sections = DELIVERY_LAYOUT.map(({ section, groups }): SectionView => {
    const groupViews = groups.map((group): GroupView => {
      const grouped = itemViews.filter((v) => !leavesWorkItems(v)).filter((v) => (section === 'work-items'
        ? homeGroup(v) === group
        : v.placement?.section === section && v.placement.group === group));
      const items = section === 'you' ? oneRowPerDraftPlan(grouped) : grouped;
      const agents = agentViews.filter((v) => section === 'fleet' && v.placement.group === group);
      const meta = GROUP_LABELS[group] ?? { label: group, hint: '' };
      const rows = [...items.flatMap((v) => v.rows), ...agents.flatMap((v) => (v.row === null ? [] : [v.row]))];
      const blocks = nestItems(group, items, slices, section === 'you');
      const heads = blocks.flatMap((b) => (b.kind === 'plan' ? [b] : []));
      const sliceCount = heads.reduce((n, b) => n + b.slices.length, 0);
      const loose = blocks.length - heads.length;
      const count = items.length + agents.length;
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const tally = heads.length > 0 && (heads.length !== sliceCount || loose > 0)
        ? [plural(heads.length, 'plan'), plural(sliceCount, 'slice'), ...(loose > 0 ? [`${loose} ${loose === 1 ? 'branch' : 'branches'}`] : [])].join(' · ')
        : String(count);
      return {
        key: group, column: section === 'work-items' ? WORK_GROUP_COLUMN[group as WorkItemGroup].name : null, ...meta, items, agents, blocks, rows, count,
        tally,
      };
    });
    return {
      key: section, ...SECTION_LABELS[section], groups: groupViews, summary: summarise(groupViews, section),
      oldest: section === 'work-items'
        ? oldestWaitsClause(groupViews.flatMap((g) => g.items.map((v) => itemRowFactsOf(mapping, v.placement?.id ?? '').ageMinutes)))
        : null,
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

  const placedItem = new Map(itemViews.filter((v) => v.placement !== null && !leavesWorkItems(v)).map((v) => [v.placement!.id, v]));
  const factsOf = (slice: Slice): PlanSliceFact => {
    const id = sliceItemId(slice.plan, slice.name);
    const delivered = mapping.wholeReadings.items.find((i) => i.id === id)?.delivered === true;
    const merge = slice.merge === 'none' ? 'open' : slice.merge ?? (slice.complete || delivered ? 'merged' : 'open');
    const state = sliceStateIn({ id, merge }, mapping.wholeReadings, mapping.input);
    const rows = mapping.rowsByItem[id] ?? [];
    const first = rows.find((r) => r.blockedBy !== null && r.blockedBy !== undefined);
    const open = rows.find((r) => r.pr !== null && r.state !== 'merged' && r.pr.state !== 'closed' && r.pr.open !== false);
    return {
      name: slice.name,
      state,
      ...(slice.mergedFact === undefined ? {} : { merged: slice.mergedFact }),
      linked: placedItem.has(id),
      startable: rows.some(isStartable),
      waitsFor: first?.blockedBy ?? '',
      begun: rows.some((r) => !(isUnbegun(r) && r.branch === '')),
      ...(open?.pr ? { pr: open.pr.number } : {}),
    };
  };
  // A delivered slice the pulse did not carry is still a slice of its plan: its row names both.
  const carried = new Set((slices ?? []).map((s) => sliceItemId(s.plan, s.name)));
  const strays = delivered.flatMap((d) => {
    const r = d.rows[0];
    return r === undefined || r.plan === '' || r.wave === '' || carried.has(d.id)
      ? []
      : [{ plan: r.plan, name: r.wave, branches: [], verdict: 'complete', section: 'done', complete: true, planSliceCount: 1, merge: 'merged' } as unknown as Slice];
  });
  const counted = [...(slices ?? []), ...strays].filter((s) => s.merge !== 'none');
  const approved = [...new Set(counted.map((s) => s.plan))];
  const ownerOf = (plan: string): string => sprints.find((sp) => sp.members.some((m) => m.slug === plan) && sp.ownerHandle !== '')?.ownerHandle ?? '';
  const planRow = (plan: string): PlanRowView => {
    const own = counted.filter((s) => s.plan === plan);
    const facts = own.map(factsOf);
    const ids = Object.fromEntries(own.map((s) => [s.name, sliceItemId(s.plan, s.name)]));
    const anchors = Object.fromEntries(own.flatMap((s) => (placedItem.has(ids[s.name]!) ? [[s.name, itemAnchor(ids[s.name]!)] as const] : [])));
    const planFile = own.flatMap((x) => mapping.rowsByItem[ids[x.name]!] ?? []).find((r) => r.planFile !== '')?.planFile ?? '';
    const phase = own.flatMap((x) => mapping.rowsByItem[ids[x.name]!] ?? []).find((r) => r.phase !== null && r.phase !== '')?.phase ?? null;
    return { ...planRowFacts(plan, ownerOf(plan), facts, { phase, ...(now === undefined ? {} : { now }) }), anchors, itemIds: ids, planFile };
  };
  const DRAFT_ID_PREFIX = draftItemId('');
  // The person cards' bars read the counted slices per plan, as the sprint card does (`countedSlicesByPlan`).
  // A plan with a row, a Draft card or a slice the pulse carries has an entry, `[]` where it holds no counted
  // slice. A plan the payload read nothing for has no entry, so its bar reads missing.
  const draftPlans = mapping.wholeReadings.items.filter((i) => i.id.startsWith(DRAFT_ID_PREFIX)).map((i) => i.id.slice(DRAFT_ID_PREFIX.length));
  const slicesByPlan = new Map<string, CountedSlice[]>();
  for (const plan of [...Object.values(mapping.rowsByItem).flat().map((r) => r.plan), ...draftPlans, ...(slices ?? []).map((s) => s.plan)]) {
    if (plan !== '' && !slicesByPlan.has(plan)) slicesByPlan.set(plan, []);
  }
  for (const s of counted) {
    const id = sliceItemId(s.plan, s.name);
    const delivered = mapping.wholeReadings.items.find((i) => i.id === id)?.delivered === true;
    const list = slicesByPlan.get(s.plan) ?? [];
    list.push({ id, merge: s.merge === 'none' ? 'open' : s.merge ?? (s.complete || delivered ? 'merged' : 'open') });
    slicesByPlan.set(s.plan, list);
  }
  const scopeFacts = { kind: scope.kind, sprints: scope.sprints.map((sp) => ({ slug: sp.slug, title: sp.title, members: (sp.members ?? []).map((m) => m.slug) })) };
  const sprintGroups = sprintDeliveryGroups(scopeFacts, approved);
  const sectionTitle = sprintDeliveryTitle(scopeFacts);
  for (const section of sections) if (section.key === 'release-delivery') section.label = sectionTitle;
  const blockedOf = (plans: readonly PlanRowView[]): number => plans.reduce((n, p) => n + (p.strip.find((x) => x.state === 'blocked')?.count ?? 0), 0);
  const sprintBlocks = sprintGroups.map((g): ReleaseBlockView => {
    const plans = g.plans.map(planRow);
    const strip = { blocked: blockedOf(plans) };
    const header = sprintGroupHeader(g.name, sprintGroups.length > 1, headerText(headerCounts(plans), '', strip));
    return { release: '', sprint: g.sprint, name: sprintGroups.length > 1 ? g.name : '', header, counts: headerCountParts(headerCounts(plans), strip), plans, cards: [] };
  });
  const releaseScoped = releaseBlocks(sprints.map((sp) => ({ release: sp.release, members: sp.members.map((m) => m.slug) })), approved).map((b): ReleaseBlockView => {
    const plans = b.plans.filter((p) => approved.includes(p)).map(planRow);
    const blocked = blockedOf(plans);
    const target = mapping.releases.targets.find((t) => t.release === b.release);
    const tickets = mapping.releases.tickets;
    const wording = target === undefined || tickets === null ? null : releaseTicketWording(tickets, target.release, target.started);
    const header = headerText(headerCounts(plans), b.release, { blocked });
    const cards = releasePersonCards(sprints.map((sp) => ({ slug: sp.slug, title: sp.title ?? '', release: sp.release ?? '', ownerHandle: sp.ownerHandle ?? '', members: sp.members ?? [] })), b.release, mapping.directory ?? {}, slicesByPlan, mapping.wholeReadings, mapping.input);
    return { release: b.release, sprint: '', name: '', plans, counts: headerCountParts(headerCounts(plans), { blocked }), header: wording === null ? header : `${header} · ${wording}`, cards };
  });
  const blocks = scope.kind === 'my-sprint' ? sprintBlocks : releaseScoped;
  const releasePlanCount = new Set(blocks.flatMap((b) => b.plans.map((p) => p.plan))).size;
  const releaseRows = blocks.flatMap((b) => b.plans.flatMap((p) => Object.values(p.itemIds).flatMap((id) => mapping.rowsByItem[id] ?? [])));

  return { sections, notPlaced, releaseBlocks: blocks, releasePlanCount, releaseRows, delivered, releaseCarried: { approved, slicesByPlan } };
};

/** The Delivery scope as the section reads it: its kind and the sprints in scope. */
export interface DeliveryViewScope {
  kind: DeliveryScopeKind;
  sprints: readonly Pick<FleetSprint, 'slug' | 'title' | 'members'>[];
}

/** Maps the payload and places it: the one call the tab makes. */
export const placeMapping = (
  mapping: DeliveryMapping,
  slices?: Slice[],
  sprints: readonly Pick<FleetSprint, 'slug' | 'title' | 'release' | 'ownerHandle' | 'members'>[] = [],
  scope?: DeliveryViewScope,
  now?: Date,
): DeliveryView => deliveryView(mapping, placeDelivery(mapping.readings, mapping.input), slices, sprints, scope, now);
