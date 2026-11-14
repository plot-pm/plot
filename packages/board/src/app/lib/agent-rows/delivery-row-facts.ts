import {
  deliveryRowForms,
  groupHeader,
  type AgentRowFacts,
  type DeliveryPlacement,
  type DeliveryRowForms,
  type DeliverySwitches,
  type ItemPlacement,
  type ItemRowFacts,
} from '@plot-pm/domain';
import type { AgentRow } from '../../../contract/schema.js';
import type { DeliveryMapping } from './delivery-readings.js';

const youngest = (values: readonly (number | null | undefined)[]): number | undefined => {
  const known = values.filter((v): v is number => typeof v === 'number');
  return known.length === 0 ? undefined : Math.min(...known);
};

const openPr = (rows: readonly AgentRow[]): AgentRow | undefined =>
  rows.find((r) => r.pr !== null && r.state !== 'merged' && r.pr.state !== 'closed' && r.pr.open !== false);

/**
 * The names and numbers one work item's links point at, read from the payload rows.
 *
 * A field the payload does not state stays absent: the cell it feeds is then
 * `null`, never a default word.
 *
 * @param mapping - the readings and the payload rows each item id stands for.
 * @param id - the work item's id.
 * @returns the item's row facts.
 */
export const itemRowFactsOf = (mapping: DeliveryMapping, id: string): ItemRowFacts => {
  const rows = mapping.rowsByItem[id] ?? [];
  const first = rows[0];
  const reading = mapping.readings.items.find((i) => i.id === id);
  const draft = mapping.draftsByItem[id];
  const open = openPr(rows);
  const facts: ItemRowFacts = {};
  const plan = first?.plan || draft?.plan;
  if (plan) facts.plan = plan;
  if (first !== undefined && first.wave !== '') facts.slice = first.wave;
  const branch = open?.branch || first?.branch;
  if (branch) facts.branch = branch;
  if (open?.pr) facts.pr = open.pr.number;
  const planRow = rows.find((r) => r.kind === 'plan' && r.pr !== null);
  if (planRow?.pr) facts.planPr = planRow.pr.number;
  if (reading?.pr !== undefined) facts.prReading = reading.pr;
  if (reading?.waitsOn !== undefined) facts.waitsOn = reading.waitsOn;
  const asked = rows.find((r) => r.question !== null && r.question !== undefined);
  if (asked !== undefined) facts.question = asked.branch;
  const age = youngest(rows.map((r) => r.ageMinutes));
  if (age !== undefined) facts.ageMinutes = age;
  const merged = rows.filter((r) => r.state === 'merged' && r.pr !== null).map((r) => r.pr!.number);
  if (merged.length > 0) facts.mergedPrs = merged;
  return facts;
};

/** The minutes since an ISO timestamp, or `undefined` where it is empty or does not parse. */
const minutesSince = (iso: string, now: number): number | undefined => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.floor((now - at) / 60000));
};

/**
 * The names one agent's links point at, read from its registry entry and the row of its branch.
 *
 * @param mapping - the readings and the registry entries by agent id.
 * @param id - the agent's id.
 * @param now - the clock in milliseconds; the AGE column counts from the entry's `startedAt`.
 */
export const agentRowFactsOf = (mapping: DeliveryMapping, id: string, now: number): AgentRowFacts => {
  const entry = mapping.agentsById[id];
  const facts: AgentRowFacts = {};
  if (entry === undefined) return facts;
  const rows = Object.values(mapping.rowsByItem).flat().filter((r) => r.branch === entry.branch && entry.branch !== '');
  const asked = rows.find((r) => r.question !== null && r.question !== undefined);
  if (asked !== undefined) facts.question = asked.branch;
  const age = minutesSince(entry.startedAt, now);
  if (age !== undefined) facts.ageMinutes = age;
  return facts;
};

/** Every row's cells for one placement: the work-item and agent forms the tab renders. */
export const rowFormsOf = (mapping: DeliveryMapping, placement: DeliveryPlacement, now: number): DeliveryRowForms =>
  deliveryRowForms(
    placement,
    (id) => itemRowFactsOf(mapping, id),
    (id) => agentRowFactsOf(mapping, id, now),
  );

/** The four switches as the fleet payload carried them; a switch the payload did not state reads on, so no group claims to be held by it. */
export const switchesOf = (fleet: {
  autoReview?: boolean | undefined;
  fleetControls?: { autoDispatch?: boolean | undefined; autoReview?: boolean | undefined; autoVerify?: boolean | undefined; autoDesign?: boolean | undefined } | undefined;
}): DeliverySwitches => ({
  autoDispatch: fleet.fleetControls?.autoDispatch ?? true,
  autoReview: fleet.fleetControls?.autoReview ?? fleet.autoReview ?? true,
  autoVerify: fleet.fleetControls?.autoVerify ?? true,
  autoDesign: fleet.fleetControls?.autoDesign ?? true,
});

/** The header text of one group, with the switches that hold it back named. */
export const headerOf = (
  label: string,
  section: Parameters<typeof groupHeader>[1],
  group: string,
  placements: readonly (ItemPlacement | null)[],
  switches: DeliverySwitches,
) => groupHeader(label, section, group, placements.filter((p): p is ItemPlacement => p !== null), switches);
