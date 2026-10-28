import { comparableLogin, type Reader } from './ownership.js';
import { mineCounts, mineHiddenCount, mineStrictControl, type BranchOwnedRow, type MineMode, type MineStrictControl } from './mine-mode.js';
import { rowInSprintSelection } from './sprint-selection.js';

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
  /** The hide/show-unknown control beside `Mine`, or `null` where it does not show. */
  readonly mineStrict: MineStrictControl | null;
  readonly waitingOnMe: Chip;
  /** One chip per Active sprint, in `readings.sprint.sprints`' order. */
  readonly perSprint: readonly Chip[];
}

/** One Active sprint, as its chip names it. */
export interface ActiveSprintReading {
  /** The sprint's slug, as `selected` and `membership` key it. */
  readonly slug: string;
  /** The sprint's title, shown as its chip's label. */
  readonly title: string;
}

/**
 * What `chipRow` reads for `This sprint` and for every per-sprint chip.
 *
 * Every sprint chip's on/off and hidden count is decided from these four
 * readings, so each chip answers from the same current selection.
 */
export interface SprintChipReadings {
  /** The Active sprints, in display order. Empty when no sprint is Active. */
  readonly sprints: readonly ActiveSprintReading[];
  /**
   * The reader's current selection, sanitized against `sprints`
   * (`sanitizeSelection`). Empty means the sprint filter is off.
   */
  readonly selected: readonly string[];
  /** Sprint slug to the set of plan slugs it contains. */
  readonly membership: Map<string, Set<string>>;
  /** Rows not hidden by another filter, before any sprint filter applies. */
  readonly rows: readonly { readonly kind: string; readonly plan: string }[];
}

/** What `chipRow` reads for the `Mine` chip. */
export interface MineChipReadings {
  /** Who is reading, as the ownership rule takes it. */
  readonly reader: Reader;
  /** The effective «Mine» mode. */
  readonly mode: MineMode;
  /** Rows not already hidden by another filter, before this chip's own effect, each with its branch. */
  readonly visibleRows: readonly BranchOwnedRow[];
  /**
   * Registry agents before this chip's own effect, each with its branch. The
   * sprint filter does not apply: the agent sections show every agent. An
   * agent on the branch of a row in `visibleRows` counts with that row, once.
   */
  readonly visibleAgents: readonly BranchOwnedRow[];
}

/** What `chipRow` reads for the `Waiting on me` chip. */
export interface WaitingOnMeChipReadings {
  /** Whether the filter is currently on. Always `false` while the chip is disabled. */
  readonly on: boolean;
}

/** Everything `chipRow` reads, one block per chip kind. */
export interface ChipRowReadings {
  /** Read by `This sprint` and by every per-sprint chip. */
  readonly sprint: SprintChipReadings;
  readonly mine: MineChipReadings;
  readonly waitingOnMe: WaitingOnMeChipReadings;
}

/**
 * How many of `readings.rows` a sprint selection hides.
 *
 * @param readings - the rows and the membership they are asked against.
 * @param selection - the sprint slugs to ask against; empty means every Active sprint.
 * @returns the count of rows `rowInSprintSelection` excludes.
 */
const hiddenBySelection = (readings: SprintChipReadings, selection: readonly string[]): number =>
  readings.rows.filter((row) => !rowInSprintSelection(row, [...selection], readings.membership)).length;

/**
 * The `This sprint` chip: on while any sprint is selected, disabled with no
 * sprint Active.
 *
 * On, its hidden count is the rows the current selection hides. Off, it is the
 * rows its click would hide: the click selects every Active sprint, and an
 * empty selection reads as every Active sprint.
 *
 * @param readings - the Active sprints, the selection, the membership and the rows.
 * @returns the chip.
 */
const sprintChip = (readings: SprintChipReadings): Chip => {
  if (readings.sprints.length === 0) {
    return { label: 'This sprint', on: false, hiddenCount: 0, disabledReason: 'No sprint is Active.' };
  }
  const hiddenCount = hiddenBySelection(readings, readings.selected);
  return { label: 'This sprint', on: readings.selected.length > 0, hiddenCount, disabledReason: null };
};

