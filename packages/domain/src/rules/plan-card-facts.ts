import { PlanStateSchema } from '../entities/card-facts.js';
import type {
  Action,
  ActionKind,
  CardFacts,
  CardPrFact,
  CostReading,
  Known,
  Reason,
  Ref,
  VerificationReading,
} from '../entities/card-facts.js';
import { resolvePerson, type PersonDirectory } from '../entities/person.js';
import type { SprintState } from '../entities/sprint.js';
import type { StoryStatus } from '../entities/story.js';
import type { CardControls } from './card-controls.js';
import { PlanTypeSchema, type PlanStatus } from './phase.js';

/** A branch of the plan, and the pull request the host reports for it. */
export interface PlanSliceBranch {
  /** The branch name. */
  branch: string;
  /** The PR number for the branch, or `null` where none is known. */
  pr: number | null;
}

/** What `planCardFacts` reads of the plan's slices. */
export interface PlanSlicesReading {
  /** How many slices the plan names. */
  total: number;
  /** How many slices the pulse reports complete; `null` where no pulse covers the plan or none was counted. */
  complete: number | null;
  /** How many open branches sit in an eligible slice; `null` where no pulse covers the plan. */
  eligible: number | null;
  /** The unmerged branches of the earliest incomplete slice, in plan order. */
  waitsOn: readonly PlanSliceBranch[];
}

/** A story the plan names, as the board read it. */
export interface PlanStoryReading {
  slug: string;
  /** The story's title; its slug where no story file exists. */
  title: string;
  /** The story's status; `null` where no story file exists. */
  status: StoryStatus | null;
  archived: boolean;
}

/** A sprint the plan names, as the board read it. */
export interface PlanSprintReading {
  slug: string;
  /** The sprint's title; its slug where no sprint file exists. */
  title: string;
  /** The sprint's state; `null` where no sprint file exists. */
  state: SprintState | null;
  /** The sprint's `Release:`, verbatim; `null` where it names none. */
  release: string | null;
}

/** The plan's dated records, verbatim; `''` where the plan has none. */
export interface PlanRecordsReading {
  designRaw: string;
  approvedRaw: string;
  startedRaw: string;
  deliveredRaw: string;
  releasedRaw: string;
}

/** What `planCardFacts` reads of one plan. */
export interface PlanCardFactsReadings {
  /** The plan's slug. */
  slug: string;
  /** The plan's title, verbatim. */
  title: string;
  /** The plan file's repository-relative path. */
  path: string;
  /** The plan's `Type:` word as the parser reports it; `''` where none is stated. */
  type: string;
  /** The plan's `Assignee:` value, comma-separated where it names several; `''` where none is stated. */
  assignee: string;
  /** The plan's `State:` as the file writes it, lowercased; `''` where it could not be read. */
  state: string;
  /** The tracker keys the plan answers, without `#`. */
  issues: readonly string[];
  /** The plan's dated records. */
  records: PlanRecordsReading;
  /** The plan's measured status. */
  status: PlanStatus;
  /** The plan's capability set from `cardControls`. */
  controls: CardControls;
  /** Whether the plan's status is `deliverable` or `proven`. */
  deliverable: boolean;
  /** The recorded interrogation rounds; `null` where none is recorded. */
  rounds: number | null;
  /** The plan's slices; `null` where the plan names none. */
  slices: PlanSlicesReading | null;
  /** The spike branch; `null` where the plan names no spike. */
  spike: PlanSliceBranch | null;
  /** The plan's pull requests with their build readings. */
  prs: Known<readonly CardPrFact[]>;
  /** The verification of a Delivered plan; `null` for any other plan. */
  verification: VerificationReading | null;
  /** What the plan's slices cost; `null` where the plan names no branch. */
  cost: Known<CostReading> | null;
  /** The plan's story; `null` where the plan names none. */
  story: Known<PlanStoryReading> | null;
  /** The plan's sprint; `null` where the plan names none. */
  sprint: Known<PlanSprintReading> | null;
  /** Whether the plan exists only in the board's working tree. */
  notPushed: boolean;
}

const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/** The newest `YYYY-MM-DD` in any of the records, or `''`. */
const newestDate = (raws: readonly string[]): string =>
  raws.flatMap((raw) => raw.match(DATE) ?? []).reduce((a, b) => (b > a ? b : a), '');

