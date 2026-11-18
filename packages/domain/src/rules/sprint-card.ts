import { scoreItem, type MoscowTier } from '../entities/sprint.js';
import type { DeliveryInput, DeliveryReadings } from './delivery-placement.js';
import type { Reader } from './ownership.js';
import { sprintIsMine } from './sprint-ownership.js';
import { declaresSpelling } from '../entities/person.js';
import {
  countSliceStatesOver,
  SLICE_STATES,
  type CountedSlice,
  type SliceState,
  type SliceStateCounts,
} from './slice-states.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * Writes a sprint's end date in full, in English, with no locale call.
 *
 * @param end - the sprint's `End:` as `YYYY-MM-DD`, `''` where absent.
 * @returns `ends Friday, 20 November`, or `''` for an empty or unparseable date.
 */
export const sprintEndLine = (end: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end.trim());
  if (match === null) return '';
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `ends ${WEEKDAYS[date.getUTCDay()]}, ${day} ${MONTHS[month - 1]}`;
};

/** The sprint fields the card reads. */
export interface SprintCardSprint {
  readonly slug: string;
  readonly title: string;
  readonly release: string;
  readonly end: string;
  readonly ownerHandle: string;
  readonly members: readonly { slug: string; tier: MoscowTier | 'deferred'; checked: boolean; known?: boolean }[];
}

/** The commitment tiers the card shows, in print order. */
export const CARD_TIERS = ['must', 'should', 'could'] as const;

export type CardTier = (typeof CARD_TIERS)[number];

/** One tier's progress: members delivered of members counted. */
export interface TierProgress {
  readonly tier: CardTier;
  readonly done: number;
  readonly total: number;
  /** `Must 5/5`. */
  readonly text: string;
}

/** One bar segment: a slice state and its count. */
export interface BarSegment {
  readonly state: SliceState;
  readonly count: number;
}

/** The card of one owned Active sprint. */
export interface SprintCardView {
  readonly slug: string;
  readonly title: string;
  /** `ends Friday, 20 November`, or `''` where no date reads. */
  readonly endLine: string;
  /** The release the sprint targets, `''` where none. */
  readonly release: string;
  /** Five segments in `SLICE_STATES` order, or `null` where a named plan has no merge answer. */
  readonly bar: readonly BarSegment[] | null;
  readonly total: number;
  /** Tier progress, empty where the reading is missing. A tier with no member is absent. */
  readonly tiers: readonly TierProgress[];
  /** `Must 5/5 · Should 2/3`, `''` when `tiers` is empty. */
  readonly tierLine: string;
  /** True where the bar and tier counts could not be read. */
  readonly readingMissing: boolean;
}

/** The whole header card: one entry per owned sprint, and the undeclared Owners it names. */
export interface SprintCardsView {
  readonly cards: readonly SprintCardView[];
  /** Sprints whose Owner handle `People` does not declare; named only where the reader owns a sprint. */
  readonly unknownOwners: readonly { slug: string; handle: string }[];
}

/** Whether a plan is delivered: it has counted slices and every one merged. A plan with none is not delivered. */
const planDelivered = (slices: readonly CountedSlice[]): boolean =>
  slices.length > 0 && slices.every((s) => s.merge === 'merged');

/**
 * Reads the sprint card: the owned Active sprints, each with an end line, a
 * target release, a five-segment bar and progress per commitment tier.
 *
 * The bar is `countSliceStatesOver`; where any plan the sprint names has no
 * merge answer the bar is `null` and `readingMissing` is true, never a bar of
 * zeros. Tier progress scores each member with `scoreItem`: a member is done
 * where its plan is delivered, or where its line names no plan and is ticked.
 * A member with `known: false` names no plan the board found: it adds no slice
 * to the bar and scores `withdrawn`, which is not done. A deferred member is in no tier. A tier with no member is absent.
 *
 * @param sprints - the Active sprints.
 * @param reader - who is reading.
 * @param slicesByPlan - the counted slices per plan key.
 * @param readings - the work items and agents as measured.
 * @param input - the `Auto-review` key and the `Correction budget`.
 */
export const sprintCards = (
  sprints: readonly SprintCardSprint[],
  reader: Reader,
  slicesByPlan: ReadonlyMap<string, readonly CountedSlice[] | undefined>,
  readings: DeliveryReadings,
  input: DeliveryInput,
): SprintCardsView => {
  const owned = sprints.filter((s) => sprintIsMine(s.ownerHandle, reader));
  const cards = owned.map((sprint): SprintCardView => {
    const counted = sprint.members.filter((m) => m.tier !== 'deferred');
    // A member the board did not find (renamed, deleted or dropped) has no merge answer to wait for.
    const keys = counted.filter((m) => m.known !== false).map((m) => m.slug).filter((slug) => slug !== '');
    const counts: SliceStateCounts | undefined = countSliceStatesOver(slicesByPlan, keys, readings, input);
    const tiers: TierProgress[] = [];
    if (counts !== undefined) {
      for (const tier of CARD_TIERS) {
        const members = counted.filter((m) => m.tier === tier);
        if (members.length === 0) continue;
        const done = members.filter((m) => {
          // `countSliceStatesOver` answered, so every known named plan has an entry.
          const delivered = m.slug === '' ? 'no-plan-named' : m.known === false ? 'withdrawn' : planDelivered(slicesByPlan.get(m.slug)!);
          return scoreItem({ tier, checked: m.checked, plan: m.slug, text: '' }, delivered) === 'done';
        }).length;
        tiers.push({ tier, done, total: members.length, text: `${tier[0]!.toUpperCase()}${tier.slice(1)} ${done}/${members.length}` });
      }
    }
    return {
      slug: sprint.slug,
      title: sprint.title,
      endLine: sprintEndLine(sprint.end),
      release: sprint.release,
      bar: counts === undefined ? null : SLICE_STATES.map((state) => ({ state, count: counts[state] })),
      total: counts?.total ?? 0,
      tiers,
      tierLine: tiers.map((t) => t.text).join(' · '),
      readingMissing: counts === undefined,
    };
  });
  // An owned sprint needs a declared Owner, so `cards` is empty unless the directory exists.
  const unknownOwners = cards.length === 0 ? [] : sprints
    .filter((s) => s.ownerHandle.trim() !== '' && !declaresSpelling(s.ownerHandle.trim(), reader.directory!))
    .map((s) => ({ slug: s.slug, handle: s.ownerHandle.trim() }));
  return { cards, unknownOwners };
};
