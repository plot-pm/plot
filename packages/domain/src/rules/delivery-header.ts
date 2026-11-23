import type { FleetGroup } from './delivery-placement.js';
import { oldestWaitsClause } from './delivery-work-columns.js';
import { fleetCard } from './fleet-card.js';
import { fleetPace, type AgentPace } from './delivery-row-form.js';
import {
  HOST_ANSWER_HINT,
  LOW_BUDGET_SHARE,
  SPLIT_BUCKETS,
  bucketLabel,
  type HostAnswer,
  type MachineBudget,
  type MachineHeadroom,
  type MachineReading,
} from './machine-health.js';
import type { SupervisorWireState } from './supervisor-reading.js';

/** How a header group reads: its numbers, its clear sentence, a reading it lacks, or a stopped fleet. */
export type HeaderKind = 'counts' | 'clear' | 'unread' | 'stopped';

/** The colour of a header number or meter. `plain` carries no state colour. */
export type HeaderTone = 'red' | 'amber' | 'grey' | 'green' | 'plain';

/** One number of a header group and the words after it. */
export interface HeaderNumber {
  key: string;
  count: number;
  words: string;
  tone: HeaderTone;
}

/** The amber clause for the entries `placeDelivery` could not read: `! 2 not read`. */
export interface HeaderUnread {
  count: number;
  text: string;
}

/** What every header group carries. */
export interface HeaderGroupBase {
  /** The `DELIVERY_LAYOUT` section the group's "open ›" opens. */
  section: 'you' | 'work-items' | 'fleet' | 'machine';
  label: string;
  kind: HeaderKind;
  /** The clear sentence; `null` unless `kind` is `clear`. */
  clear: string | null;
  /** The not-read clause; `null` where nothing is unread. */
  unread: HeaderUnread | null;
}

/** A release approval the You group names as a grey line, because it cannot run now. */
export interface HeaderReleaseWait {
  label: string;
  reason: string;
}

export interface YouHeaderGroup extends HeaderGroupBase {
  section: 'you';
  /** Blocks delivery (red), input (amber), unblock (grey). */
  numbers: HeaderNumber[];
  /** `oldest waits 2h`, or `null` where no You item has an age. */
  oldest: string | null;
  /** The triage count: `null` while the tracker has not answered. `text` reads `tickets unread` then, and `note` names the age of the last good rows where known. */
  tickets: { count: number | null; text: string; note: string | null };
  /** The release approvals that cannot run, each with its reason. */
  releases: HeaderReleaseWait[];
}

export interface WorkHeaderGroup extends HeaderGroupBase {
  section: 'work-items';
  /** At a gate, being built, queued. */
  numbers: HeaderNumber[];
  oldest: string | null;
}

/** One read-only switch mark: `✓ dispatch` or `– verify`. */
export interface HeaderMark {
  key: 'dispatch' | 'review' | 'verify' | 'design';
  on: boolean;
  text: string;
}

export interface FleetHeaderGroup extends HeaderGroupBase {
  section: 'fleet';
  /** One circle per placed agent: working first, then blocked, then free. */
  circles: FleetGroup[];
  /** `2 working · 1 blocked · 1 free`; `null` where `status` names a fleet with no placed agent. */
  line: string | null;
  /** The supervisor's sentence where it is not a fresh `up`: `fleet stopped`, `fleet state unknown`, `fleet not read yet` or the verdict's label. */
  status: string | null;
  marks: HeaderMark[];
  /** The parallel-agents value as text: `parallel 3`, or `parallel —` where unread. */
  parallel: string;
  /** The spinner beside the label: the fastest pace of the working agents, `null` where none works. */
  pace: AgentPace | null;
}

/** One Machine meter: a share of its capacity in use, or `null` with the reason in `text`. */
export interface HeaderMeter {
  key: string;
  label: string;
  /** Used share, 0..1; `null` where unmeasured or unread. */
  share: number | null;
  text: string;
  tone: HeaderTone;
}

export interface MachineHeaderGroup extends HeaderGroupBase {
  section: 'machine';
  meters: HeaderMeter[];
}

export interface DeliveryHeader {
  you: YouHeaderGroup;
  work: WorkHeaderGroup;
  fleet: FleetHeaderGroup;
  machine: MachineHeaderGroup;
}

/** The supervisor verdict's fields the header reads. */
export interface HeaderSupervisor {
  state: SupervisorWireState;
  label: string;
  /** The verdict's `shown`: true for an `up` whose tick is stale. */
  shown: boolean;
}