/** A `Started:` record's value: its ISO date, then the person who took the work up. */
const STARTED = /^\s*(\d{4}-\d{2}-\d{2})\s*,\s*`?([^,`]+)`?/;

/**
 * The person and date on the newest `Started:` record; on equal dates the
 * later line wins.
 *
 * @param startedRaw - the plan's `Started:` values, one per line.
 * @returns the person as the record spells them and the record's date, or
 *   `null` where no record names both.
 */
const newestStart = (startedRaw: string): { who: string; at: string } | null =>
  startedRaw.split('\n').reduce<{ who: string; at: string } | null>((newest, line) => {
    const match = line.match(STARTED);
    if (match === null) return newest;
    const start = { at: match[1] as string, who: (match[2] as string).trim() };
    return newest === null || start.at >= newest.at ? start : newest;
  }, null);

const enabled = (action: ActionKind): Action => ({ action, enabled: true, reason: null });
const disabled = (action: ActionKind, reason: Reason): Action => ({ action, enabled: false, reason });

const sliceRef = (plan: string, branch: PlanSliceBranch): Ref => ({
  kind: 'slice', plan, branch: branch.branch, pr: branch.pr,
});

/** Lifts a known single reading into a known list of refs. */
const knownList = <T>(reading: Known<T> | null, toRef: (value: T) => Ref): Known<Ref[]> => {
  if (reading === null) return { value: [] };
  if ('unknown' in reading) return { unknown: reading.unknown };
  return { value: [toRef(reading.value)] };
};

/**
 * The plan's Start work action, or `null` where the plan cannot be dispatched.
 *
 * Enabled where the plan names no slices (the dispatcher decides those) or the
 * pulse reports an eligible branch; disabled with `awaiting-fleet-scan` where no
 * pulse covers the plan, and with `nothing-eligible` where none is eligible.
 */
const startWork = (readings: PlanCardFactsReadings): Action | null => {
  if (!readings.controls.dispatch) return null;
  const slices = readings.slices;
  if (slices === null) return enabled('start-work');
  if (slices.eligible === null) return disabled('start-work', { kind: 'awaiting-fleet-scan' });
  if (slices.eligible === 0) {
    return disabled('start-work', {
      kind: 'nothing-eligible', waitsOn: slices.waitsOn.map((b) => sliceRef(readings.slug, b)),
    });
  }
  return enabled('start-work');
};

/**
 * Whether a disabled secondary stays on the card. One the plan's own state
 * disables (`nothing-eligible`) is left out; one the board cannot answer yet
 * (`awaiting-fleet-scan`) stays, disabled, with its reason.
 */
const keepsSecondary = (action: Action): boolean =>
  action.reason === null || action.reason.kind === 'awaiting-fleet-scan';

/**
 * The plan's actions: at most one primary, then the secondaries in the order
 * Start work, Deliver, Interrogate. A secondary the plan's own state disables is
 * left out, and one the board cannot answer yet stays disabled with its reason;
 * `withActionAvailability` later marks one the board refuses.
 *
 * The primary is the first that holds of: Approve spike; Approve (or Confirm
 * slices) while the plan is under review; Approve disabled with `awaits-spike`
 * while a Design plan waits on its spike; Start work while the plan is ready to
 * start; Deliver while the plan is deliverable.
 */
const nextOf = (readings: PlanCardFactsReadings): CardFacts['next'] => {
  const { controls } = readings;
  const start = startWork(readings);
  let primary: Action | null = null;
  const secondary: Action[] = [];
  if (controls.approveSpike) {
    primary = enabled('approve-spike');
    // A merged spike with no `Spike approved:` record offers both: approve the
    // spike alone, or confirm the slices and approve the plan.
    if (controls.approve) secondary.push(enabled(controls.confirmSlices ? 'confirm-slices' : 'approve'));
  } else if (controls.approve) primary = enabled(controls.confirmSlices ? 'confirm-slices' : 'approve');
  else if (controls.interrogate && controls.spikeState !== null && readings.spike !== null) {
    primary = disabled('approve', { kind: 'awaits-spike', spike: sliceRef(readings.slug, readings.spike) });
  } else if (start !== null && controls.readyToStart) primary = start;

  if (start !== null && start !== primary && keepsSecondary(start)) secondary.push(start);
  if (readings.deliverable) {
    if (primary === null) primary = enabled('deliver');
    else secondary.push(enabled('deliver'));
  }
  if (controls.interrogate) secondary.push(enabled('interrogate'));
  return { primary, secondary };
};

/**
 * What is true about one plan, as its card shows it.
 *
 * The assignees are the plan's `Assignee:` names, resolved through `People`;
 * where it names none, the person on its newest `Started:` record; the
 * approver is never an assignee. `progress.state` is the plan's `State:`,
 * `unknown` where it could not be read. `ownership.since` is the
 * newest dated record (`transitioned`), else the plan file's date prefix
 * (`opened`). `identity.key` is the plan's first issue key, and `lineage.tickets`
 * holds every key the plan names, each a ticket ref with no lane: the plan card
 * reads the plan's `Issue:` field, not the tickets.
 *
 * @param readings - the plan's fields, controls and readings, as the board build holds them.
 * @param directory - the declared `People` spellings; `{}` where none is declared.
 * @returns the plan's card facts.
 */
export const planCardFacts = (readings: PlanCardFactsReadings, directory: PersonDirectory = {}): CardFacts => {
  const type = PlanTypeSchema.safeParse(readings.type.trim().toLowerCase());
  const { records } = readings;
  const assigned = readings.assignee.split(',').map((name) => name.trim()).filter((name) => name !== '')
    .map((name) => resolvePerson(name, directory).handle);
  // No `Assignee:` line: whoever took the work up on the newest `Started:` record.
  const started = assigned.length === 0 ? newestStart(records.startedRaw) : null;
  const assignees = started === null ? assigned : [resolvePerson(started.who, directory).handle];
  const assignedFrom: CardFacts['ownership']['assignedFrom'] = assigned.length > 0
    ? { source: 'assigned' }
    : started === null ? null : { source: 'started', at: started.at };
  const state = PlanStateSchema.safeParse(readings.state.trim().toLowerCase());
  const transitioned = newestDate([
    records.designRaw, records.approvedRaw, records.startedRaw, records.deliveredRaw, records.releasedRaw,
  ]);
  const opened = readings.path.slice(readings.path.lastIndexOf('/') + 1).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
  const since: CardFacts['ownership']['since'] = transitioned !== ''
    ? { at: transitioned, event: 'transitioned' }
    : opened !== '' ? { at: opened, event: 'opened' } : null;
  const underReview = readings.controls.roundsBadge;
  return {
    identity: {
      kind: 'plan',
      id: readings.slug,
      key: readings.issues[0] ?? null,
      title: readings.title,
      summary: null,
      type: type.success ? type.data : null,
      opens: { kind: 'plan', slug: readings.slug, key: readings.issues[0] ?? null, title: readings.title, status: readings.status },
      alerts: readings.notPushed ? [{ kind: 'not-pushed', commits: null }] : [],
    },
    lineage: {
      tickets: { value: readings.issues.map((key): Ref => ({ kind: 'ticket', key, title: key, lane: null })) },
      stories: knownList(readings.story, (s) => ({ kind: 'story', ...s })),
      plans: { value: [] },
      sprints: knownList(readings.sprint, (s) => ({ kind: 'sprint', ...s })),
    },
    progress: {
      state: state.success ? { value: { kind: 'plan', state: state.data } } : { unknown: 'failed' },
      work: readings.slices === null
        ? null
        : {
          unit: 'slices',
          done: readings.slices.complete === null ? { unknown: 'unasked' } : { value: readings.slices.complete },
          total: readings.slices.total,
        },
      prs: 'unknown' in readings.prs ? { unknown: readings.prs.unknown } : { value: [...readings.prs.value] },
      design: underReview || readings.controls.spikeState !== null
        ? { rounds: underReview ? readings.rounds : null, spike: readings.controls.spikeState }
        : null,
      verification: readings.verification,
      cost: readings.cost ?? { value: { tokens: null, measured: 0, absent: 0, unreadable: 0, fromRuns: 0, slices: 0 } },
    },
    next: nextOf(readings),
    ownership: {
      assignees: { value: assignees },
      assignedFrom,
      since,
      source: { path: readings.path },
    },
  };
};

/** Which board-wide capability each action needs. */
export type ActionAvailability = Partial<Record<ActionKind, boolean>>;

/**
 * The facts with every action this board will not run marked so.
 *
 * An enabled action, primary or secondary, whose capability reads `false`
 * becomes disabled with `action-unavailable` and stays on the card: the board's
 * configuration refuses it, and the card says so. An action already disabled
 * keeps its own reason, and an action the map does not name is left as it is.
 *
 * @param facts - a card's facts.
 * @param available - whether this board runs each action.
 * @returns the facts with `next` adjusted; the input is not changed.
 */
export const withActionAvailability = (facts: CardFacts, available: ActionAvailability): CardFacts => {
  const mark = (a: Action): Action =>
    a.enabled && available[a.action] === false
      ? disabled(a.action, { kind: 'action-unavailable', action: a.action })
      : a;
  return {
    ...facts,
    next: {
      primary: facts.next.primary === null ? null : mark(facts.next.primary),
      secondary: facts.next.secondary.map(mark),
    },
  };
};
