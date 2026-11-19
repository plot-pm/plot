import { normalizeVersion } from '../entities/version.js';
import { resolvePerson, samePerson, type Person, type PersonDirectory } from '../entities/person.js';
import type { DeliveryInput, DeliveryReadings } from './delivery-placement.js';
import type { PasskeyRegistration } from './passkey-settings.js';
import { unsprintedPlans } from './release-plan-rows.js';
import { releaseApprovable, type ReleaseApprovable, type ReleasePrReading } from './release-approvable.js';
import { countSliceStatesOver, SLICE_STATES, type CountedSlice } from './slice-states.js';
import type { BarSegment, SprintCardSprint } from './sprint-card.js';

/** The sprint fields a release card reads. */
export type ReleaseCardSprint = Pick<SprintCardSprint, 'slug' | 'release' | 'ownerHandle' | 'members'>;

/** A release row on the payload: its work item id, the version its branch's `package.json` carries, and its PR number. */
export interface ReleaseRowReading {
  readonly id: string;
  /** `''` where the version was not read. */
  readonly version: string;
  /** `null` where the row carries no PR. */
  readonly pr: number | null;
}

/**
 * The plans the Release delivery section lists and the slices it counts per plan, as `deliveryView` reads them.
 * An `untargeted` card counts over these, so the card and the section read one set.
 */
export interface ReleaseCarried {
  /** Every plan approved for delivery, in the order the section lists them. */
  readonly approved: readonly string[];
  /** The counted slices per plan key, `undefined` where a plan's merge answer is unread. */
  readonly slicesByPlan: ReadonlyMap<string, readonly CountedSlice[] | undefined>;
}

/** `targeted`: Active sprints name the release. `untargeted`: a release row no sprint names. `none`: neither exists. */
export type ReleaseCardKind = 'targeted' | 'untargeted' | 'none';

/** The title of the card shown where no sprint names a release and no release row exists. */
export const NO_RELEASE_TARGETED = 'No release targeted';

/** The words of a card whose bar could not be read. */
export const RELEASE_READING_MISSING = 'The merge reading for this release is missing.';

/** One release card. */
export interface ReleaseCardView {
  /** Unique among the cards. */
  readonly key: string;
  readonly kind: ReleaseCardKind;
  /** The DOM id the card carries and the to-do line scrolls to. */
  readonly anchor: string;
  /** The version without its `v`, `''` for `none` and for a row whose version was not read. */
  readonly version: string;
  /** `Release 2.35.0`, `Release 2.35.0 · no sprint targets it` for a row that carries no plan, or `No release targeted`. */
  readonly title: string;
  /** Five segments in `SLICE_STATES` order; `null` for `none` and where a named plan has no merge answer. */
  readonly bar: readonly BarSegment[] | null;
  readonly total: number;
  readonly readingMissing: boolean;
  /** `RELEASE_READING_MISSING` where `readingMissing`, `''` otherwise. */
  readonly missingText: string;
  /** Distinct Owners of the sprints that name the release. */
  readonly people: number;
  /** `1 person`, `2 people`; `''` for a card no sprint names. */
  readonly peopleText: string;
  /** `release PR #300 open`, `planned · no release PR yet`, or `''` for `none`. */
  readonly stateText: string;
  /** The work item id of the bound release row, `null` where none binds. */
  readonly rowId: string | null;
  /** Why the Approve button is disabled before any PR reading, `''` where a row binds. */
  readonly unboundReason: string;
}

const bare = (version: string): string => normalizeVersion(version).replace(/^v/, '');

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const stateOf = (row: ReleaseRowReading): string => (row.pr === null ? 'release PR not read' : `release PR #${row.pr} open`);

/** The plan keys a sprint counts: not deferred, found by the board, and naming a plan. */
const planKeysOf = (sprint: ReleaseCardSprint): string[] =>
  sprint.members.filter((m) => m.tier !== 'deferred' && m.known !== false).map((m) => m.slug).filter((slug) => slug !== '');

/** Distinct people among Owner handles, resolved through the directory; an empty handle names nobody. */
const peopleOf = (handles: readonly string[], directory: PersonDirectory): number => {
  const people: Person[] = [];
  for (const handle of handles) {
    if (handle.trim() === '') continue;
    const person = resolvePerson(handle, directory);
    if (!people.some((p) => samePerson(p, person))) people.push(person);
  }
  return people.length;
};

/**
 * The Delivery tab header's release cards.
 *
 * One card per distinct `Release:` value of the Active sprints, in first-named order, then one per
 * release row no card binds, then `No release targeted` where there is neither. A card binds the first
 * unbound release row whose `version` names the same release: both sides go through
 * `normalizeVersion`, so `v2.35.0` binds `2.35.0`. A row whose version was not read binds nothing.
 *
 * The bar is `countSliceStatesOver` over the union of the plans the card's sprints name, and is `null`
 * where any of them has no merge answer. It reads no reader, so every reader sees the same counts.
 * People are the distinct Owners, compared through `resolvePerson` and `samePerson`.
 *
 * An `untargeted` card counts `unsprintedPlans` of `carried` over `carried.slicesByPlan`: where no
 * Active sprint names a release, as after the sprint that named it closed, that is the plan set the
 * Release delivery section counts. Its title is the version alone, and adds `· no sprint targets it`
 * only where that set is empty. A PR that was not read changes `stateText` and keeps the bar.
 *
 * @param sprints - the Active sprints.
 * @param rows - the release rows on the payload.
 * @param directory - the declared `People` spellings.
 * @param slicesByPlan - the counted slices per plan key.
 * @param readings - the work items and agents as measured, in Mine mode `all`.
 * @param input - the `Auto-review` key and the `Correction budget`.
 * @param carried - the Release delivery section's plans and counted slices; absent reads as none.
 */
