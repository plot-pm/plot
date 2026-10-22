import type { SprintOwner } from './issue-source.js';

/**
 * Compares a Plot sprint's items against a tracker Release's issues.
 *
 * The sprint file is the commitment and the Release is read beside it — this
 * rule never writes to either. Two findings travel apart, never folded into
 * one "mismatch" bucket: a Must-have the Release does not carry, and a
 * Release issue no sprint item — of any MoSCoW tier — names.
 */

/** One sprint item as this rule reads it. */
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
  /** Release issue keys no sprint item, of any MoSCoW tier, names. */
  readonly missingFromSprint: readonly string[];
  /** Must-haves whose key resolution found nothing — reported, never silently dropped. */
  readonly notCompared: readonly SprintReleaseItem[];
}

/**
 * Compares a sprint's items against a Release's issue keys.
 *
 * **Matching is by issue key only.** The caller supplies each item's key,
 * normally via {@link resolveItemKey}. An item with key `''` names no issue:
 * a Must-have is reported in `notCompared` rather than either drift list, and
 * its text is never matched against the Release.
 *
 * **The two directions read different tiers, on purpose.** `missingFromRelease`
 * and `notCompared` read Must-haves alone — only a Must-have is required to
 * ship in the Release, so a Should or Could item absent from it is not drift.
 * `missingFromSprint` reads Must-haves, Should-haves and Could-haves together:
 * a Release issue is accounted for if any tier names its key, regardless of
 * priority.
 *
 * @param mustHaves - the sprint's Must-have items, each with the issue key its plan names, or `''`.
 * @param releaseIssueKeys - the Jira keys `Tracker.versionRead` answered for the Release.
 * @param otherTiers - the sprint's Should-have and Could-have items, each with the issue key its plan names, or `''`; counted only toward `missingFromSprint`.
 * @returns the drift in both directions, plus the Must-haves no source named a key for.
 */
export const sprintReleaseDrift = (
  mustHaves: readonly SprintReleaseItem[],
  releaseIssueKeys: readonly string[],
  otherTiers: readonly SprintReleaseItem[] = [],
): SprintReleaseDrift => {
  const releaseKeys = new Set(releaseIssueKeys);
  const namedKeys = new Set(
    [...mustHaves, ...otherTiers].map((item) => item.issue).filter((issue) => issue !== ''),
  );
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
 * Resolves a tracker key from free text, scoped to this repository's declared
 * `Ticket prefixes`.
 *
 * **Absent is not false.** A missing or empty `ticketPrefixes` means no key is
 * matched, never "match any" — a bare Jira-shaped token in prose would
 * otherwise win over the real ticket, as `AP-2a` did before this existed.
 *
 * @param itemText - the text to search.
 * @param ticketPrefixes - this repository's own Jira project prefixes, from `## Plot Config`'s `Ticket prefixes`.
 * @returns the resolved key, or `''` where no prefix is declared or none matches.
 */
export const keyFromText = (itemText: string, ticketPrefixes: readonly string[]): string => {
  const prefixPattern = ticketPrefixes
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map(escapeRegExp)
    .join('|');
  if (prefixPattern === '') return '';
  const match = new RegExp(`\\b(${prefixPattern})-[0-9]+\\b`).exec(itemText);
  return match?.[0] ?? '';
};

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
  return keyFromText(itemText, ticketPrefixes);
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
