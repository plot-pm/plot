import {
  DEFAULT_PHASE_MAP,
  ownership,
  youHeader,
  type DeliveryPlacement,
  type PhaseMap,
  type Reader,
  type ReleaseCardView,
  type YouHeader,
} from '@plot-pm/domain';
import type { PasskeyRegistration } from '@plot-pm/domain/rules/passkey-settings';
import type { AgentRow, Board, Card, StoryCard } from '../../../contract/schema.js';
import { releaseTodoEntriesOf } from './todo-list.js';
import { ownedFromCard } from './mine-filter.js';
import type { DeliveryView } from './delivery-view.js';

type WirePhaseMap = Board['phaseMap'];

/** The payload's phase map as the domain reads it; the default map where an older server sent none. */
export const phaseMapOf = (wire: WirePhaseMap | undefined): PhaseMap =>
  wire === undefined || wire.length === 0 ? DEFAULT_PHASE_MAP : (wire as unknown as PhaseMap);

export interface YouHeaderReadings {
  view: DeliveryView;
  placement: DeliveryPlacement;
  reader: Reader;
  ticketAnswer: Parameters<typeof youHeader>[0]['ticketAnswer'];
  phaseMap: WirePhaseMap | undefined;
  /** The live stories: the Draft and Active lanes. */
  stories: readonly StoryCard[];
  cards: readonly Card[];
  /** The release cards; the header counts the approvals they owe, as the to-do list does. Absent reads as none. */
  releases?: readonly ReleaseCardView[];
  /** The rows the release cards bind, by `rowId`; absent reads as none read. */
  releaseRows?: Readonly<Record<string, AgentRow>>;
  /** The passkey registration answer; `null` or absent while unread. */
  passkey?: PasskeyRegistration | null;
}

/** The You header the Delivery tab renders: the domain's counts over the payload's readings. */
export const youHeaderOf = (r: YouHeaderReadings): YouHeader => {
  const you = r.view.sections.find((s) => s.key === 'you');
  const planOf = (item: { draft: { plan: string } | null; rows: readonly { plan: string }[] }): string =>
    item.draft?.plan ?? item.rows[0]?.plan ?? '';
  const items = (you === undefined ? [] : r.view.sections.flatMap((s) => s.groups.flatMap((g) => g.items)));
  const anchorOf = (slug: string): string | null => items.find((i) => planOf(i) === slug)?.anchor ?? null;
  return youHeader({
    groups: you?.groups.map((g) => ({ key: g.key, count: g.count })) ?? [],
    tickets: r.placement.tickets,
    ticketAnswer: r.ticketAnswer,
    map: phaseMapOf(r.phaseMap),
    stories: r.stories.map((s) => ({
      status: s.status,
      plans: s.plans.length,
      ownership: ownership({ kind: 'story', author: s.author }, r.reader),
    })),
    plans: r.cards.map((c) => ({
      phase: c.phase,
      ownership: ownership(ownedFromCard(c), r.reader),
      anchor: anchorOf(c.slug),
    })),
    releases: releaseTodoEntriesOf(r.releases ?? [], r.releaseRows ?? {}, r.passkey ?? null),
  });
};