export interface DeliveryHeaderInput {
  you: {
    /** `youHeader`'s counts: `blocks-delivery`, `input-to-the-fleet`, `unblock` and `tickets`. */
    counts: readonly { key: string; count: number | null }[];
    /** The wait in minutes of each You item; `null` where unread. */
    ages: readonly (number | null | undefined)[];
    /** The release approvals the cards owe (`releaseTodoEntries`). */
    releases: readonly { label: string; blocks: boolean; reason: string }[];
    /** The age of the last good ticket rows as a sentence (`issueNote`), or `null`. */
    ticketNote: string | null;
  };
  work: {
    /** The Work items groups and their counts. */
    groups: readonly { key: string; count: number }[];
    ages: readonly (number | null | undefined)[];
  };
  /** `placeDelivery`'s unplaced entries. */
  unplaced: readonly { subject: 'item' | 'agent'; reason: string }[];
  /** `placeDelivery`'s placed agents, each with its `agentPace`; an absent pace reads as no spinner. */
  agents: readonly { group: FleetGroup; pace?: AgentPace | null }[];
  /** `fleet.supervisor`; `null` where the payload carries none. */
  supervisor: HeaderSupervisor | null;
  switches: { dispatch: boolean; review: boolean; verify: boolean; design: boolean };
  /** The parallel-agents value; `null` where unread. */
  parallelAgents: number | null;
  machine: MachineReading | null;
  hostAnswer: HostAnswer;
}

const YOU_NUMBERS: ReadonlyArray<readonly [string, string, HeaderTone]> = [
  ['blocks-delivery', 'blocks delivery', 'red'],
  ['input-to-the-fleet', 'input', 'amber'],
  ['unblock', 'unblock', 'grey'],
];

const WORK_NUMBERS: ReadonlyArray<readonly [string, string]> = [
  ['at-a-gate', 'at a gate'],
  ['being-built', 'being built'],
  ['queued', 'queued'],
];

const MARK_KEYS: ReadonlyArray<HeaderMark['key']> = ['dispatch', 'review', 'verify', 'design'];

const CIRCLE_ORDER: readonly FleetGroup[] = ['working', 'blocked', 'free'];

const HEADROOM_TONE: Readonly<Record<MachineHeadroom, HeaderTone>> = {
  clear: 'green',
  tight: 'amber',
  starved: 'red',
  unmeasured: 'grey',
};

const unreadOf = (count: number): HeaderUnread | null => (count === 0 ? null : { count, text: `! ${count} not read` });

const unreadCount = (input: DeliveryHeaderInput, subject: 'item' | 'agent'): number =>
  input.unplaced.filter((u) => u.subject === subject && u.reason === 'unread').length;

const youGroup = (input: DeliveryHeaderInput): YouHeaderGroup => {
  const countOf = (key: string): number | null => input.you.counts.find((c) => c.key === key)?.count ?? null;
  const numbers = YOU_NUMBERS.map(([key, words, tone]) => ({ key, count: countOf(key) ?? 0, words, tone }));
  const tickets = countOf('tickets');
  const unread = unreadOf(unreadCount(input, 'item'));
  const kind: HeaderKind = unread !== null || tickets === null ? 'unread'
    : numbers.every((n) => n.count === 0) && tickets === 0 ? 'clear' : 'counts';
  return {
    section: 'you',
    label: 'You',
    kind,
    clear: kind === 'clear' ? '✓ nothing waits on you' : null,
    unread,
    numbers,
    oldest: oldestWaitsClause(input.you.ages),
    tickets: {
      count: tickets,
      text: tickets === null ? 'tickets unread' : `${tickets} tickets need triage`,
      note: tickets === null ? input.you.ticketNote : null,
    },
    releases: input.you.releases.filter((r) => !r.blocks).map((r) => ({ label: `Approve release ${r.label}`, reason: r.reason })),
  };
};

const workGroup = (input: DeliveryHeaderInput): WorkHeaderGroup => {
  const numbers = WORK_NUMBERS.map(([key, words]) => ({
    key, count: input.work.groups.find((g) => g.key === key)?.count ?? 0, words, tone: 'plain' as const,
  }));
  const unread = unreadOf(unreadCount(input, 'item'));
  const kind: HeaderKind = unread !== null ? 'unread' : numbers.every((n) => n.count === 0) ? 'clear' : 'counts';
  return {
    section: 'work-items',
    label: 'Work items',
    kind,
    clear: kind === 'clear' ? '✓ no work item waits' : null,
    unread,
    numbers,
    oldest: oldestWaitsClause(input.work.ages),
  };
};

const fleetStatus = (supervisor: HeaderSupervisor | null): { kind: HeaderKind; status: string } | null => {
  if (supervisor === null) return { kind: 'unread', status: 'fleet not read yet' };
  if (supervisor.state === 'down' || supervisor.state === 'died') return { kind: 'stopped', status: 'fleet stopped' };
  if (supervisor.state === 'unknown') return { kind: 'unread', status: 'fleet state unknown' };
  return supervisor.shown ? { kind: 'unread', status: supervisor.label } : null;
};

