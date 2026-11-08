import type { IssueIndexRow } from '../entities/issue-index.js';

/**
 * Whether a ticket is planned for a release.
 *
 * The version is compared as a name, exactly, against each of the row's
 * `releases`: `2.32` does not match `2.32.0`. A row with no `releases` was not
 * asked for them and answers false, as does `releases: []`; callers that must
 * tell those two apart read `row.releases` itself.
 *
 * @param row - the issue index row.
 * @param version - the release version's name.
 * @returns true where one of the row's releases is the version.
 */
export const releaseOf = (row: IssueIndexRow, version: string): boolean =>
  row.releases?.includes(version) ?? false;
