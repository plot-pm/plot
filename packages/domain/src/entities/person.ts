/**
 * A human a record names.
 *
 * Identity: slug — the handle, chosen by a person. State source: none; a
 * Person is not derived from anywhere, because nothing in the estate resolves
 * one human's two spellings to one identity.
 *
 * Two fields, and only the first is identity. There is no email, no avatar and
 * no role: an email is a git artefact and a privacy surface, and a role is a
 * permission Plot does not model.
 */
export interface Person {
  /** The identity — stable, lowercase, what records should carry. */
  handle: string;
  /** What a record may render; `''` when unknown. */
  displayName: string;
}

/**
 * A declared correspondence between spellings and handles.
 *
 * Keys are raw spellings as they appear in artefacts; values are the handle
 * each resolves to. Handles and display names correspond by convention rather
 * than by derivation, so this mapping is supplied rather than inferred.
 */
export type PersonDirectory = Readonly<Record<string, string>>;

/** Trims a raw spelling and lowercases it, the form the directory is keyed by. */
const normalize = (raw: string): string => raw.trim().toLowerCase();

/**
 * Resolves a raw spelling to a Person against a declared directory.
 *
 * Where the spelling is not declared, the Person carries the raw value as its
 * handle and an empty display name rather than a guess: an unrecognised
 * spelling is unresolved, never resolved to something similar.
 *
 * @param raw - the spelling as an artefact wrote it.
 * @param directory - the declared spelling-to-handle mapping.
 * @returns the resolved Person, or the unresolved one carrying `raw`.
 */
export const resolvePerson = (raw: string, directory: PersonDirectory = {}): Person => {
  const key = normalize(raw);
  const handle = directory[key];
  return handle === undefined
    ? { handle: key, displayName: '' }
    : { handle, displayName: raw.trim() };
};

/**
 * Whether two Persons are the same human.
 *
 * Compares handles only. Two records rendering different display names for one
 * handle are the same person.
 *
 * @param one - a Person.
 * @param other - the Person to compare against.
 * @returns true when both carry the same handle.
 */
export const samePerson = (one: Person, other: Person): boolean => one.handle === other.handle;

/**
 * Whether a raw spelling names anybody at all.
 *
 * A transition record is comma-separated free text whose fields may themselves
 * contain commas, so the `who` position can hold a prose clause rather than a
 * name. Such a value resolves to no Person.
 *
 * @param raw - the spelling to test.
 * @returns true when the value is a name rather than empty or a prose clause.
 */
export const namesAPerson = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed === '') return false;
  // A clause reads as several words; a name and a handle do not. Four measured
  // `Approved:` records hold a sentence in the position a name belongs.
  return trimmed.split(/\s+/).length <= 3;
};
