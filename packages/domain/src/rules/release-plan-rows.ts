import type { PrIndex } from '../entities/pr-index.js';
import { SLICE_STATES, type SliceState, type SliceStateCounts } from './slice-states.js';
import { phaseAccent } from './workflow-phases.js';
import { storyDateText } from './story-date.js';
import { pill, type StatusPill } from './status-pill.js';

/** What the PR index says about a merged slice: the PR that landed it, or a commit the plan names. */
export interface MergedFact {
  /** The merged PR's number, from a MERGED row of a complete index. */
  readonly pr?: number;
  /** The merge time as the host reported it. */
  readonly mergedAt?: string;
  /** The commit a plan names for the slice. */
  readonly commit?: string;
}

/**
 * The merge facts of a slice's branches from the PR index.
 *
 * @param branches - the slice's branch names.
 * @param index - the PR index, or `null` where none was read.
 * @returns the newest MERGED row's PR number and merge time among the branches. `undefined` where the index is missing or `complete: false`, or holds no MERGED row for any branch: the index supplies merged answers only and never says none.
 */
export const mergedFactOf = (branches: readonly string[], index: PrIndex | null): MergedFact | undefined => {
  if (index === null || !index.complete) return undefined;
  const rows = index.rows.filter((r) => r.state.toUpperCase() === 'MERGED' && !r.draft && branches.includes(r.head));
  const newest = rows.reduce<(typeof rows)[number] | undefined>(
    (best, r) => (best === undefined || (r.mergedAt ?? '') > (best.mergedAt ?? '') ? r : best),
    undefined,
  );
  return newest === undefined ? undefined : { pr: newest.number, mergedAt: newest.mergedAt ?? '' };
};

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
  /** The number of the slice's open PR, where a row of the slice already carries one. Absent where none was read. */
  readonly pr?: number;
  /** The slice's one branch. Absent where the slice names several branches or none, or no reading names one. */
  readonly branch?: string;
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
  /** The slice's state, or `unread` where a reading it needs is absent. */
  readonly state: PlanSliceFact['state'];
  /** The slice's PR number: the merged PR on a Done line, a carried open PR otherwise. Absent where the row cannot say. */
  readonly pr?: number;
  /** `merged <relative time>` on a Done line with a parseable merge time and a clock; absent otherwise. */
  readonly merged?: string;
  /** The slice's one branch, the branch segment of the line's PR+branch tuple. Absent where the slice has none. */
  readonly branch?: string;
  /** The slice a To do line waits on. Absent where it waits on none, and on every other line. */
  readonly waitsFor?: string;
}

/**
 * The relative merge time of a Done line.
 *
 * @param mergedAt - the merge time as the host reported it.
 * @param now - the clock reading, or `undefined` where the caller has none.
 * @returns `merged today`, `merged yesterday`, `merged N days ago`, `merged N weeks ago` or `merged <locale date>`. `now` is clamped to `mergedAt` first, so a merge time ahead of the clock reads `merged today`. `undefined` where `now` is absent or `mergedAt` is empty, absent or unparseable.
 */
export const mergedWords = (mergedAt: string | undefined, now: Date | undefined): string | undefined => {
  if (now === undefined) return undefined;
  const at = mergedAt === undefined ? Number.NaN : new Date(mergedAt).getTime();
  if (Number.isNaN(at)) return undefined;
  return `merged ${storyDateText(mergedAt, new Date(Math.max(now.getTime(), at)))!}`;
};

/**
 * The lines of an opened plan row. Every slice appears once, under one heading.
 *
 * @param slices - the plan's slices, in the plan's order.
 * @param now - the clock reading the relative merge time measures against; absent leaves `merged` off every line.
 */
export const planLines = (slices: readonly PlanSliceFact[], now?: Date): PlanLine[] =>
  slices.map((s): PlanLine => {
    const heading = headingOf(s.state);
    const branch = s.branch === undefined || s.branch === '' ? {} : { branch: s.branch };
    if (heading === 'done') {
      const merged = mergedWords(s.merged?.mergedAt, now);
      const pr = s.merged?.pr ?? s.pr;
      return {
        heading, slice: s.name, text: `✓ merged · ${s.name}${doneDetail(s.merged)}`, link: false, start: false, state: s.state,
        ...(pr === undefined ? {} : { pr }), ...(merged === undefined ? {} : { merged }), ...branch,
      };
    }
    const pr = s.pr === undefined ? {} : { pr: s.pr };
    if (heading === 'to-do') {
      const waits = s.startable && s.waitsFor !== '' ? ` · waits for ${s.waitsFor}` : '';
      const waitsFor = s.waitsFor === '' ? {} : { waitsFor: s.waitsFor };
      return { heading, slice: s.name, text: `${s.name}${waits}`, link: false, start: s.startable, state: s.state, ...pr, ...branch, ...waitsFor };
    }
    return { heading, slice: s.name, text: s.name, link: s.linked, start: false, state: s.state, ...pr, ...branch };
  });

