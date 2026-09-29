import { declaresSpelling, resolvePerson, samePerson, type PersonDirectory } from '../entities/person.js';

/**
 * Whose a row is, as far as the board can tell.
 *
 * - `mine` — the reader owns it.
 * - `theirs` — somebody else owns it.
 * - `unknown` — the owner cannot be determined from what the row carries.
 */
export type Ownership = 'mine' | 'theirs' | 'unknown';

/**
 * Who is reading — the identity fields the board's `ServerInfo` carries.
 *
 * Each is `''` or absent where it could not be read. An older server sends
 * neither, and the client casts rather than parses, so both are optional.
 */
export interface Reader {
  /** The git host login this machine is signed in as. */
  hostUser?: string;
  /** Git's `user.email`. Never compared against a PR author. */
  gitEmail?: string;
  /**
   * The declared spellings of each person, from the `People` config key.
   * Absent or empty where none is declared.
   */
  directory?: PersonDirectory;
}

/**
 * What a row carries that says whose it is.
 *
 * - `pr` — a row with a PR; `author` is the host's handle, `''` or absent
 *   where the host did not answer.
 * - `agent` — a registry agent row; `identity` is `manifest` or `synthesized`,
 *   `state` is the agent's state word. Either is absent on an older server.
 * - `plan` — a plan card; `assignee` is the plan's `Assignee:` line, free
 *   text, `''` or absent where the plan names nobody.
 * - `other` — an issue, a build, or a branch with no PR. None carries an
 *   owner.
 */
export type OwnedRow =
  | { kind: 'pr'; author?: string }
  | { kind: 'agent'; identity?: string; state?: string }
  | { kind: 'plan'; assignee?: string }
  | { kind: 'other' };

/** Agent states that say nothing about a desk on this machine. */
const NO_DESK_HERE: readonly string[] = ['elsewhere', 'unknown'];

/**
 * The reader's host login, or `''` where it cannot be compared: absent, empty,
 * or shaped like an email. An email and a login are two spellings of one
 * person, and nothing here bridges them.
 */
const comparableLogin = (reader: Reader): string => {
  const login = reader.hostUser?.trim() ?? '';
  return login.includes('@') ? '' : login;
};

/**
 * Whose a PR is, by its author against the reader's host login.
 *
 * Both are host handles, so an author that resolves to another person is
 * somebody else's. Unknown where either side is empty.
 */
const prOwnership = (author: string | undefined, reader: Reader): Ownership => {
  const login = comparableLogin(reader);
  const by = author?.trim() ?? '';
  if (login === '' || by === '') return 'unknown';
  const directory = reader.directory ?? {};
  return samePerson(resolvePerson(login, directory), resolvePerson(by, directory)) ? 'mine' : 'theirs';
};

/**
 * Whose a plan is, by its `Assignee:` line against the reader's host login.
 *
 * `mine` where the assignee resolves to the reader. `theirs` only where the
 * directory declares the assignee's spelling for another person: an assignee
 * is free text, so an undeclared spelling that differs from the login may
 * still be the reader, and is unknown. Unknown where either side is empty.
 */
const planOwnership = (assignee: string | undefined, reader: Reader): Ownership => {
  const login = comparableLogin(reader);
  const by = assignee?.trim() ?? '';
  if (login === '' || by === '') return 'unknown';
  const directory = reader.directory ?? {};
  if (samePerson(resolvePerson(login, directory), resolvePerson(by, directory))) return 'mine';
  return declaresSpelling(by, directory) ? 'theirs' : 'unknown';
};

/**
 * Whose an agent row is, by the machine's own record.
 *
 * `mine` where this machine's registry declared the agent and its desk is on
 * this machine. Unknown for an agent inferred from a desk with no manifest,
 * and for one whose state says no desk is here.
 */
const agentOwnership = (identity: string | undefined, state: string | undefined): Ownership =>
  identity === 'manifest' && state !== undefined && state !== '' && !NO_DESK_HERE.includes(state)
    ? 'mine'
    : 'unknown';

/**
 * Whose a row is.
 *
 * @param row - what the row carries that names an owner.
 * @param reader - who is reading.
 * @returns `mine`, `theirs`, or `unknown` where the row names no determinable
 *   owner.
 */
export const ownership = (row: OwnedRow, reader: Reader): Ownership => {
  switch (row.kind) {
    case 'pr':
      return prOwnership(row.author, reader);
    case 'agent':
      return agentOwnership(row.identity, row.state);
    case 'plan':
      return planOwnership(row.assignee, reader);
    default:
      return 'unknown';
  }
};

/**
 * Whether a row stays in view when the board shows only the reader's work.
 *
 * True for `mine` and for `unknown`: a row whose owner cannot be determined is
 * shown. Only a row somebody else owns answers false.
 *
 * @param row - what the row carries that names an owner.
 * @param reader - who is reading.
 * @returns false only where the row is somebody else's.
 */
export const isMine = (row: OwnedRow, reader: Reader): boolean => ownership(row, reader) !== 'theirs';
