import { resolvePerson, samePerson } from '../entities/person.js';

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
}

/**
 * What a row carries that says whose it is.
 *
 * - `pr` — a row with a PR; `author` is the host's handle, `''` or absent
 *   where the host did not answer.
 * - `agent` — a registry agent row; `identity` is `manifest` or `synthesized`,
 *   `state` is the agent's state word. Either is absent on an older server.
 * - `other` — a plan card, an issue, or a branch with no PR. None carries an
 *   owner.
 */
export type OwnedRow =
  | { kind: 'pr'; author?: string }
  | { kind: 'agent'; identity?: string; state?: string }
  | { kind: 'other' };

/** Agent states that say nothing about a desk on this machine. */
const NO_DESK_HERE: readonly string[] = ['elsewhere', 'unknown'];

/**
 * Whose a PR is, by its author against the reader's host login.
 *
 * Unknown where either side is empty, and where the reader's login is shaped
 * like an email: an email and a login are two spellings of one person, and
 * nothing here bridges them.
 */
const prOwnership = (author: string | undefined, reader: Reader): Ownership => {
  const login = reader.hostUser?.trim() ?? '';
  const by = author?.trim() ?? '';
  if (login === '' || by === '' || login.includes('@')) return 'unknown';
  return samePerson(resolvePerson(login), resolvePerson(by)) ? 'mine' : 'theirs';
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
