import { roleChip, type AgentRole, type ChipColour } from '@plot-pm/domain';

/** The hue class each colour key the domain names takes; `delivery.css` maps it to the theme tokens. */
const COLOUR_CLASS: Readonly<Record<ChipColour, string>> = {
  blue: 'delivery-hue-blue',
  amber: 'delivery-hue-amber',
  violet: 'delivery-hue-violet',
  emerald: 'delivery-hue-green',
  sky: 'delivery-hue-sky',
  teal: 'delivery-hue-teal',
  rose: 'delivery-hue-rose',
  orange: 'delivery-hue-orange',
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
      className={`delivery-chip normal-case tracking-normal ${COLOUR_CLASS[chip.colour]}`}
    >
      {chip.label}
    </span>
  );
};