/** The pill of each slice state. */
const SLICE_PILL: Readonly<Record<PlanLine['state'], StatusPill>> = {
  delivered: pill('merged', 'green'),
  blocked: pill('blocked', 'red'),
  'at-a-gate': pill('at CI', 'amber'),
  'being-built': pill('building', 'blue'),
  'not-started': pill('not started', 'grey'),
  unread: pill('not read', 'grey'),
};

/**
 * The status pill of a slice line, by the slice's state.
 *
 * @param state - the slice's state, or `unread` where a reading it needs is absent.
 * @returns one pill with no link: `merged` green, `blocked` red, `at CI` amber, `building` blue, `not started` grey,
 *   and `not read` grey for `unread`, which never reads as not started.
 */
export const slicePills = (state: PlanLine['state']): StatusPill[] => [{ ...SLICE_PILL[state] }];

/** One slice line of an opened plan row: the line and its status pills. */
export interface PlanSliceLine extends PlanLine {
  /** What `slicePills` returns for the line's state. */
  readonly pills: StatusPill[];
}

/**
 * The slice lines of an opened Release delivery plan row: `planLines` with each line's status pills.
 *
 * @param slices - the plan's slices, in the plan's order.
 * @param now - the clock reading the relative merge time measures against; absent leaves `merged` off every line.
 */
export const releasePlanSlices = (slices: readonly PlanSliceFact[], now?: Date): PlanSliceLine[] =>
  planLines(slices, now).map((line) => ({ ...line, pills: slicePills(line.state) }));

/** One plan as a collapsed row of the Release delivery section. */
export interface PlanRowFacts {
  readonly plan: string;
  /** The plan's Owner handle, or `''`. */
  readonly owner: string;
  readonly strip: StripSegment[];
  readonly stripText: string;
  readonly lines: PlanSliceLine[];
  /** Slices with no reading, counted apart from the strip. */
  readonly unread: number;
  /** The plan's workflow phase name. Absent where no row of the plan names one. */
  readonly phase?: string;
  /** The phase's accent: its own name for a default phase, `neutral` otherwise. Absent where `phase` is. */
  readonly accent?: string;
}

/** What `planRowFacts` reads beside the slices. */
export interface PlanRowReadings {
  /** The plan's workflow phase name, or `null` where no row names one. */
  readonly phase?: string | null;
  /** The clock reading for the relative merge time. */
  readonly now?: Date;
}

/**
 * The facts of one plan row.
 *
 * @param plan - the plan's slug.
 * @param owner - the plan's Owner handle, or `''`.
 * @param slices - the plan's slices.
 * @param readings - the plan's phase name and the clock; a `null` or empty phase leaves `phase` and `accent` absent.
 */
export const planRowFacts = (plan: string, owner: string, slices: readonly PlanSliceFact[], readings: PlanRowReadings = {}): PlanRowFacts => {
  const phase = readings.phase === null || readings.phase === undefined || readings.phase === '' ? undefined : readings.phase;
  return {
    plan,
    owner,
    strip: planStrip(slices),
    stripText: stripText(slices),
    lines: releasePlanSlices(slices, readings.now),
    unread: slices.filter((s) => s.state === 'unread').length,
    ...(phase === undefined ? {} : { phase, accent: phaseAccent(phase) }),
  };
};

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
  if (byRelease.size === 0) return [{ release: '', plans: unsprintedPlans(sprints, approved) }];
  return [...byRelease].map(([release, plans]) => ({ release, plans }));
};

/**
 * The approved plans no sprint naming a release holds: the plans a release no Active sprint names carries.
 *
 * @param sprints - the active sprints.
 * @param approved - every plan approved for delivery, in the order the section lists them.
 * @returns `approved` without the members of each sprint whose `Release:` is not empty, in `approved` order. Where no sprint names a release, it is every approved plan, the plans of the block `releaseBlocks` gives release `''`.
 */
