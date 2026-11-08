/**
 * A human a record names.
 *
 * Identity: slug — the handle, chosen by a person. State source: the
 * `People` key of `## Plot Config`, read by {@link parsePersonDirectory}; a
 * Person is declared there rather than derived, because no reading in the
 * estate knows that two spellings name one human.
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
 * Whether a raw spelling is declared in the directory.
 *
 * @param raw - the spelling as an artefact wrote it.
 * @param directory - the declared spelling-to-handle mapping.
 * @returns true when the directory maps the spelling to a handle.
 */
export const declaresSpelling = (raw: string, directory: PersonDirectory): boolean =>
  directory[normalize(raw)] !== undefined;

/** `Name <body>`: a spelling that ends in an angle-bracketed body. */
const ANGLE_SPELLING = /^([^<>]*)<([^<>]*)>\s*$/;

/** Whether `body` reads `<tracker>:<account>` with both parts non-empty. */
const isTrackerIdentity = (body: string): boolean => {
  const colon = body.indexOf(':');
  return colon > 0 && body.slice(colon + 1).trim() !== '' && body.slice(0, colon).trim() !== '';
};

/**
 * Reads a directory from its `## Plot Config` form.
 *
 * The form is `handle = Spelling, Spelling; handle = Spelling`: one entry per
 * person, separated by `;`, each naming the handle and then the other
 * spellings of that person. Every handle also resolves to itself, so an entry
 * with no `=` declares a person with one spelling. Handles are lowercased. A
 * spelling may carry a tracker prefix, `<tracker>:<account>` (for example
 * `jira:jan.wloka@quatico.com`), to declare that tracker's account for the
 * handle alongside its ordinary spellings; the prefix is part of the spelling,
 * compared and stored like any other free text. The same fact may be written
 * `Name <tracker:account>`, which declares the two spellings `Name` and
 * `tracker:account`, so both forms give one directory. An angle body that is
 * not `<tracker:account>` with both parts non-empty (`<jira:>`, `<:acct>`,
 * `<plain text>`) declares no account and the whole text stays one spelling. A
 * `,` or `;` inside `<…>` is not supported.
 *
 * A spelling that two entries claim for different handles resolves to nobody:
 * it is dropped, so it stays undeclared.
 *
 * @param text - the config value; `''` or absent where none is declared.
 * @returns the directory, empty where `text` declares nobody.
 */
export const parsePersonDirectory = (text: string | undefined): PersonDirectory => {
  const claims = new Map<string, Set<string>>();
  const claim = (spelling: string, handle: string): void => {
    const key = normalize(spelling);
    if (key === '') return;
    claims.set(key, (claims.get(key) ?? new Set()).add(handle));
  };
  for (const entry of (text ?? '').split(';')) {
    // `split` ALWAYS yields at least one element, so the first is a string at
    // runtime whatever `noUncheckedIndexedAccess` says. A `?? ''` or a
    // destructuring default here is a branch no input can take, and the
    // domain's branch gate is 100% — so the index is asserted, not guarded.
    const parts = entry.split('=');
    const handle = normalize(parts[0] as string);
    const rest = parts.slice(1);
    if (handle === '') continue;
    claim(handle, handle);
    for (const spelling of rest.join('=').split(',')) {
      const angle = ANGLE_SPELLING.exec(spelling);
      const body = angle === null ? '' : (angle[2] as string);
      if (angle === null || !isTrackerIdentity(body)) {
        claim(spelling, handle);
        continue;
      }
      claim(angle[1] as string, handle);
      claim(body, handle);
    }
  }
  const directory: Record<string, string> = {};
  for (const [key, handles] of claims) {
    if (handles.size === 1) directory[key] = [...handles][0] as string;
  }
  return directory;
};

/**
 * The accounts a handle holds on one tracker.
 *
 * Scans the directory for `<tracker>:<account>` spellings that resolve to the
 * handle. Accounts come back lowercased, as the directory stores them. An empty
 * list means no account is declared: the caller reads it as unknown, never as
 * "has no tickets".
 *
 * @param handle - the person's handle; trimmed and lowercased.
 * @param tracker - the tracker name, such as `jira`; trimmed and lowercased.
 * @param directory - the declared spelling-to-handle mapping.
 * @returns the accounts, sorted; `[]` where none is declared.
 */
export const trackerAccountsOf = (
  handle: string,
  tracker: string,
  directory: PersonDirectory,
): readonly string[] => {
  const want = normalize(handle);
  const prefix = `${normalize(tracker)}:`;
  return Object.entries(directory)
    .filter(([key, value]) => value === want && key.startsWith(prefix) && key.length > prefix.length)
    .map(([key]) => key.slice(prefix.length))
    .sort();
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
