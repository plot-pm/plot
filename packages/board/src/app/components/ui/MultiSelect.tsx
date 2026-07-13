import * as Popover from '@radix-ui/react-popover';
import * as Checkbox from '@radix-ui/react-checkbox';
import { cn } from '../../lib/utils.js';

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Optional result count shown, muted, at the end of the option row. */
  count?: number;
}

export interface MultiSelectProps {
  /** Shown on the trigger when nothing is selected, e.g. "All sprints". */
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}

/**
 * A shadcn-flavoured multi-select built from Radix Popover + Checkbox — the one
 * filter component, instantiated for both sprints and stories. Radix carries
 * the keyboard and focus behaviour; we own the checkbox-list semantics.
 */
export function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    );
  };

  const summary = selected.length === 0 ? label : `${label.replace(/^All /, '')}: ${selected.length}`;

  const triggerClasses = cn(
    'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm',
    'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500',
    selected.length > 0 && 'border-green-500 dark:border-green-500',
  );

  return (
    <Popover.Root>
      <Popover.Trigger className={triggerClasses} aria-label={label}>
        <span>{summary}</span>
        <span aria-hidden className="text-slate-400">▾</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className={cn(
            'z-50 min-w-52 rounded-md border p-1 shadow-md',
            'border-slate-200 bg-white text-slate-800',
            'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
          )}
        >
          <ul className="max-h-72 overflow-y-auto">
            {options.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <li key={opt.value}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Checkbox.Root
                      checked={checked}
                      onCheckedChange={() => toggle(opt.value)}
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded border',
                        'border-slate-400 dark:border-slate-500',
                        'data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600',
                      )}
                    >
                      <Checkbox.Indicator className="text-xs leading-none text-white">✓</Checkbox.Indicator>
                    </Checkbox.Root>
                    <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                    {opt.count !== undefined && (
                      <span
                        aria-hidden
                        className="shrink-0 tabular-nums text-xs text-slate-400 dark:text-slate-500"
                      >
                        {opt.count}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded px-2 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Clear
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