/**
 * One Active sprint's own chip: on while the sprint is in the selection, never
 * disabled.
 *
 * Its hidden count is the rows the selection hides with this sprint added to
 * it. On, that is the current selection, so the count equals the rows hidden
 * on screen and every chip that is on shows the same number. Off, it is the
 * rows still hidden after its click adds the sprint.
 *
 * @param readings - the Active sprints, the selection, the membership and the rows.
 * @param sprint - the sprint this chip toggles.
 * @returns the chip.
 */
const perSprintChip = (readings: SprintChipReadings, sprint: ActiveSprintReading): Chip => {
  const on = readings.selected.includes(sprint.slug);
  const selection = on ? readings.selected : [...readings.selected, sprint.slug];
  return { label: sprint.title, on, hiddenCount: hiddenBySelection(readings, selection), disabledReason: null };
};

/**
 * Why the `Mine` chip is disabled, naming `hostUser` as the fix.
 *
 * @param reader - a reader with no comparable host login.
 * @returns the reason for an email-shaped `hostUser`, for a `gitEmail`-only
 *   reader, or for a reader with neither.
 */
export const mineDisabledReason = (reader: Reader): string => {
  if (reader.hostUser?.trim()) {
    return 'hostUser is an email, not a host login — set hostUser to the host login.';
  }
  if (reader.gitEmail?.trim()) {
    return 'No host login configured — gitEmail cannot be matched to a PR or ticket author; set hostUser.';
  }
  return 'No identity configured — set hostUser.';
};

/**
 * The `Mine` chip: carries the reader's host login in its label, disabled
 * where no comparable host login exists.
 *
 * The label reads `comparableLogin`, the login `isMine`/`isMineStrict` match
 * against, so a blank `hostUser`, an email-shaped `hostUser` and a
 * `gitEmail`-only reader all disable the chip: neither rule can match them to
 * a row's owner. Each reason names `hostUser` as the fix.
 *
 * In `mine-and-unknown` mode, `hiddenCount` counts the branches somebody else
 * owns. In `mine` mode it also counts the branches with no known owner, so the
 * number names everything the filter hides. A branch counts once, whether its
 * row, its agent or both answer (`mineCounts`).
 *
 * @param readings - who is reading, the effective mode, and the rows/agents it would act on.
 * @returns the chip.
 */
const mineChip = (readings: MineChipReadings): Chip => {
  const identity = comparableLogin(readings.reader);
  if (!identity) {
    return { label: 'Mine', on: false, hiddenCount: 0, disabledReason: mineDisabledReason(readings.reader) };
  }
  const label = `Mine (${identity})`;
  const counts = mineCounts([...readings.visibleRows, ...readings.visibleAgents], readings.reader);
  return { label, on: readings.mode !== 'all', hiddenCount: mineHiddenCount(counts, readings.mode), disabledReason: null };
};

/**
 * The hide/show-unknown control beside `Mine`.
 *
 * @param readings - who is reading, the effective mode, and the rows/agents.
 * @returns the control, or `null` in `all` mode or with no unknown branch.
 */
const mineStrictChip = (readings: MineChipReadings): MineStrictControl | null =>
  mineStrictControl(readings.mode, mineCounts([...readings.visibleRows, ...readings.visibleAgents], readings.reader).unknown);

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
 * `Waiting on me`, plus one per Active sprint — decided from readings rather
 * than rendered live by the component (root `CLAUDE.md`, "Every rendered
 * state is a domain property").
 *
 * @param readings - what each chip needs, grouped per chip kind.
 * @returns the fixed chips and the per-sprint chips, in display order.
 */
export const chipRow = (readings: ChipRowReadings): ChipRow => ({
  thisSprint: sprintChip(readings.sprint),
  mine: mineChip(readings.mine),
  mineStrict: mineStrictChip(readings.mine),
  waitingOnMe: waitingOnMeChip(readings.waitingOnMe),
  perSprint: readings.sprint.sprints.map((sprint) => perSprintChip(readings.sprint, sprint)),
});
