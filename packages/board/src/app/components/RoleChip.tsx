import { roleChip, type AgentRole, type ChipColour } from '@plot-pm/domain';

/** The board's palette classes for each colour key the domain names. */
const COLOUR_CLASS: Readonly<Record<ChipColour, string>> = {
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
  rose: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
};

/**
 * The chip one agent's role wears. The label, colour key and accessible name
 * come from the domain's `roleChip`; this component maps the key to classes.
 *
 * @param role - the agent's role.
 */
export const RoleChip = ({ role }: { role: AgentRole }) => {
  const chip = roleChip(role);
  return (
    <span
      data-role-chip={role}
      data-chip-colour={chip.colour}
      aria-label={chip.name}
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium normal-case tracking-normal ${COLOUR_CLASS[chip.colour]}`}
    >
      {chip.label}
    </span>
  );
};
