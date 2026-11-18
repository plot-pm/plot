import {
  ageValue,
  gatesCell,
  itemRowCells,
  progressCell,
  waitsOnCell,
  workByCell,
  type Cell,
  type ItemRowFacts,
} from './delivery-row-form.js';
import type { ItemPlacement, WorkItemGroup } from './delivery-placement.js';

/** The columns of a Work items row, in the order they render. `group` holds the group's own kind of value. */
export const WORK_ITEM_COLUMNS = ['kind', 'item', 'where', 'group', 'by', 'age'] as const;
export type WorkItemColumn = (typeof WORK_ITEM_COLUMNS)[number];

/** One Work items row: the cells of `WORK_ITEM_COLUMNS`. A cell nobody asked for is `null`. */
export type WorkItemCells = Record<WorkItemColumn, Cell | null>;

/** What one group's column holds. A column holds one kind of value. */
export type GroupValueKind = 'gate' | 'progress' | 'wait';

/** The name and the value kind of each Work items group's column. */
export const WORK_GROUP_COLUMN: Record<WorkItemGroup, { name: string; holds: GroupValueKind }> = {
  'at-a-gate': { name: 'Gates', holds: 'gate' },
  'being-built': { name: 'Progress', holds: 'progress' },
  queued: { name: 'Waits on', holds: 'wait' },
};

/**
 * The cells of a Work items row. The At a gate column holds one mark per gate;
 * Being built holds the PR state and the unpushed count, Queued what the
 * item waits on; `ROW_COLUMNS` and the other sections keep `status`.
 *
 * @param placement - what `placeDelivery` returned for the item.
 * @param facts - the names and numbers the links point at.
 * @returns the group, its column name and the cells, or `null` where the item is not in Work items or has no row shape.
 */
export const workItemCells = (
  placement: ItemPlacement,
  facts: ItemRowFacts,
): { group: WorkItemGroup; column: string; cells: WorkItemCells } | null => {
  if (placement.section !== 'work-items') return null;
  const row = itemRowCells(placement, facts);
  if (row === null) return null;
  const group = placement.group === 'at-a-gate' ? gatesCell(facts.prReading, facts.pr)
    : placement.group === 'being-built' ? progressCell(facts)
    : waitsOnCell(facts, placement.agents);
  return {
    group: placement.group,
    column: WORK_GROUP_COLUMN[placement.group].name,
    cells: { kind: row.kind, item: row.item, where: row.where, group: group ?? (placement.group === 'at-a-gate' ? row.status : null), by: workByCell(row.by, placement.agents, facts), age: row.age },
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
