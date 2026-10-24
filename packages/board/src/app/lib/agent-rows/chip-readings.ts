import type { Reader } from '@plot-pm/domain';
import type { ChipRowReadings } from '@plot-pm/domain/rules/chip-row';
import type { AgentRow, FleetSprint } from '../../../contract/schema.js';
import { ownedFromRow } from './mine-filter.js';

/** The row fields the chip row reads: sprint membership and ownership. */
type ChipRowSource = Pick<AgentRow, 'kind' | 'plan' | 'pr' | 'assignee' | 'author' | 'approver'>;

/** What the Delivery tab holds when it builds the chip row's readings. */
export interface ChipReadingsInput {
  /** Every row of the fleet, before the sprint filter and the `Mine` filter. */
  readonly rows: readonly ChipRowSource[];
  /** `rows` after the sprint filter, before the `Mine` filter. */
  readonly sprintFilteredRows: readonly ChipRowSource[];
  /** The Active sprints, in the order the chip row shows them. */
  readonly activeSprints: readonly Pick<FleetSprint, 'slug' | 'title'>[];
  /** The reader's sprint selection, sanitized against `activeSprints`. */
  readonly selectedSprints: readonly string[];
  /** Sprint slug to the set of plan slugs it contains. */
  readonly membership: Map<string, Set<string>>;
  /** Who is reading. */
  readonly reader: Reader;
  /** Whether the `Mine` filter is on. */
  readonly mineOnly: boolean;
}

/**
 * The readings `chipRow` (`@plot-pm/domain`) decides the Delivery tab's chips from.
 *
 * Every sprint chip reads the same block: all rows before the sprint filter,
 * the current selection and the membership. The `Mine` chip reads the rows
 * after the sprint filter, mapped through `ownedFromRow`.
 *
 * @param input - the rows, the sprints, the selection and the reader.
 * @returns the chip row's readings.
 */
export const chipReadings = (input: ChipReadingsInput): ChipRowReadings => ({
  sprint: {
    sprints: input.activeSprints.map((sprint) => ({ slug: sprint.slug, title: sprint.title })),
    selected: input.selectedSprints,
    membership: input.membership,
    rows: input.rows.map((row) => ({ kind: row.kind, plan: row.plan })),
  },
  mine: {
    reader: input.reader,
    on: input.mineOnly,
    visibleRows: input.sprintFilteredRows.map((row) => ownedFromRow(row)),
  },
  waitingOnMe: { on: false },
});
