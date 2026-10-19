import { isMine, type OwnedRow, type Reader } from './ownership.js';

/**
 * One toggle chip on the Delivery tab's filter row.
 *
 * `hiddenCount` is the rows this chip's filter would hide if it were on,
 * counted over the rows reaching the row in their current (other-filters-applied)
 * state — `0` whenever `disabledReason` is non-null, since a chip that cannot
 * act hides nothing by its own action.
 */
export interface Chip {
  /** What the chip reads, e.g. `This sprint` or `Mine (jwloka)`. */
  readonly label: string;
  /** Whether the filter is currently active. */
  readonly on: boolean;
  /** How many rows this chip's filter would hide. */
  readonly hiddenCount: number;
  /** Why the chip cannot act, naming the fix; `null` when it can. */
  readonly disabledReason: string | null;
}

/** The three chips, in the row's fixed order. */
export interface ChipRow {
  readonly thisSprint: Chip;
  readonly mine: Chip;
  readonly waitingOnMe: Chip;
}

/** What `chipRow` reads for the `This sprint` chip. */
export interface SprintChipReadings {
  /** Whether a sprint is active to filter by. */
  readonly hasActiveSprint: boolean;
  /** Whether the sprint filter is currently on. */
  readonly on: boolean;
  /** Rows not already hidden by another filter, before this chip's own effect. */
  readonly visibleRows: readonly { readonly inSprint: boolean }[];
}

/** What `chipRow` reads for the `Mine` chip. */
export interface MineChipReadings {
  /** Who is reading, as the ownership rule takes it. */
  readonly reader: Reader;
  /** Whether the ownership filter is currently on. */
  readonly on: boolean;
  /** Rows not already hidden by another filter, before this chip's own effect. */
  readonly visibleRows: readonly OwnedRow[];
}

/** What `chipRow` reads for the `Waiting on me` chip. */
export interface WaitingOnMeChipReadings {
  /** Whether the filter is currently on. Always `false` while the chip is disabled. */
  readonly on: boolean;
}

/** Everything `chipRow` reads, one block per chip. */
export interface ChipRowReadings {
  readonly sprint: SprintChipReadings;
  readonly mine: MineChipReadings;
  readonly waitingOnMe: WaitingOnMeChipReadings;
}

/**
 * The reader's identity as the `Mine` chip's label names it: `hostUser`,
 * falling back to `gitEmail`. `''` where the reader carries neither — the
 * caller reads that as "no identity" and disables the chip.
 *
 * @param reader - who is reading.
 * @returns the identity text, or `''` where none can be read.
 */
const identityOf = (reader: Reader): string =>
  reader.hostUser?.trim() || reader.gitEmail?.trim() || '';

/**
 * The `This sprint` chip: on/off against the active sprint, disabled with no
 * sprint to filter by.
 *
 * @param readings - whether a sprint is active, the chip's state, and the rows it would act on.
 * @returns the chip.
 */
const sprintChip = (readings: SprintChipReadings): Chip => {
  if (!readings.hasActiveSprint) {
    return { label: 'This sprint', on: false, hiddenCount: 0, disabledReason: 'No sprint is Active.' };
  }
  const hiddenCount = readings.on ? 0 : readings.visibleRows.filter((row) => !row.inSprint).length;
  return { label: 'This sprint', on: readings.on, hiddenCount, disabledReason: null };
};

/**
 * The `Mine` chip: carries the reader's identity in its label, disabled with
 * no identity to match.
 *
 * @param readings - who is reading, the chip's state, and the rows it would act on.
 * @returns the chip.
 */
const mineChip = (readings: MineChipReadings): Chip => {
  const identity = identityOf(readings.reader);
  if (identity === '') {
    return {
      label: 'Mine',
      on: false,
      hiddenCount: 0,
      disabledReason: 'No identity configured — set hostUser or gitEmail.',
    };
  }
  const label = `Mine (${identity})`;
  const hiddenCount = readings.on
    ? 0
    : readings.visibleRows.filter((row) => !isMine(row, readings.reader)).length;
  return { label, on: readings.on, hiddenCount, disabledReason: null };
};

/**
 * The `Waiting on me` chip.
 *
 * No existing rule names what this chip filters — the plan names the chip and
 * no behaviour, and the brief for this wave requires the rule to return it
 * disabled with a reason rather than guess one. `on` and `hiddenCount` stay
 * `0`/`false` as long as it is disabled, since a disabled chip can act on
 * nothing.
 *
 * @param _readings - unread while the chip is disabled; kept for the shape a
 *   future behaviour will need.
 * @returns the chip, always disabled.
 */
const waitingOnMeChip = (_readings: WaitingOnMeChipReadings): Chip => ({
  label: 'Waiting on me',
  on: false,
  hiddenCount: 0,
  disabledReason: 'Not yet defined — no rule names what this chip filters.',
});

/**
 * The Delivery tab's chip row: one chip each for `This sprint`, `Mine` and
 * `Waiting on me`, decided from readings rather than rendered live by the
 * component (root `CLAUDE.md`, "Every rendered state is a domain property").
 *
 * @param readings - what each chip needs, grouped per chip.
 * @returns the three chips, in display order.
 */
export const chipRow = (readings: ChipRowReadings): ChipRow => ({
  thisSprint: sprintChip(readings.sprint),
  mine: mineChip(readings.mine),
  waitingOnMe: waitingOnMeChip(readings.waitingOnMe),
});
