import {
  ageValue,
  gatesCell,
  workByCell,
  type Cell,
  type GateOutcome,
  type GatePart,
  type ItemRowFacts,
  type LinkTarget,
} from './delivery-row-form.js';
import type { ItemPlacement, WorkItemGroup } from './delivery-placement.js';
import { pill, type PillTone, type StatusPill } from './status-pill.js';

/**
 * The columns of a Work items row, in the order they render, for every group. `item` holds the item tuple with its
 * PR and branch, `plan` the plan tuple, `status` the status pills, and `menu` the row's `⋯` menu.
 */
export const WORK_ITEM_COLUMNS = ['item', 'plan', 'status', 'by', 'age', 'menu'] as const;
export type WorkItemColumn = (typeof WORK_ITEM_COLUMNS)[number];

/** The header label of each Work items column. */
export const WORK_ITEM_COLUMN_LABELS: Record<WorkItemColumn, string> = {
  item: 'Item', plan: 'Plan', status: 'Status', by: 'By', age: 'Age', menu: 'Actions',
};

/** What the status pills of one group read: the gates, the build progress, or what the item waits on. */
export type GroupValueKind = 'gate' | 'progress' | 'wait';

/** The value kind the status pills of each Work items group read. */
export const WORK_GROUP_VALUE: Record<WorkItemGroup, GroupValueKind> = {
  'at-a-gate': 'gate',
  'being-built': 'progress',
  queued: 'wait',
};

/** The cells of a Work items row that the domain decides. The item, plan and age come from the row's tuple. */
export interface WorkItemCells {
  status: StatusPill[];
  by: Cell | null;
}

const OUTCOME_TONE: Record<GateOutcome, PillTone> = { pass: 'green', pending: 'amber', fail: 'red', none: 'grey' };
const CI_WORD: Record<Exclude<GateOutcome, 'none'>, string> = { pass: 'CI passed', pending: 'CI running', fail: 'CI failed' };
const REVIEW_WORD: Record<GateOutcome, string> = {
  pass: 'review passed', pending: 'review running', fail: 'review failed', none: 'review not asked',
};
const PHASE_WORD = { draft: 'plan in Draft', design: 'plan in Design' } as const;
const APPROVAL_WORD = { plan: 'plan approval', spike: 'spike approval', release: 'release approval' } as const;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The age of a claim in words: `2 days`, `3 hours`, `5 minutes`. */
const claimAge = (minutes: number): string => {
  if (minutes >= 24 * 60) return plural(Math.floor(minutes / (24 * 60)), 'day');
  if (minutes >= 60) return plural(Math.floor(minutes / 60), 'hour');
  return plural(Math.max(0, Math.floor(minutes)), 'minute');
};

/** The pill of one gate mark of `gatesCell`: its word, the tone its `outcome` reads, and the part's own link. */
const gatePill = (part: GatePart): StatusPill => {
  const { outcome } = part;
  const word = part.value.startsWith('CI') && outcome !== 'none' ? CI_WORD[outcome] : REVIEW_WORD[outcome];
  return pill(word, OUTCOME_TONE[outcome], part.link);
};

const gatePills = (facts: ItemRowFacts): StatusPill[] => {
  const cell = gatesCell(facts.prReading, facts.pr);
  return cell === null ? [pill('gates unread', 'grey')] : cell.parts.map(gatePill);
};

const progressPills = (facts: ItemRowFacts): StatusPill[] => [
  facts.pr === undefined ? pill('no PR yet', 'grey') : pill('PR open', 'blue', { to: 'pr', pr: facts.pr }),
  ...(facts.unpushed !== undefined && facts.unpushed > 0 ? [pill(plural(facts.unpushed, 'unpushed commit'), 'amber')] : []),
];

const waitPills = (facts: ItemRowFacts, agents: readonly string[]): StatusPill[] => {
  const claim = facts.claim === undefined ? [] : [
    pill(facts.ageMinutes === undefined ? 'claimed, no work committed' : `claimed ${claimAge(facts.ageMinutes)} ago, no work committed`, 'amber'),
    ...(facts.claim.elsewhere ? [pill('claimed on another machine', 'quiet')] : []),
  ];
  const what = facts.approvalOwed !== undefined ? pill(APPROVAL_WORD[facts.approvalOwed], 'amber')
    : facts.phase !== undefined ? pill(PHASE_WORD[facts.phase], 'amber')
    : facts.waitsOn === '' ? pill('waits on an earlier slice', 'grey')
    : facts.waitsOn !== undefined ? pill(`waits on ${facts.waitsOn}`, 'grey', { to: 'slice', id: facts.waitsOn })
    : null;
  const brief = facts.needsBrief === true ? [pill('no brief', 'grey')] : [];
  if (what !== null) return [...claim, ...brief, what];
  if (claim.length > 0 || brief.length > 0) return [...claim, ...brief];
  return [agents.length === 0 ? pill('no agent assigned', 'grey') : pill('agent assigned', 'grey')];
};

