import {
  boundSecondsOf,
  deliveryRowForms,
  groupHeader,
  identityWasDeclared,
  type AgentRowFacts,
  type DeliveryPlacement,
  type DeliveryRowForms,
  type DeliverySwitches,
  type ItemPlacement,
  type ItemAgentFacts,
  type ItemRowFacts,
} from '@plot-pm/domain';
import { resolvePerson } from '@plot-pm/domain/entities/person';
import { unnamedDeskLabel } from '@plot-pm/domain/rules/desk-manifest';
import { isLiveState, type AgentRow } from '../../../contract/schema.js';
import { agentLabel, ciOf, reviewOf, type DeliveryMapping } from './delivery-readings.js';

const youngest = (values: readonly (number | null | undefined)[]): number | undefined => {
  const known = values.filter((v): v is number => typeof v === 'number');
  return known.length === 0 ? undefined : Math.min(...known);
};

const openPr = (rows: readonly AgentRow[]): AgentRow | undefined =>
  rows.find((r) => r.pr !== null && r.state !== 'merged' && r.pr.state !== 'closed' && r.pr.open !== false);

/** The person a plan or row names, as written: the assignee, else the approver, else the author. */
const ownerOf = (rows: readonly AgentRow[], draft: { assignee: string; approver: string; author: string } | undefined): string => {
  for (const source of [...rows, ...(draft === undefined ? [] : [draft])]) {
    const name = source.assignee || source.approver || source.author;
    if (name) return name;
  }
  return '';
};

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
  const blockedBy = rows.find((r) => r.blockedBy !== null && r.blockedBy !== undefined)?.blockedBy;
  if (blockedBy !== undefined && blockedBy !== null) facts.waitsOn = blockedBy;
  else if (reading?.waitsOn !== undefined) facts.waitsOn = reading.waitsOn;
  if (reading?.phase === 'draft' || reading?.phase === 'design') facts.phase = reading.phase;
  if (reading?.approvalOwed !== undefined) facts.approvalOwed = reading.approvalOwed;
  const owner = ownerOf(rows, draft);
  if (owner !== '') {
    const person = resolvePerson(owner, mapping.directory ?? {});
    facts.person = person.handle;
    if (person.displayName !== '') facts.personName = person.displayName;
  }
  const aheads = rows.map((r) => r.localAhead).filter((n): n is number => typeof n === 'number' && n > 0);
  if (aheads.length > 0) facts.unpushed = Math.max(...aheads);
  const asked = rows.find((r) => r.question !== null && r.question !== undefined);
  if (asked !== undefined) facts.question = asked.branch;
  const age = youngest(rows.map((r) => r.ageMinutes));
  if (age !== undefined) facts.ageMinutes = age;
  const merged = rows.filter((r) => r.state === 'merged' && r.pr !== null).map((r) => r.pr!.number);
  if (merged.length > 0) facts.mergedPrs = merged;
  const agents = mapping.readings.agents.filter((a) => a.actsOn === id).map((a): ItemAgentFacts => {
    const attempt = mapping.runsById[a.id]?.attempt;
    return {
      id: a.id,
      role: a.role,
      name: agentLabel(a.id, mapping.agentsById[a.id] ?? null),
      ...(attempt === undefined ? {} : { attempt }),
    };
  });
  if (agents.length > 0) facts.agents = agents;
  return facts;
};

/** The item row of an item id, for the name an agent's Acting on cell shows. */
const itemNameOf = (mapping: DeliveryMapping, itemId: string | null): string | undefined => {
  if (itemId === null) return undefined;
  const first = (mapping.rowsByItem[itemId] ?? [])[0];
  return first === undefined ? undefined : first.wave !== '' ? first.wave : first.branch || undefined;
};

/**
 * The names and readings one agent's Fleet row is built from, read from its
 * registry entry or state-file run and the payload row of its branch or PR.
 *
 * A reading the payload does not carry stays absent: the cell it feeds is then
 * `null` or shorter, never a default word.
 *
 * @param mapping - the readings and the registry entries by agent id.
 * @param id - the agent's id.
 * @param now - epoch milliseconds the Time left cell is measured at.
 */
export const agentRowFactsOf = (mapping: DeliveryMapping, id: string, now?: number): AgentRowFacts => {
  const entry = mapping.agentsById[id];
  const run = mapping.runsById[id];
  const facts: AgentRowFacts = { rateLimit: mapping.rateLimit };
  if (run?.attempt !== undefined) facts.fixerAttempt = run.attempt;
  if (entry !== undefined && !identityWasDeclared(entry)) {
    facts.unnamedDesk = unnamedDeskLabel({ checkout: entry.checkout ?? '', live: isLiveState(entry.state) });
  }
  const reading = mapping.readings.agents.find((a) => a.id === id);
  if (reading !== undefined) {
    if (reading.process !== undefined) facts.running = reading.process === 'running';
    facts.startedAt = reading.startedAt ?? null;
    facts.boundSeconds = boundSecondsOf(reading.role, mapping.bounds);
    if (now !== undefined) facts.now = now;
  }
  if (entry?.lastRun !== undefined) facts.lastRun = entry.lastRun;
  const itemName = itemNameOf(mapping, reading?.actsOn ?? null);
  if (itemName !== undefined) facts.itemName = itemName;
  const all = Object.values(mapping.rowsByItem).flat();
  const row = entry !== undefined
    ? all.find((r) => r.branch === entry.branch && entry.branch !== '')
    : run?.pr !== undefined ? all.find((r) => r.pr?.number === run.pr) : undefined;
  if (row === undefined) return facts;
  if (row.branch !== '') facts.branch = row.branch;
  if (row.question !== null && row.question !== undefined) facts.question = row.branch;
  if (row.localAhead > 0) facts.commits = row.localAhead;
  if (row.pr !== null) {
    facts.pr = { ci: ciOf(row.pr), review: reviewOf(row.pr) };
    const checks = mapping.checksUrlOf(row.planFile, row.pr.number);
    if (checks !== '') facts.pr.checksUrl = checks;
    if (row.pr.url) facts.pr.url = row.pr.url;
    if (row.pr.headSha) facts.reviewHead = row.pr.headSha.slice(0, 7);
    if (facts.pr.ci === 'failed') facts.fixerFinding = 'ci';
    else if (facts.pr.review === 'high') facts.fixerFinding = 'high';
  }
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
