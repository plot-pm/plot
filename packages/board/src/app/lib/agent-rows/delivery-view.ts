import {
  DELIVERY_LAYOUT,
  placeDelivery,
  type AgentPlacement,
  type DeliveryPlacement,
  type DeliverySection,
  type ItemPlacement,
  type Unplaced,
} from '@plot-pm/domain';
import type { AgentRow, DraftPlan } from '../../../contract/schema.js';
import type { DeliveryMapping, RegistryAgent } from './delivery-readings.js';

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
};

export const reasonWords = (reason: string): string => REASON_WORDS[reason] ?? reason;

/** One work item the rule placed, with the payload rows it stands for. */
export interface PlacedItemView {
  placement: ItemPlacement;
  rows: AgentRow[];
  draft: DraftPlan | null;
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

export interface GroupView {
  key: string;
  label: string;
  hint: string;
  items: PlacedItemView[];
  agents: PlacedAgentView[];
  count: number;
}

export interface SectionView {
  key: DeliverySection;
  icon: string;
  label: string;
  hint: string;
  groups: GroupView[];
  count: number;
}

/** A subject the rule did not place, with the reason in words. */
export interface UnplacedView {
  id: string;
  subject: Unplaced['subject'];
  reason: Unplaced['reason'];
  label: string;
  note: string;
}

export interface DeliveryView {
  sections: SectionView[];
  /** Subjects with a reading nobody took — shown in a note, never dropped. */
  notPlaced: UnplacedView[];
  /** The Release delivery line: delivered, held at gates, blocked. */
  releaseLine: string;
  delivered: UnplacedView[];
}

export const itemAnchor = (id: string): string => `delivery-item-${id}`;
export const agentAnchor = (id: string): string => `delivery-agent-${id}`;

const itemLabel = (id: string, rows: readonly AgentRow[], draft: DraftPlan | null): string => {
  const first = rows[0];
  if (first !== undefined) {
    if (first.wave !== '') return `${first.plan} › ${first.wave}`;
    return first.branch || first.plan || id;
  }
  return draft?.plan ?? id;
};

const agentLabel = (id: string, entry: RegistryAgent | null): string =>
  entry?.branch || entry?.worktree || id;

const unreadNote = (subject: Unplaced['subject']): string =>
  subject === 'item'
    ? 'not placed: a reading the scan did not take (CI, review or stage is unread)'
    : 'not placed: the process of this agent was not read';

/**
 * Orders the rule's placement as the tab renders it: sections and groups in
 * `DELIVERY_LAYOUT` order, each placed item and agent once, links named from
 * the rule's `agents` and `actsOn` fields.
 *
 * @param mapping - the readings and the payload rows each subject id stands for.
 * @param placement - what `placeDelivery` returned for `mapping`.
 * @returns the sections, the not-placed note rows and the Release delivery line.
 */
export const deliveryView = (mapping: DeliveryMapping, placement: DeliveryPlacement): DeliveryView => {
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
    itemLabel(id, mapping.rowsByItem[id] ?? [], mapping.draftsByItem[id] ?? null);
  const labelOfAgent = (id: string): string => agentLabel(id, mapping.agentsById[id] ?? null);

  const itemViews = placement.items.map((p): PlacedItemView => ({
    placement: p,
    rows: mapping.rowsByItem[p.id] ?? [],
    draft: mapping.draftsByItem[p.id] ?? null,
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

  const sections = DELIVERY_LAYOUT.map(({ section, groups }): SectionView => {
    const groupViews = groups.map((group): GroupView => {
      const items = itemViews.filter((v) => v.placement.section === section && v.placement.group === group);
      const agents = agentViews.filter((v) => section === 'fleet' && v.placement.group === group);
      const meta = GROUP_LABELS[group] ?? { label: group, hint: '' };
      return { key: group, ...meta, items, agents, count: items.length + agents.length };
    });
    return { key: section, ...SECTION_LABELS[section], groups: groupViews, count: groupViews.reduce((n, g) => n + g.count, 0) };
  });

  const view = (u: Unplaced): UnplacedView => ({
    id: u.id,
    subject: u.subject,
    reason: u.reason,
    label: u.subject === 'item' ? labelOfItem(u.id) : labelOfAgent(u.id),
    note: u.reason === 'delivered' ? 'delivered' : unreadNote(u.subject),
  });
  const notPlaced = placement.unplaced.filter((u) => u.reason === 'unread').map(view);
  const delivered = placement.unplaced.filter((u) => u.reason === 'delivered').map(view);

  const slicesTotal = placement.items.filter((p) => p.id.startsWith('slice:')).length
    + placement.unplaced.filter((u) => u.subject === 'item' && u.id.startsWith('slice:')).length;
  const slicesDelivered = delivered.filter((u) => u.id.startsWith('slice:')).length;
  const held = placement.items.filter((p) => p.section === 'work-items' && p.group === 'at-a-gate').length;
  const blocked = placement.items.filter((p) => p.section === 'you' && p.group === 'unblock').length;
  const releaseLine = `${slicesDelivered} of ${slicesTotal} slices delivered · ${held} held at gates · ${blocked} blocked`;

  return { sections, notPlaced, releaseLine, delivered };
};

/** Maps the payload and places it: the one call the tab makes. */
export const placeMapping = (mapping: DeliveryMapping): DeliveryView =>
  deliveryView(mapping, placeDelivery(mapping.readings, mapping.input));

/** The Machine section's one line: the processes the payload's rows carry. */
export const machineLine = (rows: readonly AgentRow[]): string => {
  const processes = rows.reduce((n, r) => n + (r.processes?.length ?? 0), 0);
  return processes === 0 ? 'no process to wait on' : `${processes} ${processes === 1 ? 'process' : 'processes'} running`;
};
