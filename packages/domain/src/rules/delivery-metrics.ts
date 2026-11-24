/**
 * Delivery metrics per ISO week: merged pull requests, plans approved,
 * delivered and released, the median days from approval to delivery and from
 * design to approval, and the approvals per approver.
 */

import { approverOf } from '../entities/plan.js';

/** The four dated transition records of one plan, as written after their field name. */
export interface PlanTransitions {
  /** The `Design:` record, or `''`. */
  readonly design: string;
  /** The `Approved:` record, or `''`. */
  readonly approved: string;
  /** The `Delivered:` record, or `''`. */
  readonly delivered: string;
  /** The `Released:` record, or `''`. */
  readonly released: string;
}

/** One ISO week: its year, its number and the UTC day its Monday falls on. */
export interface IsoWeek {
  /** The ISO week-numbering year, which can differ from the calendar year. */
  readonly year: number;
  /** The week number, 1 to 53. */
  readonly week: number;
  /** The Monday of the week, as epoch milliseconds at 00:00 UTC. */
  readonly monday: number;
}

/** One row of {@link deliveryMetrics}. */
export interface DeliveryWeek {
  /** The week, as `YYYY-Www`. */
  readonly week: string;
  /** Merged pull requests in the week, or `'unread'` where the index could not be read. */
  readonly merged: number | 'unread';
  /** Plans whose `Approved:` date falls in the week. */
  readonly approved: number;
  /** Plans whose `Delivered:` date falls in the week. */
  readonly delivered: number;
  /** Plans whose `Released:` date falls in the week. */
  readonly released: number;
  /** The median days from `Approved:` to `Delivered:` over the week's deliveries, or `null`. */
  readonly leadDays: number | null;
  /** The median days from `Design:` to `Approved:` over the week's deliveries, or `null`. */
  readonly designDays: number | null;
  /** Approvals in the week per approver, the second field of the `Approved:` record. */
  readonly approvers: ReadonlyMap<string, number>;
}

const DAY_MS = 86_400_000;

/** The approver key for an `Approved:` record that names no second field. */
export const UNNAMED_APPROVER = '-';

/** A field's record line inside `## Status`: `- **Field:** value`. */
const RECORD = /^[ \t]*[-*][ \t]*\*\*(Design|Approved|Delivered|Released):\*\*[ \t]*(.*)$/;

/** The leading calendar date of a record, `YYYY-MM-DD`. */
const LEADING_DATE = /^(\d{4})-(\d{2})-(\d{2})(?![\d])/;

/**
 * Reads the four transition records out of a plan file's `## Status` section.
 *
 * The first record of a field that holds a value wins. A value that is only an
 * HTML comment, such as the template's `<!-- YYYY-MM-DD -->`, holds none.
 *
 * @param text - the plan file's contents.
 * @returns the records, each `''` where the section holds none.
 */
export const planTransitionsOf = (text: string): PlanTransitions => {
  const found: Record<string, string> = { Design: '', Approved: '', Delivered: '', Released: '' };
  let inStatus = false;
  for (const line of text.split('\n')) {
    if (/^##[ \t]/.test(line)) {
      inStatus = /^##[ \t]+Status[ \t]*$/.test(line);
      continue;
    }
    if (!inStatus) continue;
    const match = RECORD.exec(line);
    if (match === null) continue;
    const value = match[2].replace(/<!--.*?(-->|$)/g, '').trim();
    if (found[match[1]] === '' && value !== '') found[match[1]] = value;
  }
  return { design: found.Design, approved: found.Approved, delivered: found.Delivered, released: found.Released };
};

/**
 * The UTC day a record's leading date names.
 *
 * @param record - a transition record, such as `2026-11-24, jwloka, pr`.
 * @returns epoch milliseconds at 00:00 UTC, or `null` where the record starts
 *   with no valid calendar date.
 */
export const recordDay = (record: string): number | null => {
  const match = LEADING_DATE.exec(record.trim());
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = Date.UTC(year, month - 1, day);
  const back = new Date(at);
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? at : null;
};

/**
 * The ISO week an instant falls in, read in UTC.
 *
 * @param at - epoch milliseconds.
 * @returns the week.
 */
