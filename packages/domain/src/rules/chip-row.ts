import { isMine, type OwnedRow, type Reader } from './ownership.js';

/**
 * One toggle chip on the Delivery tab's filter row.
 *
 * `hiddenCount` is the rows this chip's filter hides when on, or would hide
 * when off, counted over the rows reaching the chip with the other filters
 * applied and this chip's own filter not — the same count whether `on` is true
 * or false. It is `0` whenever `disabledReason` is non-null, since a chip that
 * cannot act hides nothing by its own action.
 */
export interface Chip {
  /** What the chip reads, e.g. `This sprint` or `Mine (jwloka)`. */
  readonly label: string;
  /** Whether the filter is currently active. */
  readonly on: boolean;
  /** How many rows this chip's filter hides (on) or would hide (off). */
  readonly hiddenCount: number;
  /** Why the chip cannot act, naming the fix; `null` when it can. */
  readonly disabledReason: string | null;
}

/** The chip row: the three fixed chips, plus one per Active sprint. */
export interface ChipRow {
  readonly thisSprint: Chip;
  readonly mine: Chip;
  readonly waitingOnMe: Chip;
  /** One chip per Active sprint, in `readings.perSprint`'s order. */
  readonly perSprint: readonly Chip[];
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

/** What `chipRow` reads for one Active sprint's own chip. */
export interface PerSprintChipReadings {
  /** The sprint's slug, carried through for the caller to key its click handler on. */
  readonly slug: string;
  /** The sprint's title, shown as the chip's label. */
  readonly title: string;
  /** Whether this sprint is currently in the reader's selection. */
  readonly on: boolean;
  /**
   * Rows not already hidden by another filter, before this sprint's own
   * effect — the same base `This sprint`'s `visibleRows` reads, each marked
   * for whether it belongs to THIS sprint rather than to any Active sprint.
   */
  readonly visibleRows: readonly { readonly inSprint: boolean }[];
}

/** Everything `chipRow` reads, one block per chip. */
export interface ChipRowReadings {
  readonly sprint: SprintChipReadings;
  readonly mine: MineChipReadings;
  readonly waitingOnMe: WaitingOnMeChipReadings;
  /** One entry per Active sprint, for `perSprintChips`. */
  readonly perSprint: readonly PerSprintChipReadings[];
}

/**
 * The reader's identity as the `Mine` chip's label names it: `hostUser` only.
 *
 * `gitEmail` is deliberately not a fallback here: `isMine`'s ownership match
 * (`ownership.ts`'s `comparableLogin`) never compares a host login to an
 * email, by design — "two spellings of one person, and nothing here bridges
 * them". A label built from `gitEmail` would name an identity `hiddenCount`
 * can never match against, so the chip would enable while filtering nothing.
 *
 * @param reader - who is reading.
 * @returns the identity text, or `''` where `hostUser` is absent or blank.
 */
const identityOf = (reader: Reader): string => reader.hostUser?.trim() || '';

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
  const hiddenCount = readings.visibleRows.filter((row) => !row.inSprint).length;
  return { label: 'This sprint', on: readings.on, hiddenCount, disabledReason: null };
};

/**
 * The `Mine` chip: carries the reader's identity in its label, disabled with
 * no `hostUser` to match against.
 *
 * A reader carrying only `gitEmail` is still reported as having no identity
 * here — `identityOf` reads `hostUser` alone, for the reason `isMine` never
 * matches an email. The reason names that case specifically where it applies,
 * rather than reusing the "nothing configured" wording for a reader the board
 * does in fact know something about.
 *
 * @param readings - who is reading, the chip's state, and the rows it would act on.
 * @returns the chip.
 */
const mineChip = (readings: MineChipReadings): Chip => {
  const identity = identityOf(readings.reader);
  if (identity === '') {
    const disabledReason = readings.reader.gitEmail?.trim()
      ? 'No host login configured — gitEmail cannot be matched to a PR or ticket author.'
      : 'No identity configured — set hostUser or gitEmail.';
    return { label: 'Mine', on: false, hiddenCount: 0, disabledReason };
  }
  const label = `Mine (${identity})`;
  const hiddenCount = readings.visibleRows.filter((row) => !isMine(row, readings.reader)).length;
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
 * One Active sprint's own chip: on when selected, its hidden count answering
 * what toggling THIS sprint alone would hide or show — never disabled, since
 * an Active sprint is always available to filter by.
 *
 * @param readings - the sprint's identity, selection state, and the rows it would act on.
 * @returns the chip.
 */
const perSprintChip = (readings: PerSprintChipReadings): Chip => {
  const hiddenCount = readings.visibleRows.filter((row) => !row.inSprint).length;
  return { label: readings.title, on: readings.on, hiddenCount, disabledReason: null };
};

/**
 * The Delivery tab's chip row: one chip each for `This sprint`, `Mine` and
 * `Waiting on me`, plus one per Active sprint — decided from readings rather
 * than rendered live by the component (root `CLAUDE.md`, "Every rendered
 * state is a domain property").
 *
 * @param readings - what each chip needs, grouped per chip.
 * @returns the fixed chips and the per-sprint chips, in display order.
 */
export const chipRow = (readings: ChipRowReadings): ChipRow => ({
  thisSprint: sprintChip(readings.sprint),
  mine: mineChip(readings.mine),
  waitingOnMe: waitingOnMeChip(readings.waitingOnMe),
  perSprint: readings.perSprint.map(perSprintChip),
});
