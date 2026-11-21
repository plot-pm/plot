import { deliveryHeader, placeDelivery, type DeliveryHeader, type PlanIndex } from '@plot-pm/domain';
import { FLEET_CONTROLS_DEFAULT, type Fleet, type FleetSprint, type Slice } from '../../../contract/schema.js';
import { deliveryMapping, type DeliveryMapInput } from './delivery-readings.js';
import { itemRowFactsOf, switchesOf } from './delivery-row-facts.js';
import { deliveryView, type DeliveryViewScope } from './delivery-view.js';
import { hostAnswer, issueNote } from './host-notes.js';
import { releaseTodoEntriesOf } from './todo-list.js';
import { youHeaderOf, type YouHeaderReadings } from './you-header.js';

/** What the header reads beside the mapping input: the fleet payload, the You header's readings and the view's scope. */
export interface DeliveryHeaderReadings extends Omit<YouHeaderReadings, 'view' | 'placement' | 'ticketAnswer'> {
  /** The tab's mapping input. Its rows are the scope's rows; its agents and mode are replaced. */
  mappingInput: DeliveryMapInput;
  fleet: Pick<Fleet, 'agents' | 'supervisor' | 'fleetControls' | 'autoReview' | 'machine' | 'prAgeSeconds' | 'prError'
    | 'issueAnswer' | 'issueError' | 'prNextInSeconds' | 'issueAgeSeconds'>;
  slices?: Slice[];
  sprints?: readonly Pick<FleetSprint, 'slug' | 'title' | 'release' | 'ownerHandle' | 'members'>[];
  scope?: DeliveryViewScope;
  now?: Date;
  planIndex?: PlanIndex;
}

/**
 * The Delivery tab header's facts: `deliveryHeader` over a placement that ignores Mine.
 *
 * The placement reads `mappingInput` with every agent of `fleet.agents` and mode `all`, so the
 * reader's Mine mode changes no fact. The scope narrows You and Work items through
 * `mappingInput.rows`; Fleet and Machine read the whole machine.
 *
 * @param r - the mapping input, the fleet payload, and the You header's readings.
 * @returns the four groups.
 */
export const deliveryHeaderOf = (r: DeliveryHeaderReadings): DeliveryHeader => {
  const mapping = deliveryMapping({ ...r.mappingInput, agents: r.fleet.agents ?? [], mode: 'all' });
  const placement = placeDelivery(mapping.readings, mapping.input);
  const view = deliveryView(mapping, placement, r.slices, r.sprints, r.scope, r.now, r.planIndex);
  const you = youHeaderOf({ ...r, view, placement, ticketAnswer: r.fleet.issueAnswer ?? null });
  const section = (key: string) => view.sections.find((s) => s.key === key);
  const agesOf = (key: string) =>
    section(key)?.groups.flatMap((g) => g.items.map((v) => itemRowFactsOf(mapping, v.placement?.id ?? '').ageMinutes)) ?? [];
  const switches = switchesOf(r.fleet);
  const controls = r.fleet.fleetControls;
  return deliveryHeader({
    you: {
      counts: you.counts,
      ages: agesOf('you'),
      releases: releaseTodoEntriesOf(r.releases ?? [], r.releaseRows ?? {}, r.passkey ?? null),
      ticketNote: issueNote(r.fleet),
    },
    work: { groups: section('work-items')?.groups.map((g) => ({ key: g.key, count: g.count })) ?? [], ages: agesOf('work-items') },
    unplaced: placement.unplaced,
    agents: placement.agents,
    supervisor: r.fleet.supervisor ?? null,
    switches: {
      dispatch: (controls ?? FLEET_CONTROLS_DEFAULT).autoDispatch,
      review: switches.autoReview,
      verify: switches.autoVerify,
      design: switches.autoDesign,
    },
    parallelAgents: controls?.parallelAgents ?? null,
    machine: r.fleet.machine ?? null,
    hostAnswer: hostAnswer(r.fleet),
  });
};
