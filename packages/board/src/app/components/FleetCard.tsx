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
  idle: 'text-(--card-body)',
  working: 'delivery-text-ok',
  blocked: 'delivery-text-warn',
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
      className="delivery-card flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]"
    >
      <span data-fleet-card-state className={`font-semibold ${STATE_CLASS[card.state]}`}>{STATE_WORDS[card.state]}</span>
      <span className="delivery-text-muted flex flex-wrap gap-x-3 tabular-nums">
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
        className="delivery-text-link ml-auto"
      >
        Fleet controls ›
      </button>
    </div>
  );
}
