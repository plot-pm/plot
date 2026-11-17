import { fleetCard, type FleetCardState } from '@plot-pm/domain/rules/fleet-card';
import type { FleetGroup } from '@plot-pm/domain/rules/delivery-placement';
import { AutoDispatchSwitch, AutoSwitch, ParallelAgentsStepper } from './FleetControls.js';

/** The switch values the card shows; the same values the Fleet body renders. */
export interface FleetCardSwitches {
  autoDispatch: boolean;
  autoReview: boolean;
  autoVerify: boolean;
  autoDesign: boolean;
  parallelAgents: number;
}

const STATE_WORDS: Record<FleetCardState, string> = {
  idle: 'Fleet idle',
  working: 'Fleet working',
  blocked: 'Fleet blocked',
};

const STATE_CLASS: Record<FleetCardState, string> = {
  idle: 'text-slate-600 dark:text-slate-300',
  working: 'text-emerald-700 dark:text-emerald-400',
  blocked: 'text-amber-700 dark:text-amber-500',
};

/**
 * The Delivery tab header's fleet card: the fleet's state, one count per agent
 * group, the fleet switches read-only, and a link to the Fleet section.
 *
 * The state and counts come from `fleetCard`; the switches are the Fleet body's
 * own components in read-only mode and write nothing.
 */
export function FleetCard({
  agents,
  switches,
  onJump,
}: {
  agents: readonly { group: FleetGroup }[];
  switches: FleetCardSwitches;
  onJump: (anchor: string) => void;
}) {
  const card = fleetCard(agents);
  return (
    <div
      data-fleet-card={card.state}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/40"
    >
      <span data-fleet-card-state className={`font-semibold ${STATE_CLASS[card.state]}`}>{STATE_WORDS[card.state]}</span>
      <span className="flex flex-wrap gap-x-3 text-slate-500 tabular-nums dark:text-slate-400">
        <span data-fleet-card-count="free">free {card.free}</span>
        <span data-fleet-card-count="working">working {card.working}</span>
        <span data-fleet-card-count="blocked">blocked {card.blocked}</span>
      </span>
      <span data-fleet-card-switches className="flex flex-wrap items-center gap-3">
        <AutoDispatchSwitch value={switches.autoDispatch} readOnly />
        <AutoSwitch name="autoReview" value={switches.autoReview} readOnly />
        <AutoSwitch name="autoVerify" value={switches.autoVerify} readOnly />
        <AutoSwitch name="autoDesign" value={switches.autoDesign} readOnly />
        <ParallelAgentsStepper value={switches.parallelAgents} readOnly />
      </span>
      <button
        type="button"
        data-fleet-card-link
        onClick={() => onJump('fleet-controls')}
        className="ml-auto text-blue-600 hover:underline dark:text-blue-400"
      >
        Fleet controls ›
      </button>
    </div>
  );
}
