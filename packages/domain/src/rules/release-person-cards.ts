import { declaresSpelling, resolvePerson, samePerson, type PersonDirectory } from '../entities/person.js';
import type { DeliveryInput, DeliveryReadings } from './delivery-placement.js';
import type { CountedSlice } from './slice-states.js';
import { sprintBarOf, type BarSegment, type SprintCardSprint } from './sprint-card.js';

/** The sprint fields a person card reads. */
export type PersonCardSprint = Pick<SprintCardSprint, 'slug' | 'title' | 'release' | 'ownerHandle' | 'members'>;

/** The label of the card for sprints that carry no Owner. */
export const NO_OWNER_LABEL = 'no owner';

/** The words a bar shows in place of segments where a named plan has no merge answer. */
export const READING_MISSING_TEXT = 'The merge reading for this sprint is missing.';

/** One sprint's bar on a person card. */
export interface PersonSprintBar {
  readonly slug: string;
  readonly title: string;
  /** Five segments in `SLICE_STATES` order, or `null` where a named plan has no merge answer. */
  readonly bar: readonly BarSegment[] | null;
  readonly total: number;
  readonly readingMissing: boolean;
  /** `READING_MISSING_TEXT` where the reading is missing, `''` otherwise. */
  readonly missingText: string;
}

/** One card: a sprint owner and a bar per sprint of the release that owner holds. */
export interface PersonCard {
  /** Identity of the card: the resolved handle, `raw:<handle>` for an undeclared Owner, `''` for no owner. */
  readonly key: string;
  /** The Owner's display name, the handle as written for an undeclared Owner, or `NO_OWNER_LABEL`. */
  readonly label: string;
  readonly sprints: readonly PersonSprintBar[];
}

/**
 * The person cards of one target release: one per sprint owner, each with a bar per sprint.
 *
 * Sprints that name `release` are grouped by the Owner `resolvePerson` resolves, so two spellings of one
 * person give one card. A sprint with an empty Owner goes on one trailing `no owner` card. An Owner the
 * directory does not declare keeps a card under the handle as written and is never merged with another
 * handle or with `no owner`. A release no sprint names (`''`) has no cards. Each bar is `sprintBarOf`.
 *
 * @param sprints - the Active sprints.
 * @param release - the target release of the block.
 * @param directory - the declared `People` spellings.
 * @param slicesByPlan - the counted slices per plan key.
 * @param readings - the work items and agents as measured.
 * @param input - the `Auto-review` key and the `Correction budget`.
 */
export const releasePersonCards = (
  sprints: readonly PersonCardSprint[],
  release: string,
  directory: PersonDirectory,
  slicesByPlan: ReadonlyMap<string, readonly CountedSlice[] | undefined>,
  readings: DeliveryReadings,
  input: DeliveryInput,
): PersonCard[] => {
  if (release === '') return [];
  const groups: { key: string; label: string; person: ReturnType<typeof resolvePerson> | null; sprints: PersonSprintBar[] }[] = [];
  for (const sprint of sprints) {
    if (sprint.release !== release) continue;
    const handle = sprint.ownerHandle.trim();
    const person = handle === '' ? null : resolvePerson(handle, directory);
    const declared = handle !== '' && declaresSpelling(handle, directory);
    const group = groups.find((g) => (person === null ? g.person === null : g.person !== null && samePerson(g.person, person)));
    const bar = sprintBarOf(sprint, slicesByPlan, readings, input);
    const entry: PersonSprintBar = {
      slug: sprint.slug,
      title: sprint.title,
      bar: bar.bar,
      total: bar.total,
      readingMissing: bar.readingMissing,
      missingText: bar.readingMissing ? READING_MISSING_TEXT : '',
    };
    if (group !== undefined) {
      group.sprints.push(entry);
      continue;
    }
    const label = person === null ? NO_OWNER_LABEL : declared ? person.displayName : handle;
    const key = person === null ? '' : declared ? person.handle : `raw:${handle}`;
    groups.push({ key, label, person, sprints: [entry] });
  }
  const owned = groups.filter((g) => g.person !== null);
  const none = groups.filter((g) => g.person === null);
  return [...owned, ...none].map(({ key, label, sprints: bars }) => ({ key, label, sprints: bars }));
};
