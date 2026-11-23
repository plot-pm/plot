import {
  deliveryHeader,
  fleetSummary,
  machineSummary,
  notPlacedSummary,
  placeDelivery,
  releaseSummary,
  ticketsSummary,
  workSummary,
  youSummary,
  type DeliveryHeader,
  type DeliverySection,
  type SummaryPart,
} from '@plot-pm/domain';
import { FLEET_CONTROLS_DEFAULT, type Fleet, type IssueRow } from '../../../contract/schema.js';
import type { DeliveryHeaderReadings } from './delivery-header.js';
import { deliveryMapping } from './delivery-readings.js';
import { itemRowFactsOf, switchesOf } from './delivery-row-facts.js';
import { deliveryView, groupAnchor, sectionHiddenCounts, type DeliveryView } from './delivery-view.js';
import { hostAnswer, issueNote } from './host-notes.js';
import { machineHealth } from './machine-health.js';
import { deliveryEmpties, hiddenByMineWords, sectionEmptyKind, type SectionEmpty } from './section-empty.js';
import { releaseTodoEntriesOf } from './todo-list.js';
import type { ScopeTickets, ScopeTicketRow } from '@plot-pm/domain/rules/scope-tickets';
import { splitTicketRows } from './waiting-view.js';
import { youHeaderOf } from './you-header.js';

/** The sections a folded header summarises: the five layout sections, Tickets and Not placed. */
export type SummarySection = DeliverySection | 'tickets' | 'not-placed';

/** One section's folded summary as the header slot renders it. */
export interface SectionSummaryView {
  /** The chips, texts, bar and circles, in the order they render; empty where `empty` is set. */
  parts: SummaryPart[];
  /** Chip key → the anchor `jump` opens; a chip with no entry is not a link. */
  anchors: Record<string, string>;
  /** `sectionEmptyKind` of the section; where set, the slot shows its mark in place of the parts. */
  empty: SectionEmpty | null;
  /** `N hidden by Mine` where the empty section names a hidden count, else `null`. */
  hidden: string | null;
}

/** What the summaries read beside the header readings: the tickets the filters keep and the fleet's waiting read. */
export interface SectionSummaryReadings extends DeliveryHeaderReadings {
  /** The mapping input as the tab passes it: its agents and mode are the reader's Mine choice. */
  fleet: DeliveryHeaderReadings['fleet'] & Partial<Pick<Fleet, 'waiting' | 'issueAbsence'>>;
  tickets?: {
    /** The tickets the Mine filter and the scope keep, *show all* open. */
    issues: readonly IssueRow[];
    /** The tickets before Mine narrowed them. */
    before: number;
    /** Whether *show all* is open, so the others count as shown rows. */
    showAll: boolean;
  };
  /** The scope's Delivered and Found groups; absent where the tab computed none, and the summary then names neither. */
  scopeTickets?: ScopeTickets<ScopeTicketRow>;
}

const view = (parts: SummaryPart[], empty: SectionEmpty | null, anchors: Record<string, string> = {}): SectionSummaryView => ({
  parts: empty === null ? parts : [],
  anchors: empty === null ? anchors : {},
  empty,
  hidden: empty?.hidden === null || empty === null ? null : hiddenByMineWords(empty.hidden),
});

const anchorsOf = (entries: readonly { key: string; anchor: string | null }[]): Record<string, string> =>
  Object.fromEntries(entries.flatMap((e) => (e.anchor === null ? [] : [[e.key, e.anchor]])));

/**
 * The header facts over the shown placement: `deliveryHeader` with the reader's Mine mode and agents.
 *
 * @param r - the readings; `mappingInput.agents` and `mappingInput.mode` are kept.
 * @returns the four groups, the view and the shown placement.
 */
