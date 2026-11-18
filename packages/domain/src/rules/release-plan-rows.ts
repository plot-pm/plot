import { SLICE_STATES, type SliceState, type SliceStateCounts } from './slice-states.js';

/** What the PR index says about a merged slice: the PR that landed it, or a commit the plan names. */
export interface MergedFact {
  /** The merged PR's number, from a MERGED row of a complete index. */
  readonly pr?: number;
  /** The merge time as the host reported it. */
  readonly mergedAt?: string;
  /** The commit a plan names for the slice. */
  readonly commit?: string;
}

/** One slice of a plan as the Release delivery section lists it. */
export interface PlanSliceFact {
  readonly name: string;
  /** The slice's state, or `unread` where a reading it needs is absent. */
  readonly state: SliceState | 'unread';
  /** The merge facts of a delivered slice. */
  readonly merged?: MergedFact;
  /** Whether the slice's work item is on the page, so a link can name it. */
  readonly linked: boolean;
  /** Whether the slice's row reads startable. */
  readonly startable: boolean;
  /** The slice the row waits on, from the row's `blockedBy`, or `''` where it waits on none. */
  readonly waitsFor: string;
  /** Whether the slice holds a branch or an agent, so it is a Work items row. */
  readonly begun: boolean;
}

/** The three headings of an opened plan row, plus the slices no reading reached. */
export const PLAN_HEADINGS = ['done', 'in-flight', 'to-do', 'not-read'] as const;

export type PlanHeading = (typeof PLAN_HEADINGS)[number];

/** The heading a slice state lists under. */
export const headingOf = (state: PlanSliceFact['state']): PlanHeading => {
  switch (state) {
    case 'delivered':
      return 'done';
    case 'blocked':
    case 'at-a-gate':
    case 'being-built':
      return 'in-flight';
    case 'not-started':
      return 'to-do';
    default:
      return 'not-read';
  }
};

/** One segment of a plan's strip: a state and the slices in it. */
export interface StripSegment {
  readonly state: SliceState;
  readonly count: number;
}

/**
 * The strip of one plan: the five states in order, empty ones omitted.
 *
 * @param slices - the plan's slices.
 * @returns the segments. Their counts add up to the plan's counted slices; a slice with an unread state is outside them.
 */
export const planStrip = (slices: readonly PlanSliceFact[]): StripSegment[] =>
  SLICE_STATES.map((state) => ({ state, count: slices.filter((s) => s.state === state).length }))
    .filter((segment) => segment.count > 0);

/**
 * The strip's wording: `N / M delivered`, or `progress not read` where no slice of the plan has a reading.
 *
 * @param slices - the plan's slices.
 */
export const stripText = (slices: readonly PlanSliceFact[]): string => {
  const counted = slices.filter((s) => s.state !== 'unread');
  if (slices.length === 0 || counted.length === 0) return 'progress not read';
  const delivered = counted.filter((s) => s.state === 'delivered').length;
  return `${delivered} / ${counted.length} delivered`;
};

/**
 * The text after `✓ merged` on a Done line.
 *
 * @param merged - the merge facts, or `undefined` where the index gave none.
 * @returns the slice's PR number and date, a named commit's short hash with no date, or the bare `merged` where the index is missing, partial or holds no merge time.
 */
export const doneDetail = (merged: MergedFact | undefined): string => {
  if (merged === undefined) return '';
  if (merged.pr !== undefined && merged.mergedAt !== undefined && merged.mergedAt !== '') {
    return ` · #${merged.pr} · ${merged.mergedAt.slice(0, 10)}`;
  }
  if (merged.commit !== undefined && merged.commit !== '') return ` · ${merged.commit.slice(0, 7)}`;
  return '';
};

/** One line of an opened plan row. */
export interface PlanLine {
  readonly heading: PlanHeading;
  readonly slice: string;
  /** The line's wording. */
  readonly text: string;
  /** Whether the line links to the slice's item in a Work items group. */
  readonly link: boolean;
  /** Whether the line carries Start. */
  readonly start: boolean;
}

/**
 * The lines of an opened plan row. Every slice appears once, under one heading.
 *
 * @param slices - the plan's slices, in the plan's order.
 */
