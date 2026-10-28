import type { MineStrictControl } from '@plot-pm/domain';

/**
 * The hide/show-unknown control beside «Mine». Renders `mineStrictControl()`'s
 * answer and decides nothing: `null` renders nothing.
 */
export const MineStrictToggle = ({
  control,
  onToggle,
}: {
  control: MineStrictControl | null;
  onToggle: () => void;
}) =>
  control && (
    <button
      type="button"
      data-mine-strict-toggle
      data-mine-strict-on={control.pressed ? '1' : '0'}
      aria-pressed={control.pressed}
      onClick={onToggle}
      className="text-xs text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
    >
      {control.label}
    </button>
  );
