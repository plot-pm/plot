import { declaresSpelling, resolvePerson, type PersonDirectory } from '../entities/person.js';

/** The person fields a plan row's Owner reads, each `''` or absent where nothing names one. */
export interface PlanOwnerReadings {
  /** The plan's `Assignee:` line. */
  readonly assignee?: string;
  /** The Owner handle of a sprint that names the plan. */
  readonly sprintOwner?: string;
  /** The name in the plan's `Approved:` record. */
  readonly approver?: string;
  /** The git author of the commit that added the plan file. */
  readonly author?: string;
}

/**
 * The Owner a Release delivery plan row shows.
 *
 * The first of these that names someone: the plan's Assignee, the sprint Owner, the approver, the author. The
 * Assignee and the sprint Owner count as written; the approver and the author count only where the `People`
 * directory declares their spelling, because both are free text that can name a channel or a tool. A declared
 * spelling shows as its handle.
 *
 * @param readings - the plan's person fields.
 * @param directory - the declared `People` spellings; absent reads as none.
 * @returns the Owner's handle, the Assignee as written where the directory does not declare it, or `''`.
 */
export const planOwner = (readings: PlanOwnerReadings, directory: PersonDirectory = {}): string => {
  const handle = (raw: string): string => (declaresSpelling(raw, directory) ? resolvePerson(raw, directory).handle : raw);
  const assignee = readings.assignee?.trim() ?? '';
  if (assignee !== '') return handle(assignee);
  const sprintOwner = readings.sprintOwner?.trim() ?? '';
  if (sprintOwner !== '') return sprintOwner;
  const declared = [readings.approver, readings.author]
    .map((field) => field?.trim() ?? '')
    .find((field) => field !== '' && declaresSpelling(field, directory));
  return declared === undefined ? '' : handle(declared);
};