export const planLines = (slices: readonly PlanSliceFact[]): PlanLine[] =>
  slices.map((s): PlanLine => {
    const heading = headingOf(s.state);
    if (heading === 'done') {
      return { heading, slice: s.name, text: `✓ merged · ${s.name}${doneDetail(s.merged)}`, link: false, start: false };
    }
    if (heading === 'to-do') {
      const waits = s.startable && s.waitsFor !== '' ? ` · waits for ${s.waitsFor}` : '';
      return { heading, slice: s.name, text: `${s.name}${waits}`, link: false, start: s.startable };
    }
    return { heading, slice: s.name, text: s.name, link: s.linked, start: false };
  });

/** One plan as a collapsed row of the Release delivery section. */
export interface PlanRowFacts {
  readonly plan: string;
  /** The plan's Owner handle, or `''`. */
  readonly owner: string;
  readonly strip: StripSegment[];
  readonly stripText: string;
  readonly lines: PlanLine[];
  /** Slices with no reading, counted apart from the strip. */
  readonly unread: number;
}

/**
 * The facts of one plan row.
 *
 * @param plan - the plan's slug.
 * @param owner - the plan's Owner handle, or `''`.
 * @param slices - the plan's slices.
 */
export const planRowFacts = (plan: string, owner: string, slices: readonly PlanSliceFact[]): PlanRowFacts => ({
  plan,
  owner,
  strip: planStrip(slices),
  stripText: stripText(slices),
  lines: planLines(slices),
  unread: slices.filter((s) => s.state === 'unread').length,
});

/** A sprint as the block rule reads it: its target release and the plans it names. */
export interface SprintPlans {
  readonly release: string;
  readonly members: readonly string[];
}

/** One block of the section: a target release and the plans it lists. */
export interface ReleaseBlockPlans {
  /** The target release, or `''` where no sprint names one. */
  readonly release: string;
  readonly plans: string[];
}

/**
 * Groups plans into blocks by target release.
 *
 * @param sprints - the active sprints.
 * @param approved - every plan approved for delivery, in the order the section lists them.
 * @returns one block per distinct `Release:` value, each plan once even where two sprints name it. Where no sprint names a release, one block with release `''` holds every approved plan.
 */
export const releaseBlocks = (sprints: readonly SprintPlans[], approved: readonly string[]): ReleaseBlockPlans[] => {
  const byRelease = new Map<string, string[]>();
  for (const sprint of sprints) {
    if (sprint.release === '') continue;
    const plans = byRelease.get(sprint.release) ?? [];
    for (const plan of sprint.members) if (!plans.includes(plan)) plans.push(plan);
    byRelease.set(sprint.release, plans);
  }
  if (byRelease.size === 0) return [{ release: '', plans: [...approved] }];
  return [...byRelease].map(([release, plans]) => ({ release, plans }));
};

/** The header's counts over a block's plans. */
export interface ReleaseHeaderCounts {
  readonly plans: number;
  readonly delivered: number;
  readonly total: number;
  readonly unread: number;
}

/**
 * The header counts of a block: its plans and the slices over them, each plan once.
 *
 * @param rows - the block's plan rows.
 */
export const headerCounts = (rows: readonly PlanRowFacts[]): ReleaseHeaderCounts => {
  const total = rows.reduce((n, r) => n + r.strip.reduce((m, s) => m + s.count, 0), 0);
  const delivered = rows.reduce((n, r) => n + (r.strip.find((s) => s.state === 'delivered')?.count ?? 0), 0);
  return { plans: rows.length, delivered, total, unread: rows.reduce((n, r) => n + r.unread, 0) };
};

/**
 * The header's wording.
 *
 * @param counts - the block's counts.
 * @param release - the target release, or `''`.
 * @param strip - the five-state counts of the block, for the blocked figure.
 */
export const headerText = (counts: ReleaseHeaderCounts, release: string, strip?: Pick<SliceStateCounts, 'blocked'>): string => {
  const parts = [
    ...(release === '' ? [] : [release]),
    `${counts.plans} ${counts.plans === 1 ? 'plan' : 'plans'}`,
    `${counts.delivered} of ${counts.total} slices delivered`,
    ...(strip === undefined ? [] : [`${strip.blocked} blocked`]),
    ...(counts.unread > 0 ? [`${counts.unread} not read`] : []),
  ];
  return parts.join(' · ');
};