const shownHeader = (r: SectionSummaryReadings) => {
  const mapping = deliveryMapping(r.mappingInput);
  const placement = placeDelivery(mapping.readings, mapping.input);
  const shown: DeliveryView = deliveryView(mapping, placement, r.slices, r.sprints, r.scope, r.now, r.planIndex);
  const you = youHeaderOf({ ...r, view: shown, placement, ticketAnswer: r.fleet.issueAnswer ?? null });
  const section = (key: string) => shown.sections.find((s) => s.key === key);
  const agesOf = (key: string) =>
    section(key)?.groups.flatMap((g) => g.items.map((v) => itemRowFactsOf(mapping, v.placement?.id ?? '').ageMinutes)) ?? [];
  const switches = switchesOf(r.fleet);
  const controls = r.fleet.fleetControls;
  const header: DeliveryHeader = deliveryHeader({
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
  return { mapping, placement, shown, you, header };
};

/**
 * The folded summary of each Delivery section, counted from the rows the sections show.
 *
 * The summaries follow the scope (through `mappingInput.rows` and `scope`) and the Mine mode
 * (through `mappingInput.mode` and `mappingInput.agents`). Release delivery reads the section's
 * header line, which Mine does not narrow. Fleet and Machine read no scope, and Machine no Mine.
 * A section that `sectionEmptyKind` calls empty shows its mark and its Mine-hidden count instead.
 *
 * @param r - the header readings with the tab's mapping input, and the tickets the filters keep.
 * @returns one summary per section.
 */
export const sectionSummariesOf = (r: SectionSummaryReadings): Record<SummarySection, SectionSummaryView> => {
  const { mapping, placement, shown, you, header } = shownHeader(r);
  const whole = r.mappingInput.mode === 'all' ? placement : placeDelivery(mapping.wholeReadings, { ...mapping.input, mine: 'off' });
  const issues = r.fleet.issueAnswer === 'answered' ? r.tickets?.issues ?? [] : [];
  const hidden = sectionHiddenCounts({
    shown: placement.items,
    whole: whole.items,
    agents: { total: r.fleet.agents?.length ?? 0, kept: r.mappingInput.agents.length },
    tickets: { before: r.tickets?.before ?? issues.length, after: issues.length },
  });
  const scope = { kind: r.scope?.kind ?? 'release', sprints: (r.scope?.sprints ?? []).map((s) => s.title || s.slug) };
  const health = machineHealth(r.fleet.machine, hostAnswer(r.fleet));
  const empties = deliveryEmpties(shown, {
    hidden,
    scope,
    mine: mapping.input.mine,
    issueAnswer: r.fleet.issueAnswer ?? null,
    issueNote: issueNote(r.fleet) ?? r.fleet.issueError ?? null,
    supervisor: r.fleet.supervisor ?? null,
    headroom: r.fleet.machine?.headroom ?? 'unmeasured',
    health,
  });
  const split = splitTicketRows(issues, placement.tickets, placement.unplaced, r.scopeTickets?.findingKeys);
  const ticketState = r.fleet.issueAnswer === 'answered' ? 'rows' : r.fleet.issueAnswer === null || r.fleet.issueAnswer === undefined ? 'unasked' : r.fleet.issueAnswer;
  const absence = r.fleet.issueAbsence ?? '';
  const ticketsEmpty = sectionEmptyKind({
    section: 'tickets',
    state: ticketState,
    // A scope group's rows keep the folded summary from reading empty, so its chips show.
    count: split.assigned.length + (r.tickets?.showAll === true ? split.others.length : 0)
      + (r.scopeTickets?.delivered.count ?? 0) + (r.scopeTickets?.found.count ?? 0),
    note: ticketState === 'failed' && absence !== '' ? absence : null,
    absence: ticketState === 'unsupported' && absence !== '' ? absence : null,
    scope,
    mine: mapping.input.mine,
    hidden: hidden.tickets,
  });
  const releaseAnchors = anchorsOf(shown.releaseHeader.counts.map((c) => ({ key: c.key, anchor: c.anchor })));
  const work = header.work.numbers.map((n) => ({ key: n.key, anchor: n.count > 0 ? groupAnchor(n.key) : null }));
  return {
    'release-delivery': view(
      releaseSummary({ bar: shown.releaseHeader.bar, blockedPlans: shown.releaseHeader.blockedPlans, counts: shown.releaseHeader.counts }),
      empties['release-delivery'],
      releaseAnchors,
    ),
    you: view(youSummary(header.you), empties.you, anchorsOf(you.counts)),
    'work-items': view(workSummary(header.work), empties['work-items'], anchorsOf(work)),
    fleet: view(fleetSummary(header.fleet), empties.fleet),
    machine: view(machineSummary(header.machine), empties.machine),
    tickets: view(
      ticketsSummary({
        state: ticketState,
        assigned: split.assigned.length,
        others: split.others.length,
        unassigned: r.scopeTickets?.noPlan?.unassigned ?? r.fleet.waiting?.unassigned ?? null,
        hidden: hidden.tickets,
        ...(r.scopeTickets === undefined ? {} : { delivered: r.scopeTickets.delivered.count, found: r.scopeTickets.found.count }),
      }),
      ticketsEmpty,
    ),
    'not-placed': view(notPlacedSummary(shown.notPlaced.length), null),
  };
};

/** The You, Work items and Fleet numbers of a summary, for the test that the header and the summaries agree. */
export const summaryCounts = (summary: SectionSummaryView): Record<string, number | null> =>
  Object.fromEntries(summary.parts.flatMap((p) => (p.kind === 'chip' ? [[p.key, p.count]] : [])));