export const releaseCards = (
  sprints: readonly ReleaseCardSprint[],
  rows: readonly ReleaseRowReading[],
  directory: PersonDirectory,
  slicesByPlan: ReadonlyMap<string, readonly CountedSlice[] | undefined>,
  readings: DeliveryReadings,
  input: DeliveryInput,
  carried: ReleaseCarried = { approved: [], slicesByPlan: new Map() },
): ReleaseCardView[] => {
  const targets: { version: string; sprints: ReleaseCardSprint[] }[] = [];
  for (const sprint of sprints) {
    const version = bare(sprint.release);
    if (version === '') continue;
    const target = targets.find((t) => t.version === version);
    if (target === undefined) targets.push({ version, sprints: [sprint] });
    else target.sprints.push(sprint);
  }
  const bound = new Set<string>();
  const cards: ReleaseCardView[] = targets.map(({ version, sprints: named }): ReleaseCardView => {
    const row = rows.find((r) => !bound.has(r.id) && r.version !== '' && bare(r.version) === version);
    if (row !== undefined) bound.add(row.id);
    const counts = countSliceStatesOver(slicesByPlan, named.flatMap(planKeysOf), readings, input);
    const people = peopleOf(named.map((s) => s.ownerHandle), directory);
    return {
      key: `release:${version}`,
      kind: 'targeted',
      anchor: `release-card-${version}`,
      version,
      title: `Release ${version}`,
      bar: counts === undefined ? null : SLICE_STATES.map((state) => ({ state, count: counts[state] })),
      total: counts?.total ?? 0,
      readingMissing: counts === undefined,
      missingText: counts === undefined ? RELEASE_READING_MISSING : '',
      people,
      peopleText: plural(people, 'person', 'people'),
      stateText: row === undefined ? 'planned · no release PR yet' : stateOf(row),
      rowId: row?.id ?? null,
      unboundReason: row === undefined ? `no release PR carries ${version}` : '',
    };
  });
  const unsprinted = unsprintedPlans(sprints.map((s) => ({ release: s.release, members: s.members.map((m) => m.slug) })), carried.approved);
  const carriedCounts = countSliceStatesOver(carried.slicesByPlan, unsprinted, readings, input);
  for (const row of rows) {
    if (bound.has(row.id)) continue;
    const version = bare(row.version);
    // A version a card already holds would give two cards one anchor.
    const taken = version === '' || cards.some((c) => c.version === version);
    const anchorPart = (taken ? `row-${row.id}` : version).replace(/[^A-Za-z0-9._-]/g, '-');
    cards.push({
      key: `release-row:${row.id}`,
      kind: 'untargeted',
      anchor: `release-card-${anchorPart}`,
      version,
      title: `${version === '' ? 'Release (version not read)' : `Release ${version}`}${unsprinted.length === 0 ? ' · no sprint targets it' : ''}`,
      bar: carriedCounts === undefined ? null : SLICE_STATES.map((state) => ({ state, count: carriedCounts[state] })),
      total: carriedCounts?.total ?? 0,
      readingMissing: carriedCounts === undefined,
      missingText: carriedCounts === undefined ? RELEASE_READING_MISSING : '',
      people: 0,
      peopleText: '',
      stateText: stateOf(row),
      rowId: row.id,
      unboundReason: '',
    });
  }
  if (cards.length > 0) return cards;
  return [{
    key: 'release:none',
    kind: 'none',
    anchor: 'release-card-none',
    version: '',
    title: NO_RELEASE_TARGETED,
    bar: null,
    total: 0,
    readingMissing: false,
    missingText: '',
    people: 0,
    peopleText: '',
    stateText: '',
    rowId: null,
    unboundReason: 'no release PR exists',
  }];
};

/**
 * The Approve button of one card.
 *
 * @param card - the card.
 * @param pr - the bound row's PR reading, `null` where none was read.
 * @param held - the passkey registration answer, `null` while unread.
 * @returns disabled with `unboundReason` where no row binds; otherwise `releaseApprovable` of the bound row.
 */
export const releaseCardApprovable = (
  card: Pick<ReleaseCardView, 'rowId' | 'unboundReason'>,
  pr: ReleasePrReading | null,
  held: PasskeyRegistration | null,
): ReleaseApprovable =>
  card.rowId === null ? { state: 'disabled', reason: card.unboundReason } : releaseApprovable(pr, held);

/**
 * The to-do entries the cards owe: one per card a release row binds.
 *
 * @param cards - the release cards.
 * @returns the card key, the label after "Approve release", and the card's anchor.
 */
export const releaseTodoEntries = (cards: readonly ReleaseCardView[]): { id: string; label: string; anchor: string }[] =>
  cards.flatMap((c) => (c.rowId === null ? [] : [{ id: c.key, label: c.version === '' ? `(version not read)` : c.version, anchor: c.anchor }]));
