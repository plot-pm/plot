import type { IssueIndexRow } from '../entities/issue-index.js';
import { releaseOf } from './release-of.js';

/** The one field of an issue row the release counts read. */
export type ReleaseRow = Pick<IssueIndexRow, 'releases'>;

/**
 * What the issue index held, as the release counts read it.
 *
 * `open` is null where no usable index exists (missing file, old version, unparseable). `closed` is null where no closed read has answered.
 */
export interface ReleaseTicketReading {
  readonly open: readonly ReleaseRow[] | null;
  readonly closed: readonly ReleaseRow[] | null;
  /** Whether the closed rows hold every issue closed since `closedSince`. */
  readonly closedComplete: boolean;
  /** The earliest closing time the closed read asked for, ISO-8601; null where unknown. */
  readonly closedSince: string | null;
}

/** The three counts of one release; `closed` is null where the closed set was never read. */
export interface ReleaseTicketCounts {
  readonly planned: number;
  readonly untriaged: number;
  readonly closed: number | null;
  /** True where the closed set can miss early closures of the release. */
  readonly closedPartial: boolean;
}

/** A sprint's target release and the day its sprint began. */
export interface ReleaseTarget {
  readonly release: string;
  readonly started: string;
}

const day = (value: string): number => Date.parse(value.slice(0, 10));

/**
 * The release versions the Active sprints target, one entry per distinct name.
 *
 * A sprint naming no release adds none. Two sprints naming one release share an entry whose `started` is the earlier start; a start that does not parse is ignored unless no sprint of the release has a parsable one, and then `started` is `''`.
 *
 * @param sprints - each Active sprint's `Release:` and `Start:` values.
 */
export const releaseTargets = (sprints: readonly ReleaseTarget[]): ReleaseTarget[] => {
  const byRelease = new Map<string, string>();
  for (const { release, started } of sprints) {
    const name = release.trim();
    if (name === '') continue;
    const held = byRelease.get(name);
    const valid = Number.isNaN(day(started)) ? '' : started;
    if (held === undefined || held === '' || (valid !== '' && day(valid) < day(held))) {
      byRelease.set(name, valid === '' && held !== undefined ? held : valid);
    }
  }
  return [...byRelease].map(([release, started]) => ({ release, started }));
};

/**
 * The tickets of one release: planned, untriaged and closed.
 *
 * - planned: open rows whose `releases` name the version exactly (`releaseOf`).
 * - closed: closed rows whose `releases` name the version exactly.
 * - untriaged: open rows with `releases: []` — the tracker was asked and named no release. A row with no `releases` was never asked and counts as neither planned nor untriaged.
 *
 * Returns null where the counts would be a guess: no index, or no open row states a release. The closed count is partial where the closed read is not complete or the sprint began before the window's start.
 *
 * @param reading - the issue index as read.
 * @param version - the release version's name.
 * @param started - the day the targeting sprint began, or `''`.
 */
export const releaseTicketCounts = (
  reading: ReleaseTicketReading,
  version: string,
  started = '',
): ReleaseTicketCounts | null => {
  const { open, closed } = reading;
  if (open === null || !open.some((row) => row.releases !== undefined)) return null;
  const planned = open.filter((row) => releaseOf(row, version)).length;
  const untriaged = open.filter((row) => row.releases !== undefined && row.releases.length === 0).length;
  const since = reading.closedSince === null ? Number.NaN : day(reading.closedSince);
  const beforeWindow = !Number.isNaN(since) && !Number.isNaN(day(started)) && day(started) < since;
  return {
    planned,
    untriaged,
    closed: closed === null ? null : closed.filter((row) => releaseOf(row, version)).length,
    closedPartial: !reading.closedComplete || beforeWindow,
  };
};

/**
 * The wording the release line appends for one release, or null where the counts are unread.
 *
 * `2.32.0 tickets: closed 5+ · planned 3 · untriaged 2`. A partial closed count carries a `+`; an unread closed set prints no closed count.
 */
export const releaseTicketWording = (
  reading: ReleaseTicketReading,
  version: string,
  started = '',
): string | null => {
  const counts = releaseTicketCounts(reading, version, started);
  if (counts === null) return null;
  const parts = [
    ...(counts.closed === null ? [] : [`closed ${counts.closed}${counts.closedPartial ? '+' : ''}`]),
    `planned ${counts.planned}`,
    `untriaged ${counts.untriaged}`,
  ];
  return `${version} tickets: ${parts.join(' · ')}`;
};