export const isoWeekOf = (at: number): IsoWeek => {
  const day = Math.floor(at / DAY_MS) * DAY_MS;
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  const monday = day - weekday * DAY_MS;
  const thursday = new Date(monday + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return { year, week, monday };
};

/**
 * The `count` ISO weeks that end with the week of `now`, oldest first.
 *
 * @param now - epoch milliseconds.
 * @param count - how many weeks; a value below 1 gives none.
 * @returns the weeks.
 */
export const lastIsoWeeks = (now: number, count: number): IsoWeek[] => {
  const current = isoWeekOf(now);
  const weeks: IsoWeek[] = [];
  for (let back = count - 1; back >= 0; back--) weeks.push(isoWeekOf(current.monday - back * 7 * DAY_MS));
  return weeks;
};

/**
 * The week's label, `YYYY-Www`.
 *
 * @param week - the week.
 * @returns the label.
 */
export const weekLabel = (week: IsoWeek): string => `${week.year}-W${String(week.week).padStart(2, '0')}`;

/**
 * The median of a list of numbers. An even count takes the mean of the two
 * middle values.
 *
 * @param values - the numbers.
 * @returns the median, or `null` for an empty list.
 */
export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * One row per week over the plans' transition records and the index's merged rows.
 *
 * A plan counts as approved, delivered or released in the week of that
 * record's date. A record whose value starts with no valid date counts
 * nowhere. A plan with an `Approved:` and a `Delivered:` date adds its
 * approval-to-delivery days to its delivery week's lead time, and one that
 * also has a `Design:` date adds its design-to-approval days to the same
 * week's design time. Both are medians.
 *
 * @param plans - each plan's transition records.
 * @param mergedPrs - the `mergedAt` of each MERGED row in the PR index, or
 *   `null` where the index could not be read: every row then reports
 *   `merged: 'unread'`, never 0.
 * @param weeks - the weeks to report, in the order to report them.
 * @returns one row per week, in the order of `weeks`.
 */
export const deliveryMetrics = (
  plans: readonly PlanTransitions[],
  mergedPrs: readonly string[] | null,
  weeks: readonly IsoWeek[],
): DeliveryWeek[] => {
  const keyOf = (at: number): string => weekLabel(isoWeekOf(at));
  const wanted = new Set(weeks.map(weekLabel));
  const tally = new Map<string, { merged: number; approved: number; delivered: number; released: number; lead: number[]; design: number[]; approvers: Map<string, number> }>();
  for (const label of wanted) tally.set(label, { merged: 0, approved: 0, delivered: 0, released: 0, lead: [], design: [], approvers: new Map() });
  const at = (day: number | null) => (day === null ? undefined : tally.get(keyOf(day)));

  for (const plan of plans) {
    const design = recordDay(plan.design);
    const approved = recordDay(plan.approved);
    const delivered = recordDay(plan.delivered);
    const released = recordDay(plan.released);
    const approvedWeek = at(approved);
    if (approvedWeek !== undefined) {
      approvedWeek.approved += 1;
      const who = approverOf(plan.approved) || UNNAMED_APPROVER;
      approvedWeek.approvers.set(who, (approvedWeek.approvers.get(who) ?? 0) + 1);
    }
    const deliveredWeek = at(delivered);
    if (deliveredWeek !== undefined && delivered !== null) {
      deliveredWeek.delivered += 1;
      if (approved !== null) {
        deliveredWeek.lead.push((delivered - approved) / DAY_MS);
        if (design !== null) deliveredWeek.design.push((approved - design) / DAY_MS);
      }
    }
    const releasedWeek = at(released);
    if (releasedWeek !== undefined) releasedWeek.released += 1;
  }

  if (mergedPrs !== null) {
    for (const mergedAt of mergedPrs) {
      const when = Date.parse(mergedAt);
      if (Number.isNaN(when)) continue;
      const week = tally.get(keyOf(when));
      if (week !== undefined) week.merged += 1;
    }
  }

  return weeks.map((week) => {
    const label = weekLabel(week);
    const t = tally.get(label)!;
    return {
      week: label,
      merged: mergedPrs === null ? 'unread' : t.merged,
      approved: t.approved,
      delivered: t.delivered,
      released: t.released,
      leadDays: median(t.lead),
      designDays: median(t.design),
      approvers: t.approvers,
    };
  });
};

const days = (value: number | null): string => (value === null ? '-' : String(Math.round(value * 10) / 10));

const approversText = (approvers: ReadonlyMap<string, number>): string =>
  approvers.size === 0
    ? '-'
    : [...approvers].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([who, n]) => `${who}=${n}`).join(' ');

/**
 * Renders the rows as a header line and one aligned line per week.
 *
 * Days print with at most one decimal; an absent median prints `-`, and so
 * does a week with no approvals in the approvers column.
 *
 * @param rows - the rows {@link deliveryMetrics} returned.
 * @returns the lines, without trailing newlines.
 */
export const deliveryMetricsLines = (rows: readonly DeliveryWeek[]): string[] => {
  const table = [
    ['week', 'merged', 'approved', 'delivered', 'released', 'lead-days', 'design-days', 'approvers'],
    ...rows.map((r) => [r.week, String(r.merged), String(r.approved), String(r.delivered), String(r.released), days(r.leadDays), days(r.designDays), approversText(r.approvers)]),
  ];
  const widths = table[0].map((_, col) => Math.max(...table.map((cells) => cells[col].length)));
  return table.map((cells) => cells.map((cell, col) => (col === cells.length - 1 ? cell : cell.padEnd(widths[col]))).join('  '));
};
