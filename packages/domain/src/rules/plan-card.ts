import { namesAPerson, resolvePerson, type PersonDirectory } from '../entities/person.js';

/**
 * The approver's raw spelling from an `Approved:` record, or `''` where the
 * record carries none.
 *
 * The record is `<date>, <who>, <channel detail>` — comma-separated free text,
 * so the `who` position is read positionally rather than by a keyed parse. A
 * legacy record of the bare-timestamp form (no comma at all) carries no name,
 * matching {@link namesAPerson}'s contract for a value that is not a name; the
 * template's own unfilled placeholder (`<who>`) is filtered separately, since
 * `namesAPerson` admits any single word and the angle brackets are not its
 * concern.
 *
 * @param approvedRaw - `PlanRecord.approvedRaw`, verbatim.
 * @returns the approver's raw spelling, or `''` where none is readable.
 */
export const planCardApprover = (approvedRaw: string): string => {
  const who = approvedRaw.split(',')[1]?.trim() ?? '';
  if (who.startsWith('<') && who.endsWith('>')) return '';
  return namesAPerson(who) ? who : '';
};

/** What `planCardView` reads of one plan. */
export interface PlanCardReading {
  /** The plan's `Type:` field, as the parser reports it; `''` where none is stated. */
  type: string;
  /** The person accountable for the plan, as the plan's `Assignee:` field spells it; `''` where none is stated. */
  assignee: string;
  /** The `Approved:` record verbatim, or `''`. */
  approvedRaw: string;
}

/** Everything a plan card needs to render its type badge and owner name. */
export interface PlanCardView {
  /** The plan's own type word, lowercased; `null` where the plan stated none. */
  readonly type: string | null;
  /** The owner's handle, resolved through `People`; `null` where nobody is readable. */
  readonly owner: string | null;
}

/**
 * The type badge and owner name a plan card renders.
 *
 * The owner is the plan's assignee before approval, and the `Approved:`
 * record's approver once the plan has one — the Design section's own rule,
 * not a user choice. Read from `approvedRaw` being non-empty rather than from
 * the plan's phase, since the record persists verbatim through every later
 * phase (`delivered`, `released`) and a phase check would have to name each
 * one. The plan file records no author, so the pre-approval owner is its
 * `Assignee:` field; a plan with no assignee and no readable approver has no
 * owner.
 *
 * @param reading - the plan's type, assignee and `Approved:` record.
 * @param directory - the declared `People` spellings; `{}` where none is declared.
 * @returns the card's type and owner, each `null` where the source holds no value.
 */
export const planCardView = (reading: PlanCardReading, directory: PersonDirectory = {}): PlanCardView => {
  const type = reading.type.trim() === '' ? null : reading.type.trim().toLowerCase();
  const rawOwner = reading.approvedRaw.trim() === '' ? reading.assignee.trim() : planCardApprover(reading.approvedRaw);
  const owner = rawOwner === '' ? null : resolvePerson(rawOwner, directory).handle;
  return { type, owner };
};
