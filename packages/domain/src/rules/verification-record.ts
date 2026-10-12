/**
 * The verification record a Delivered plan carries: the `Verified:` line in
 * `## Status` and the claim lines of `## Verification`, as
 * `verifiedValue` and `verificationBody` render them.
 */

import { fencedLines } from './fences.js';

/** What a Delivered plan's verification record answers. */
export type Verification = 'unverified' | 'supported' | 'refuted' | 'stale';

/** The plan as {@link verificationOf} reads it. */
export interface VerifiablePlan {
  /** The plan file's contents. */
  readonly text: string;
  /** `plot-plan-meta.sh`'s `tracer` reading: `Tracer: yes`. */
  readonly tracer: boolean;
  /** `plot-plan-meta.sh`'s `delivered_raw`: the `Delivered:` value, or `''`. */
  readonly deliveredRaw: string;
  /**
   * `plot-plan-meta.sh`'s `verified_raw`: the `Verified:` value of `## Status`
   * outside fenced blocks, or `''` for no line or a placeholder.
   */
  readonly verifiedRaw: string;
}

/** One refuted claim line of `## Verification`. */
export interface RefutedClaim {
  /** The claim's 1-based number. */
  readonly n: number;
  /** The claim's text. */
  readonly claim: string;
  /** The issue number the line names, or `null`. */
  readonly issue: number | null;
  /** The reason after `no issue:`, or `null`. */
  readonly noIssue: string | null;
}

/** Matches the record's delivery date and commit. */
const DELIVERY = /\bdelivery (\d{4}-\d{2}-\d{2}) at ([0-9a-f]{7,40})\b/;

/** Matches one claim line of `## Verification`. */
const CLAIM_LINE = /^[-*][ \t]+Claim-(\d+)[ \t]+(supported|refuted)[ \t]+—[ \t]+(.*)$/;

/** Matches the leading `YYYY-MM-DD` of a record value. */
const LEADING_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Reads the lines of the `## Verification` section, outside fenced blocks,
 * with a trailing carriage return removed from each line.
 */
const sectionLines = (text: string): string[] => {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  const fenced = fencedLines(lines);
  const body: string[] = [];
  let inside = false;
  for (const [i, line] of lines.entries()) {
    if (fenced[i]) continue;
    const heading = /^##[ \t]+(.*?)[ \t]*$/.exec(line);
    if (heading !== null) inside = heading[1]!.toLowerCase() === 'verification';
    else if (inside) body.push(line);
  }
  return body;
};

/**
 * Reads the refuted claims of a plan's `## Verification` section.
 *
 * A line the reader cannot parse into a claim number, a claim text and a
 * lens column is omitted, never guessed.
 *
 * @param text - the plan file's contents.
 * @returns the refuted claims in file order; empty where the section is absent.
 */
export const refutedClaims = (text: string): readonly RefutedClaim[] => {
  const claims: RefutedClaim[] = [];
  for (const line of sectionLines(text)) {
    const m = CLAIM_LINE.exec(line);
    if (m === null || m[2] !== 'refuted') continue;
    const parts = m[3]!.split(' — ');
    let issue: number | null = null;
    let noIssue: string | null = null;
    const tail = /^#(\d+)$/.exec(parts.at(-1)!) ?? null;
    const none = /^no issue:[ \t]*(.*)$/.exec(parts.at(-1)!) ?? null;
    if (tail !== null && parts.length > 2) {
      issue = Number(tail[1]);
      parts.pop();
    } else if (none !== null && parts.length > 2) {
      noIssue = none[1]!;
      parts.pop();
    }
    if (parts.length < 2) continue;
    parts.pop();
    claims.push({ n: Number(m[1]), claim: parts.join(' — '), issue, noIssue });
  }
  return claims;
};

/** True when `a` and `b` name one commit, whichever is the abbreviation. */
const sameCommit = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a);

/**
 * Answers the verification state of a Delivered plan from its text.
 *
 * `unverified` for a tracer plan, whatever it carries, and for a plan whose
 * `verifiedRaw` is `''`. `stale` when the record's delivery date differs from
 * the plan's `Delivered:` date, when the plan has no `Delivered:` date, when
 * `deliveryCommit` is given and differs from the record's delivery commit, or
 * when `## Verification` holds no claim line outside fenced blocks. Otherwise
 * `refuted` when any claim line says so and `supported` when none does. A
 * record whose delivery cannot be read is `stale`, never trusted.
 *
 * @param plan - the plan text and the three readings the parser supplies.
 * @param deliveryCommit - what `recordCommit(file, 'Delivered')` answered, or
 *   `null` where the caller has no reading.
 * @returns the verification state.
 */
export const verificationOf = (
  plan: VerifiablePlan,
  deliveryCommit: string | null,
): Verification => {
  if (plan.tracer) return 'unverified';
  const record = plan.verifiedRaw;
  if (record === '') return 'unverified';
  const delivered = LEADING_DATE.exec(plan.deliveredRaw)?.[0] ?? '';
  const named = DELIVERY.exec(record);
  if (delivered === '' || named === null || named[1] !== delivered) return 'stale';
  if (deliveryCommit !== null && deliveryCommit !== '' && !sameCommit(named[2]!, deliveryCommit)) {
    return 'stale';
  }
  const lines = sectionLines(plan.text).filter((line) => CLAIM_LINE.test(line));
  if (lines.length === 0) return 'stale';
  return lines.some((line) => CLAIM_LINE.exec(line)![2] === 'refuted') ? 'refuted' : 'supported';
};

/**
 * The text of a Delivered card's refuted badge, or `''` for no badge.
 *
 * Only a `refuted` state with at least one counted claim draws a badge, as
 * `<n> refuted`. `unverified`, `supported` and `stale` draw none, and a
 * `refuted` state whose claim lines could not be counted draws none rather than
 * a guessed number.
 *
 * @param state - what {@link verificationOf} answered.
 * @param refuted - how many claims {@link refutedClaims} read.
 * @returns the badge text, or `''`.
 */
export const refutedBadge = (state: Verification, refuted: number): string =>
  state === 'refuted' && refuted > 0 ? `${refuted} refuted` : '';
