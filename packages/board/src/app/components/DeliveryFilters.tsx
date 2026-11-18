import { chipRow, type Chip, type ChipRowReadings } from '@plot-pm/domain/rules/chip-row';
import type { FleetSprint, SprintCounts } from '../../contract/schema.js';
import { MineStrictToggle } from './MineStrictToggle.js';

/**
 * The Delivery tab's filter row: one chip row (`My sprint`, `Mine`,
 * `Waiting on me`) and the estate totals.
 *
 * Replaces the two-card, two-style control `SprintFilter` + the `Only my
 * work` checkbox used to split across — three controls in three visual
 * styles, per issue #2080. Every chip's label/on/hiddenCount/disabledReason is
 * read from `chipRow()` (`@plot-pm/domain`), not decided here: this component
 * only renders what the rule returns (root `CLAUDE.md`, "Every rendered state
 * is a domain property").
 */
interface DeliveryFiltersProps {
  /** What `chipRow` needs to decide the three chips. */
  readings: ChipRowReadings;
  /** Toggle the `My sprint` chip. */
  onToggleSprint: () => void;
  /** Toggle the `Mine` chip. */
  onToggleMine: () => void;
  /** Toggle the hide/show-unknown control beside `Mine`; `chipRow()` decides whether it shows. */
  onToggleStrict: () => void;
  /** The Active sprints the reader owns (`deliveryScope`'s `owned`), one per-sprint chip each. */
  sprints: FleetSprint[];
  /**
   * The scope's selection (`deliveryScope`'s `selection`), which never names a
   * sprint absent from `sprints`. Empty means the toggle is off. Decides the
   * per-sprint chips' own `on` state and the «My sprint» chip's label.
   */
  selectedSprints: string[];
  /** Toggle one sprint in the selection — a per-sprint chip's own click. */
  onToggleSprintSlug: (slug: string) => void;
  /**
   * Whether the board has answered the `Mine` chip's identity question yet.
   * `chipRow`'s `disabledReason` does not distinguish "asked, found nobody"
   * from "not asked yet" — `server` arrives on a separate, slower fetch than
   * `fleet`, so this gates ONLY whether the reason is shown yet, matching the
   * old control's `!known && boardAnswered` timing exactly.
   */
  mineBoardAnswered: boolean;
  /** Estate-wide totals, shown at the right end of the chip row. */
  estateTotals?: SprintCounts;
}

/**
 * Format counts as a compact string: `<total> <unit> · <open> open · <wip>
 * WIP · <done> done · <withdrawn> withdrawn`.
 *
 * All four bucket counts are shown, even when zero — the shape is the point,
 * and hiding zeros would make the total harder to verify by eye.
 */
function formatCounts(counts: SprintCounts, unit: string): string {
  return `${counts.total} ${unit} · ${counts.open} open · ${counts.wip} WIP`
    + ` · ${counts.done} done · ${counts.withdrawn} withdrawn`;
}

/**
 * One chip: filled when on, outlined when off, dimmed with a tooltip when
 * disabled.
 *
 * `dataChip` and `label` are separate: the «My sprint» chip's `data-chip` is
 * `"My sprint"` also while its visible label names a sprint, and a per-sprint
 * chip's is `sprint:<slug>`. Every other chip leaves `dataChip` unset and the
 * attribute falls back to the label.
 */
function ChipView({
  chip, dataChip, onToggle, showDisabledReason = true,
}: { chip: Chip; dataChip?: string; onToggle: () => void; showDisabledReason?: boolean }) {
  const disabled = chip.disabledReason !== null;
  return (
    <button
      type="button"
      data-chip={dataChip ?? chip.label}
      data-chip-on={chip.on ? '1' : '0'}
      disabled={disabled}
      onClick={onToggle}
      title={disabled && showDisabledReason ? chip.disabledReason ?? undefined : undefined}
      className={`shrink rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        disabled
          ? 'cursor-not-allowed border-slate-200 text-slate-400 opacity-50 dark:border-slate-700 dark:text-slate-500'
          : chip.on
            ? 'border-green-600 bg-green-600 text-white dark:border-green-500 dark:bg-green-600'
            : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {chip.label}
      {!disabled && chip.on && (
        <span className="ml-1 font-normal opacity-90">
          {chip.hiddenCount === 1 ? '1 hidden' : `${chip.hiddenCount} hidden`}
        </span>
      )}
    </button>
  );
}

export function DeliveryFilters({
  readings,
  onToggleSprint,
  onToggleMine,
  onToggleStrict,
  sprints,
  selectedSprints,
  onToggleSprintSlug,
  mineBoardAnswered,
  estateTotals,
}: DeliveryFiltersProps) {
  const chips = chipRow(readings);

  // THE «My sprint» CHIP NAMES THE SPRINT when exactly one is selected —
  // the rest of its label (on/off, hidden count) is still `chipRow()`'s
  // answer; only the text that says WHICH sprint is decided here, from the
  // selection the component already carries for the per-sprint chips below.
  const selectedOne = selectedSprints.length === 1
    ? sprints.find((s) => s.slug === selectedSprints[0])
    : undefined;
  const mySprintChip = selectedOne
    ? { ...chips.mySprint, label: `My sprint: ${selectedOne.title}` }
    : chips.mySprint;

  // ONE CHIP PER OWNED ACTIVE SPRINT, BESIDE «My sprint» — only while the
  // reader owns more than one (Decision "Sprint line as control or chip row":
  // the chip row stays the one control surface, #2080). They narrow the
  // scope while the toggle is on.
  //
  // EACH CHIP COMES FROM `chipRow()`, not from an object built here (root
  // `CLAUDE.md`, "Every rendered state is a domain property"). Matched to
  // `sprints` by ARRAY POSITION: `chipRow()` returns one chip per entry of
  // `readings.sprint.sprints`, which `chipReadings` builds from the SAME
  // owned sprints `AgentList.tsx` passes as this `sprints` prop.
  const perSprintChips = sprints.length > 1 ? chips.perSprint : [];

  return (
    <div data-delivery-filters className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <ChipView chip={mySprintChip} dataChip="My sprint" onToggle={onToggleSprint} />
        {perSprintChips.map((chip, index) => {
          const sprint = sprints[index];
          return (
            <ChipView
              key={sprint.slug}
              dataChip={`sprint:${sprint.slug}`}
              chip={chip}
              onToggle={() => onToggleSprintSlug(sprint.slug)}
            />
          );
        })}
        <ChipView chip={chips.mine} onToggle={onToggleMine} showDisabledReason={mineBoardAnswered} />
        <MineStrictToggle control={chips.mineStrict} onToggle={onToggleStrict} />
        <ChipView chip={chips.waitingOnMe} onToggle={() => {}} />
        {estateTotals && (
          <span data-estate-totals className="ml-auto min-w-0 text-xs text-slate-500 dark:text-slate-400">
            {formatCounts(estateTotals, 'plans')}
          </span>
        )}
      </div>
    </div>
  );
}