/**
 * The status pills of a Work items row, decided per group's `GroupValueKind`.
 *
 * - `gate`: one pill per gate mark of `gatesCell`. The tone reads the part's `outcome` and the pill keeps the part's
 *   link to the checks or review page; `gates unread` where no gate was read.
 * - `progress`: `PR open` (linked to the PR) or `no PR yet`, then `N unpushed commits` where a count was read.
 * - `wait`: a claim that holds no work as `claimed <age> ago, no work committed`, with the quiet `claimed on another
 *   machine` where it is held elsewhere; then `no brief` where the item needs a brief; then the owed approval, the
 *   plan's phase or the earlier slice, printed once; else `no agent assigned` or `agent assigned`.
 *
 * No pill names a person: the By cell does. `sprint` adds a grey `no sprint` pill last.
 *
 * @param placement - what `placeDelivery` returned for the item.
 * @param facts - the item's row facts.
 * @param sprint - `rowSprintMembership`'s answer for the item.
 * @returns the pills in render order, or `null` where the item is not in Work items.
 */
export const workItemPills = (
  placement: ItemPlacement,
  facts: ItemRowFacts,
  sprint: 'no sprint' | null,
): StatusPill[] | null => {
  if (placement.section !== 'work-items') return null;
  const kind = WORK_GROUP_VALUE[placement.group];
  const pills = kind === 'gate' ? gatePills(facts) : kind === 'progress' ? progressPills(facts) : waitPills(facts, placement.agents);
  return sprint === 'no sprint' ? [...pills, pill('no sprint', 'grey')] : pills;
};

const personBy = (facts: ItemRowFacts): Cell | null => {
  if (facts.person === undefined || (facts.approvalOwed === undefined && facts.phase === undefined)) return null;
  return { value: facts.personName || facts.person, links: [{ to: 'person', handle: facts.person }] };
};

const agentsBy = (agents: readonly string[]): Cell | null =>
  agents.length === 0 ? null : { value: agents[0], links: agents.map((id): LinkTarget => ({ to: 'agent', id })) };

/**
 * The cells of a Work items row that the domain decides: the status pills and the By cell.
 *
 * By names the agents acting on the item through `workByCell`; with no agent it names the person whose approval or
 * plan phase the item waits on, and is `null` otherwise.
 *
 * @param placement - what `placeDelivery` returned for the item.
 * @param facts - the item's row facts.
 * @param sprint - `rowSprintMembership`'s answer for the item.
 * @returns the group, its value kind and the cells, or `null` where the item is not in Work items.
 */
export const workItemCells = (
  placement: ItemPlacement,
  facts: ItemRowFacts,
  sprint: 'no sprint' | null = null,
): { group: WorkItemGroup; holds: GroupValueKind; cells: WorkItemCells } | null => {
  const status = workItemPills(placement, facts, sprint);
  if (status === null || placement.section !== 'work-items') return null;
  const plain = agentsBy(placement.agents) ?? personBy(facts);
  return {
    group: placement.group,
    holds: WORK_GROUP_VALUE[placement.group],
    cells: { status, by: workByCell(plain, placement.agents, facts) },
  };
};

/**
 * The age of the oldest row, or `undefined` where no row has an age reading.
 * An absent reading is not zero.
 */
export const oldestAgeMinutes = (ages: readonly (number | null | undefined)[]): number | undefined => {
  const known = ages.filter((a): a is number => typeof a === 'number');
  return known.length === 0 ? undefined : Math.max(...known);
};

/** The header clause naming the oldest row's age, or `null` where no row has one. */
export const oldestWaitsClause = (ages: readonly (number | null | undefined)[]): string | null => {
  const oldest = oldestAgeMinutes(ages);
  return oldest === undefined ? null : `oldest waits ${ageValue(oldest)}`;
};

/** One count of the Work items header line: `<n> at a gate`. */
export const workGroupCountText = (label: string, count: number): string => `${count} ${label.toLowerCase()}`;