export const unsprintedPlans = (sprints: readonly SprintPlans[], approved: readonly string[]): string[] => {
  const held = new Set(sprints.filter((s) => s.release !== '').flatMap((s) => s.members));
  return approved.filter((plan) => !held.has(plan));
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

/** One figure of the header: its key, its number and the words that follow the number. */
export interface HeaderCountPart {
  readonly key: 'plans' | 'delivered' | 'at-a-gate' | 'blocked' | 'unread';
  readonly count: number;
  /** What follows the number; `${count} ${words}` is the figure as `headerText` prints it. */
  readonly words: string;
}

/** The five-state counts the header prints: `blocked` always, `at-a-gate` where the caller gives it. */
export type HeaderStrip = Pick<SliceStateCounts, 'blocked'> & Partial<Pick<SliceStateCounts, 'at-a-gate'>>;

/**
 * The figures of the header, one per part `headerText` prints after the release.
 *
 * @param counts - the block's counts.
 * @param strip - the five-state counts of the block; without it no `blocked` part is returned, and without its `at-a-gate` no `at-a-gate` part.
 * @returns `plans`, `delivered`, `at-a-gate` and `blocked` only where `strip` gives them, and `unread` only above 0, so it agrees with `headerText` for the same arguments.
 */
export const headerCountParts = (counts: ReleaseHeaderCounts, strip?: HeaderStrip): HeaderCountPart[] => [
  { key: 'plans', count: counts.plans, words: counts.plans === 1 ? 'plan' : 'plans' },
  { key: 'delivered', count: counts.delivered, words: `of ${counts.total} slices delivered` },
  ...(strip?.['at-a-gate'] === undefined ? [] : [{ key: 'at-a-gate' as const, count: strip['at-a-gate'], words: 'at a gate' }]),
  ...(strip === undefined ? [] : [{ key: 'blocked' as const, count: strip.blocked, words: 'blocked' }]),
  ...(counts.unread > 0 ? [{ key: 'unread' as const, count: counts.unread, words: 'not read' }] : []),
];

/**
 * The header's wording.
 *
 * @param counts - the block's counts.
 * @param release - the target release, or `''`.
 * @param strip - the five-state counts of the block, for the at-a-gate and blocked figures.
 */
export const headerText = (counts: ReleaseHeaderCounts, release: string, strip?: HeaderStrip): string =>
  [...(release === '' ? [] : [release]), ...headerCountParts(counts, strip).map((p) => `${p.count} ${p.words}`)].join(' · ');

/** One figure of the Release delivery section's header line, with the plan row its link leads to. */
export interface ReleaseDeliveryCount extends HeaderCountPart {
  /** The first plan row holding what the figure counts, or `null` for a count of 0, which is not a link. */
  readonly target: string | null;
}

/** The Release delivery section's header line: what it shows open and folded. */
export interface ReleaseDeliveryHeader {
  /** The section's name: Release delivery, or Sprint delivery under My sprint. */
  readonly name: string;
  /** The one block's release or sprint slug, or `''` where the section holds no block, several blocks, or a block with neither. */
  readonly scope: string;
  readonly counts: ReleaseDeliveryCount[];
  /** The slices over the section's plans per state, one segment for each of the five `SLICE_STATES` in their order, a count of 0 included. */
  readonly bar: StripSegment[];
  /** The plans that hold at least one blocked slice. */
  readonly blockedPlans: number;
}

/** One block of the section as the header line reads it. */
export interface ReleaseDeliveryBlock {
  /** The block's release, or its sprint slug under My sprint; `''` where it has neither. */
  readonly scope: string;
  readonly rows: readonly PlanRowFacts[];
}

/**
 * The header line of the Release delivery section.
 *
 * @param name - the section's name.
 * @param blocks - the section's blocks, in the order it lists them.
 * @returns the totals over the section's plans, each plan once where two blocks list it: `plans`, `delivered`, `at-a-gate`, `blocked`, and `unread` only above 0. Each figure's `target` is the first plan row, in block order, that holds a slice the figure counts (any row for `plans`), and `null` for a count of 0. `bar` holds the five states over the same plans, and `blockedPlans` the plans with a blocked slice.
 */
export const releaseDeliveryHeader = (name: string, blocks: readonly ReleaseDeliveryBlock[]): ReleaseDeliveryHeader => {
  const rows = blocks.flatMap((b) => b.rows).filter((r, i, all) => all.findIndex((x) => x.plan === r.plan) === i);
  const inState = (r: PlanRowFacts, state: SliceState): number => r.strip.find((s) => s.state === state)?.count ?? 0;
  const holds = (r: PlanRowFacts, key: HeaderCountPart['key']): boolean => {
    if (key === 'plans') return true;
    if (key === 'unread') return r.unread > 0;
    return inState(r, key) > 0;
  };
  const strip = {
    blocked: rows.reduce((n, r) => n + inState(r, 'blocked'), 0),
    'at-a-gate': rows.reduce((n, r) => n + inState(r, 'at-a-gate'), 0),
  };
  const counts = headerCountParts(headerCounts(rows), strip).map((p): ReleaseDeliveryCount => ({
    ...p,
    target: rows.find((r) => p.count > 0 && holds(r, p.key))?.plan ?? null,
  }));
  const bar = SLICE_STATES.map((state): StripSegment => ({ state, count: rows.reduce((n, r) => n + inState(r, state), 0) }));
  const blockedPlans = rows.filter((r) => inState(r, 'blocked') > 0).length;
  return { name, scope: blocks.length === 1 ? blocks[0]!.scope : '', counts, bar, blockedPlans };
};
