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
import { namesAPerson, resolvePerson, type PersonDirectory } from '../entities/person.js';
import type { SprintState } from '../entities/sprint.js';
import type { StoryStatus } from '../entities/story.js';
import type { CardControls } from './card-controls.js';
import { PlanTypeSchema, type PlanStatus } from './phase.js';

/**
 * The approver's raw spelling from an `Approved:` record, or `''` where the
 * record carries none.
 *
 * The record is `<date>, <who>, <channel detail>`; the `who` position is read
 * positionally. A bare-timestamp record and the template placeholder `<who>`
 * carry no name.
 *
 * @param approvedRaw - `PlanRecord.approvedRaw`, verbatim.
 * @returns the approver's raw spelling, or `''` where none is readable.
 */
export const planCardApprover = (approvedRaw: string): string => {
  const who = approvedRaw.split(',')[1]?.trim() ?? '';
  if (who.startsWith('<') && who.endsWith('>')) return '';
  return namesAPerson(who) ? who : '';
};

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
  /** The plan's `Assignee:` value; `''` where none is stated. */
  assignee: string;
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
 * The plan's actions: at most one primary, then the enabled secondaries in the
 * order Start work, Deliver, Interrogate.
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
  if (controls.approveSpike) primary = enabled('approve-spike');
  else if (controls.approve) primary = enabled(controls.confirmSlices ? 'confirm-slices' : 'approve');
  else if (controls.interrogate && controls.spikeState !== null && readings.spike !== null) {
    primary = disabled('approve', { kind: 'awaits-spike', spike: sliceRef(readings.slug, readings.spike) });
  } else if (start !== null && controls.readyToStart) primary = start;

  const secondary: Action[] = [];
  if (start !== null && start !== primary && start.enabled) secondary.push(start);
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
 * The owner is the plan's assignee before approval and the `Approved:` record's
 * approver once one exists, resolved through `People`. `ownership.since` is the
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
  const rawOwner = records.approvedRaw.trim() === '' ? readings.assignee.trim() : planCardApprover(records.approvedRaw);
  const transitioned = newestDate([
    records.designRaw, records.approvedRaw, records.startedRaw, records.deliveredRaw, records.releasedRaw,
  ]);
  const opened = (readings.path.split('/').pop() ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
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
      opens: { kind: 'plan', slug: readings.slug, title: readings.title, status: readings.status },
      alerts: readings.notPushed ? [{ kind: 'not-pushed', commits: null }] : [],
    },
    lineage: {
      tickets: { value: readings.issues.map((key): Ref => ({ kind: 'ticket', key, title: key, lane: null })) },
      stories: knownList(readings.story, (s) => ({ kind: 'story', ...s })),
      plans: { value: [] },
      sprints: knownList(readings.sprint, (s) => ({ kind: 'sprint', ...s })),
    },
    progress: {
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
      owner: rawOwner === '' ? null : resolvePerson(rawOwner, directory).handle,
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
