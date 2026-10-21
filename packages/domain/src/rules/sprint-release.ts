import type { SprintOwner } from './issue-source.js';

/**
 * Compares a Plot sprint's Must-haves against a tracker Release's issues.
 *
 * The sprint file is the commitment and the Release is read beside it — this
 * rule never writes to either. Two findings travel apart, never folded into
 * one "mismatch" bucket: a Must-have the Release does not carry, and a
 * Release issue no Must-have names.
 */

/** One Must-have as this rule reads it. */
export interface SprintReleaseItem {
  /** The sprint's own wording of the item. */
  text: string;
  /** The tracker issue key the item's plan names; `''` where it names none. */
  issue: string;
}

/** What the comparison found, in both directions, plus what named no key at all. */
export interface SprintReleaseDrift {
  /** Must-haves naming an issue the Release's `issues` does not carry. */
  readonly missingFromRelease: readonly SprintReleaseItem[];
  /** Release issue keys no Must-have names. */
  readonly missingFromSprint: readonly string[];
  /** Must-haves whose key resolution found nothing — reported, never silently dropped. */
  readonly notCompared: readonly SprintReleaseItem[];
}

/**
 * Compares Must-haves against a Release's issue keys.
 *
 * **Matching is by issue key only.** The caller supplies each Must-have's key,
 * normally via {@link resolveItemKey}. A Must-have with key `''` names no
 * issue: it is reported in `notCompared` rather than either drift list, and
 * its text is never matched against the Release.
 *
 * @param mustHaves - the sprint's Must-have items, each with the issue key its plan names, or `''`.
 * @param releaseIssueKeys - the Jira keys `Tracker.versionRead` answered for the Release.
 * @returns the drift in both directions, plus the items no source named a key for.
 */
export const sprintReleaseDrift = (
  mustHaves: readonly SprintReleaseItem[],
  releaseIssueKeys: readonly string[],
): SprintReleaseDrift => {
  const releaseKeys = new Set(releaseIssueKeys);
  const namedKeys = new Set(mustHaves.map((item) => item.issue).filter((issue) => issue !== ''));
  return {
    missingFromRelease: mustHaves.filter((item) => item.issue !== '' && !releaseKeys.has(item.issue)),
    missingFromSprint: releaseIssueKeys.filter((key) => !namedKeys.has(key)),
    notCompared: mustHaves.filter((item) => item.issue === ''),
  };
};

/** Matches a Jira-shaped key (`PROJ-123`) and nothing else — never a bare GitHub issue number. */
const JIRA_KEY = /[A-Z][A-Z0-9]*-[0-9]+/;

/** Escapes a string for literal use inside a `RegExp` pattern. */
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Resolves one Must-have's tracker key from three sources, first match wins.
 *
 * **The order is fixed:** the plan's `Issue:` line, then its `ticket:`
 * frontmatter, then the item's own text matched against `Ticket prefixes`.
 * `Issue:` wins because it is the field Plot itself writes and is
 * unambiguous; frontmatter is second because it is structured but not Plot's
 * own format; item text is last and scoped to `ticketPrefixes` so a
 * stray `PROJ-123`-shaped token in prose from an unrelated project is never
 * mis-matched.
 *
 * @param issueLineKeys - the plan's `issues` array (first Jira-shaped entry wins); `[]` where the plan names none there.
 * @param ticketFrontmatter - the plan's `ticket:` frontmatter value, verbatim; `''` where absent.
 * @param itemText - the Must-have's own wording, matched only against `ticketPrefixes`.
 * @param ticketPrefixes - this repository's own Jira project prefixes, from `## Plot Config`'s `Ticket prefixes`.
 * @returns the resolved key, or `''` where none of the three sources named one.
 */
export const resolveItemKey = (
  issueLineKeys: readonly string[],
  ticketFrontmatter: string,
  itemText: string,
  ticketPrefixes: readonly string[],
): string => {
  const fromIssueLine = issueLineKeys.find((key) => JIRA_KEY.test(key));
  if (fromIssueLine !== undefined) return fromIssueLine;
  const trimmedTicket = ticketFrontmatter.trim();
  if (trimmedTicket !== '' && JIRA_KEY.test(trimmedTicket)) return trimmedTicket;
  const prefixPattern = ticketPrefixes
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map(escapeRegExp)
    .join('|');
  if (prefixPattern === '') return '';
  const fromItemText = new RegExp(`\\b(${prefixPattern})-[0-9]+\\b`).exec(itemText);
  return fromItemText?.[0] ?? '';
};

/**
 * Decides whether a sprint's `Release:` target is read from the tracker.
 *
 * The Release is read only where Plot owns the sprint and the declared
 * tracker's scheme has a version concept. Every other repository reads
 * nothing and reports no Release drift.
 *
 * @param owner - the {@link SprintOwner} answer for this repository.
 * @param declaredTracker - the `Tracker` config key's value, verbatim; `''` where none is declared.
 * @param versionSchemes - the tracker schemes whose connector reads a version, as the adapters declare them.
 * @returns `true` where the Release is read.
 */
export const releaseIsRead = (
  owner: SprintOwner,
  declaredTracker: string,
  versionSchemes: readonly string[],
): boolean => {
  const scheme = declaredTracker.trim().split(/\s+/, 1).join('').toLowerCase();
  return owner.owns === 'plot' && versionSchemes.includes(scheme);
};