const fleetGroup = (input: DeliveryHeaderInput): FleetHeaderGroup => {
  const card = fleetCard(input.agents);
  const total = card.working + card.blocked + card.free;
  const unread = unreadOf(unreadCount(input, 'agent'));
  const status = fleetStatus(input.supervisor);
  const kind: HeaderKind = status?.kind ?? (unread !== null ? 'unread' : total === 0 ? 'clear' : 'counts');
  const parts = [
    `${card.working} working`,
    ...(card.blocked > 0 ? [`${card.blocked} blocked`] : []),
    `${card.free} free`,
  ];
  return {
    section: 'fleet',
    label: 'Fleet',
    kind,
    clear: kind === 'clear' ? '✓ no agent runs' : null,
    unread,
    circles: CIRCLE_ORDER.flatMap((group) => Array.from({ length: card[group] }, () => group)),
    line: status !== null && total === 0 ? null : parts.join(' · '),
    status: status?.status ?? null,
    marks: MARK_KEYS.map((key) => ({ key, on: input.switches[key], text: `${input.switches[key] ? '✓' : '–'} ${key}` })),
    parallel: `parallel ${input.parallelAgents ?? '—'}`,
    pace: fleetPace(input.agents.map((a) => a.pace)),
  };
};

const count = (n: number): string => n.toLocaleString('en-US');

const budgetMeter = (key: string, label: string, b: MachineBudget | undefined): HeaderMeter => {
  if (b === undefined || b.limit === null || b.remaining === null || b.limit <= 0) {
    return { key, label, share: null, text: `${label} not recorded`, tone: 'grey' };
  }
  const tone: HeaderTone = b.remaining === 0 ? 'red' : b.remaining <= b.limit * LOW_BUDGET_SHARE ? 'amber' : 'green';
  return { key, label, share: 1 - b.remaining / b.limit, text: `${label} ${count(b.remaining)} / ${count(b.limit)} left`, tone };
};

const hostMeters = (machine: MachineReading | null, answer: HostAnswer): HeaderMeter[] => {
  const host = machine?.host ?? null;
  if (answer === 'unasked' || answer === 'unreachable' || (host === null && answer === 'rate-limited')) {
    return [{ key: 'host', label: 'host', share: null, text: `host ${HOST_ANSWER_HINT[answer]}`, tone: answer === 'rate-limited' ? 'red' : 'grey' }];
  }
  if (host === null) return [{ key: 'host', label: 'host', share: null, text: 'host not recorded', tone: 'grey' }];
  const split = host.buckets.some((b) => SPLIT_BUCKETS.some(([word]) => word === b.bucket));
  if (split) return SPLIT_BUCKETS.map(([word, label]) => budgetMeter(word, label, host.buckets.find((b) => b.bucket === word)));
  if (host.buckets.length === 0) return [budgetMeter('api', 'API', undefined)];
  return host.buckets.map((b) => {
    const label = bucketLabel(b.bucket);
    return budgetMeter(b.bucket === '' ? 'api' : b.bucket, label === '' ? 'API' : label, b);
  });
};

const loadMeter = (m: MachineReading | null): HeaderMeter => {
  const load1 = m?.load1 ?? null;
  const cores = m?.cores ?? null;
  if (m === null || load1 === null || cores === null || cores <= 0) {
    return { key: 'load', label: 'load', share: null, text: 'load not measured', tone: 'grey' };
  }
  return { key: 'load', label: 'load', share: Math.min(1, load1 / cores), text: `load ${load1.toFixed(1)} of ${cores} cores`, tone: HEADROOM_TONE[m.headroom] };
};

const machineGroup = (input: DeliveryHeaderInput): MachineHeaderGroup => {
  const m = input.machine;
  return {
    section: 'machine',
    label: 'Machine',
    kind: m === null ? 'unread' : 'counts',
    clear: null,
    unread: null,
    meters: [loadMeter(m), ...hostMeters(m, input.hostAnswer)],
  };
};

/**
 * The Delivery tab header's four groups: You, Work items, Fleet and Machine.
 *
 * You and Work items each show their three numbers and the oldest wait. Each
 * reads `clear` where its three numbers are 0 and no item is unread; You also
 * needs a triage count of 0. An `unplaced` item with reason `unread` adds the
 * `! N not read` clause to both groups and makes them `unread`; a `null`
 * triage count makes You `unread` and reads `tickets unread`. A release
 * approval that cannot run (`blocks` false) adds nothing to the red number and
 * shows as a grey line with its reason.
 *
 * Fleet reads its kind from the supervisor first: absent reads `fleet not read
 * yet` (`unread`), `down` and `died` read `fleet stopped` (`stopped`),
 * `unknown` reads `fleet state unknown` (`unread`), and a stale `up` reads the
 * verdict's label (`unread`). A fresh `up` reads `unread` where an agent is
 * unplaced as unread, `clear` (`✓ no agent runs`) where no agent is placed, and
 * `counts` otherwise. The marks show in every kind.
 *
 * Machine shows a load meter and the host's budget meters: GraphQL and REST on
 * a split host, one `API` meter on a one-pool host (bucket `''`), and one
 * `host` meter naming an unasked, unreachable or rate-limited host.
 *
 * @param input - the readings, already narrowed by the scope and not by Mine.
 * @returns the four groups.
 */
export const deliveryHeader = (input: DeliveryHeaderInput): DeliveryHeader => ({
  you: youGroup(input),
  work: workGroup(input),
  fleet: fleetGroup(input),
  machine: machineGroup(input),
});
