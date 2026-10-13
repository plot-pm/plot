import { declaresSpelling, resolvePerson, samePerson, type PersonDirectory } from '../entities/person.js';
import type { IssueSource } from './issue-source.js';

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
 * The service a ticket's assignee is compared against: the `IssueSource` the
 * board resolved, narrowed to the word {@link ticketOwnership} matches on.
 */
export type TicketSource = 'github' | 'bitbucket' | 'jira';

/**
 * What a row carries that says whose it is.
 *
 * - `pr` — a row with a PR; `author` is the host's handle, `''` or absent
 *   where the host did not answer.
 * - `agent` — a registry agent row; `identity` is `manifest` or `synthesized`,
 *   `state` is the agent's state word. Either is absent on an older server.
 * - `plan` — a plan card; `assignee` is the plan's `Assignee:` line, free
 *   text, `''` or absent where the plan names nobody.
 * - `ticket` — an issue row; `assignees` is the tracker's assignee list, `[]`
 *   where nobody is assigned; `source` is whose vocabulary the assignees are
 *   written in, `null` where the board could not resolve it.
 * - `other` — a build, or a branch with no PR. None carries an owner.
 */
export type OwnedRow =
  | { kind: 'pr'; author?: string }
  | { kind: 'agent'; identity?: string; state?: string }
  | { kind: 'plan'; assignee?: string }
  | { kind: 'ticket'; assignees?: string[]; source?: TicketSource | null }
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
 * The tracker prefix a `jira:` spelling declares, lowercased.
 *
 * `jira` is the only tracker scheme {@link ticketOwnership} resolves through a
 * declared spelling today — a `git-host` ticket's assignee is a host login,
 * compared directly as {@link prOwnership} does.
 */
const JIRA_PREFIX = 'jira:';

/**
 * Whose a ticket's assignee is, where the source is `jira`: never compared to
 * the reader's host login directly, only through a declared `jira:` spelling.
 *
 * `mine` where a `jira:` spelling of the reader's handle names any assignee.
 * `theirs` where a `jira:` spelling of another handle names one. `unknown`
 * where no handle's `jira:` spelling names any assignee — including where the
 * directory declares none at all.
 */
const jiraTicketOwnership = (assignees: string[], reader: Reader): Ownership => {
  const login = comparableLogin(reader);
  if (login === '') return 'unknown';
  const directory = reader.directory ?? {};
  const self = resolvePerson(login, directory);
  for (const assignee of assignees) {
    const spelling = `${JIRA_PREFIX}${assignee.trim()}`;
    if (!declaresSpelling(spelling, directory)) continue;
    if (samePerson(resolvePerson(spelling, directory), self)) return 'mine';
    return 'theirs';
  }
  return 'unknown';
};

/**
 * Whose a ticket is, by its assignees against the reader's host login.
 *
 * A `github`/`bitbucket` assignee is a host login, matched as {@link
 * prOwnership} matches a PR author: an exact match counts even with no
 * declared spelling. A `jira` assignee only resolves through a declared
 * `jira:` spelling, as {@link jiraTicketOwnership}. A `null` source, or an
 * empty assignee list, is `unknown` — unassigned is not `theirs`.
 *
 * Every assignee is checked; any match is `mine`.
 */
const ticketOwnership = (
  assignees: string[] | undefined, source: TicketSource | null | undefined, reader: Reader,
): Ownership => {
  const list = assignees ?? [];
  if (list.length === 0 || source === null || source === undefined) return 'unknown';
  if (source === 'jira') return jiraTicketOwnership(list, reader);
  const login = comparableLogin(reader);
  if (login === '') return 'unknown';
  const directory = reader.directory ?? {};
  const self = resolvePerson(login, directory);
  let sawTheirs = false;
  for (const assignee of list) {
    const by = assignee.trim();
    if (by === '') continue;
    if (samePerson(resolvePerson(by, directory), self)) return 'mine';
    sawTheirs = true;
  }
  return sawTheirs ? 'theirs' : 'unknown';
};

/**
 * Maps a resolved `IssueSource` and git-host backend to the vocabulary a
 * ticket's assignees are written in.
 *
 * A declared tracker names its own scheme: `jira` reads as `jira`,
 * `github-issues` as `github`. A repository with no declared tracker asks its
 * git host, so its assignees are host logins — `github` and `bitbucket`
 * resolve, and a backend this board has not resolved, or any other backend,
 * answers `null`.
 *
 * @param source - who answers the open-issue list, from {@link issueSource}.
 * @param backend - the git host's resolved backend word; ignored for `tracker`.
 * @returns the source a ticket's assignees are compared against, or `null`
 *   where it cannot be determined.
 */
export const ticketSourceOf = (source: IssueSource, backend: string): TicketSource | null => {
  if (source.ask === 'tracker') {
    if (source.scheme === 'jira') return 'jira';
    if (source.scheme === 'github-issues') return 'github';
    return null;
  }
  if (source.ask === 'git-host') {
    if (backend === 'github') return 'github';
    if (backend === 'bitbucket') return 'bitbucket';
    return null;
  }
  return null;
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
    case 'ticket':
      return ticketOwnership(row.assignees, row.source, reader);
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
