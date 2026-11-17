import { declaresSpelling, resolvePerson, samePerson } from '../entities/person.js';
import { comparableLogin, type Reader } from './ownership.js';

/**
 * Whether the reader owns a sprint.
 *
 * Compares as a PR's ownership does: the reader's host login and the sprint's
 * Owner handle each resolve through the `People` directory, and the sprint is
 * the reader's only where both resolve to one person. The Owner must be a
 * spelling the directory declares; an undeclared handle belongs to nobody.
 *
 * @param ownerHandle - the sprint's `Owner:` handle as written, `''` where absent.
 * @param reader - who is reading.
 * @returns true only where the reader's host login and the Owner resolve to one person.
 *   False for an absent Owner, an undeclared Owner, and a reader with no comparable login.
 */
export const sprintIsMine = (ownerHandle: string, reader: Reader): boolean => {
  const login = comparableLogin(reader);
  const owner = ownerHandle.trim();
  if (login === '' || owner === '') return false;
  const directory = reader.directory ?? {};
  if (!declaresSpelling(owner, directory)) return false;
  return samePerson(resolvePerson(login, directory), resolvePerson(owner, directory));
};
