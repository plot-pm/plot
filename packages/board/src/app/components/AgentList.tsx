import { useEffect, useState, type MouseEvent } from 'react';
import type { AgentRow, Fleet, WaitingGroup } from '../../contract/schema.js';

/**
 * Groups in fixed order, each labelled by what it asks OF YOU rather than by
 * what the branch is. "wip" is a git fact; "nothing to do but look" is the
 * answer a person came here for.
 *
 * Every group renders even when empty. A group that vanishes is
 * indistinguishable from a group that is empty — and for `waiting-on-machine`,
 * which needs PR data this step does not have, silence would read as "nothing
 * is waiting on CI": a claim this step cannot make.
 *
 * Actionable before diagnostic: `not-started` precedes `quiet`, because work a
 * person can pick up right now outranks work they must go investigate. This
 * order must stay identical to `GROUP_ORDER` in `fleet.ts`, which sorts the
 * rows — a disagreement between the two would sort rows into a sequence the
 * sections then render in a different one.
 */
export const GROUPS: { key: WaitingGroup; icon: string; label: string; hint: string }[] = [
  { key: 'waiting-on-you', icon: '⚠', label: 'Waiting on you', hint: 'review, merge, decide' },
  { key: 'working', icon: '🤖', label: 'Working', hint: 'nothing to do — just look' },
  { key: 'waiting-on-machine', icon: '⏳', label: 'Waiting on a machine', hint: 'nothing — CI will finish' },
  { key: 'not-started', icon: '📋', label: 'Not started', hint: 'nobody has taken it' },
  { key: 'quiet', icon: '💤', label: 'Quiet', hint: 'still thinking, or dead?' },
  { key: 'done', icon: '✅', label: 'Done', hint: 'merged' },
];

function age(row: AgentRow): string {
  if (row.ageMinutes === null) return '—';
  if (row.ageMinutes < 60) return `${row.ageMinutes}m`;
  const h = Math.floor(row.ageMinutes / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The waiting age in the unit that reads: days for the first weeks, months once
 * days stop being countable.
 *
 * "waiting 180d" is arithmetic the reader has to do — the same defect
 * `humanAge` was written to fix for commit ages, and the reason this scales at
 * all. Today rather than 0d: a plan approved this morning has not been waiting
 * for a measurable stretch, and "0d" reads like a stopped clock.
 *
 * Exported for test — the boundaries are where a unit change reads wrong.
 */
export function waitingLabel(days: number): string {
  if (days < 1) return 'today';
  if (days < 60) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

/** One plan's rows within a waiting-group, in the order they arrived. */
export interface PlanGroup {
  plan: string;
  planFile: string;
  rows: AgentRow[];
}

/**
 * Split one waiting-group's rows by plan.
 *
 * By PLAN, not by story: the waiting-groups answer *what needs me next*, and
 * within that the useful unit is the plan — the thing whose waves are being
 * worked. A story spans weeks and several plans; it is the board's axis, not
 * this view's. (It is also not on a fleet row at all.)
 *
 * Rows arrive age-sorted, so a plan's rows keep that order by construction and
 * the PLANS are ordered by their most urgent row — otherwise a plan holding one
 * stale branch would outrank one whose branch just moved. An unknown age sorts
 * last: "we do not know" is not "ancient".
 *
 * Exported for test, and because the count is what decides whether a
 * sub-heading earns its place — a group with one plan gets none.
 */
export function groupByPlan(rows: AgentRow[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const row of rows) {
    const existing = groups.get(row.plan);
    if (existing) existing.rows.push(row);
    else groups.set(row.plan, { plan: row.plan, planFile: row.planFile, rows: [row] });
  }
  const urgency = (g: PlanGroup) => Math.max(...g.rows.map((r) => r.ageMinutes ?? -1));
  return [...groups.values()].sort((a, b) => urgency(b) - urgency(a));
}

/**
 * Seconds until the next refresh, given how many have passed and how many the
 * interval is — or null when the age is unknown.
 *
 * Clamped at zero: a poll can be late (a hidden tab, a slow response), and
 * "next in -2s" is not something a reader can act on.
 */
export function countdown(ageSeconds: number | null, intervalSeconds: number): number | null {
  if (ageSeconds === null) return null;
  return Math.max(0, intervalSeconds - ageSeconds);
}

/**
 * Does a plan sub-heading earn its place in this group?
 *
 * Two ways it can, and neither count alone catches both:
 *
 *   - it SEPARATES — the group holds more than one plan, so unlabelled rows
 *     would run two different names together;
 *   - it SAVES REPETITION — some plan holds more than one row, so without a
 *     heading its name prints on every one of them.
 *
 * `plans > 1` alone was the first rule and missed the case that motivated the
 * grouping (six rows of ONE plan, name printed six times). `rows > plans` alone
 * fixes that and breaks the mirror (two plans, one row each, separating
 * nothing labelled). Exported so both cases can be pinned without a browser.
 */
export function showPlanHeadings(rowCount: number, planCount: number): boolean {
  return planCount > 1 || rowCount > planCount;
}

export interface AgentListProps {
  fleet: Fleet;
  /**
   * Seconds between fleet polls, or null when the tab is not open and nothing
   * is polling. Null suppresses the git countdown: a counter ticking toward a
   * refresh that is not coming is the same false statement this view exists to
   * remove.
   */
  pollSeconds: number | null;
  /**
   * Open a plan in the board's own modal. Absent — or returning false — where
   * the board has no card for that plan, and the plan name then stays a plain
   * link to `/plan/<file>` rather than opening an empty modal.
   */
  onOpenPlan?: (planFile: string) => boolean;
}

/**
 * The plan's name as a link into the board's own modal.
 *
 * Shared by the row and by the group heading, because grouping moves the name
 * from one to the other and the CLICK has to move with it — the first cut left
 * the heading as plain text and quietly dropped the only way to open the plan.
 *
 * A real anchor, so cmd/ctrl/shift/middle-click open natively and only a plain
 * primary click is intercepted. `onOpenPlan` returns false where the board has
 * no matching card, and the navigation then proceeds — the honest fallback.
 */
function PlanLink({
  plan,
  planFile,
  onOpenPlan,
}: {
  plan: string;
  planFile: string;
  onOpenPlan?: AgentListProps['onOpenPlan'];
}) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenPlan) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (!onOpenPlan(planFile)) return;
    e.preventDefault();
  };
  if (!planFile) return <>{plan}</>;
  return (
    <a
      href={`/plan/${encodeURIComponent(planFile)}`}
      onClick={handle}
      target={onOpenPlan ? undefined : '_blank'}
      rel="noreferrer"
      className="text-blue-600 hover:underline dark:text-blue-400"
    >
      {plan}
    </a>
  );
}

function Row({
  row,
  onOpenPlan,
  planInHeading = false,
}: {
  row: AgentRow;
  onOpenPlan?: AgentListProps['onOpenPlan'];
  /**
   * True when a sub-heading above these rows already names the plan. The row
   * then omits it rather than printing the same name on every line — the
   * heading exists to save that repetition, so repeating it anyway would leave
   * the group wordier than it was before grouping.
   */
  planInHeading?: boolean;
}) {
  // Same convention as the card's Open control: a real anchor, so
  // cmd/ctrl/shift/middle-click open natively, and only a plain primary click is
  // intercepted. `onOpenPlan` returns false when the board holds no matching
  // card — the navigation then proceeds, which is the honest fallback.
  const handlePlan = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenPlan) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (!onOpenPlan(row.planFile)) return;
    e.preventDefault();
  };

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-200/60 px-3 py-2 text-sm last:border-0 dark:border-slate-800">
      {/* Constant today, and visually quiet. It exists now so the list does not
          need rebuilding when a second repo appears. */}
      <span className="w-16 shrink-0 truncate text-xs text-slate-400 dark:text-slate-600">{row.repo}</span>
      {/* Plan BEFORE branch: what this belongs to, then which slice of it — the
          order in which the tab is read. It also lets rows of one plan form a
          visible column, reinforcing the grouping rather than repeating it;
          with the branch first, branch names of differing length left the plan
          column frayed across six rows of the same plan.

          Opens the plan viewer in the board's own modal — the Agents tab is a
          live view that polls every 4 s, and navigating away in place would cost
          the reader the thing they came to watch. The href stays real so a
          modified click still opens the page, and so a plan with no board card
          simply navigates. */}
      {planInHeading ? null : row.planFile ? (
        <a
          href={`/plan/${encodeURIComponent(row.planFile)}`}
          onClick={handlePlan}
          target={onOpenPlan ? undefined : '_blank'}
          rel="noreferrer"
          className="text-xs text-blue-600 hover:underline dark:text-blue-400"
        >
          {row.plan}
        </a>
      ) : (
        <span className="text-xs text-slate-500 dark:text-slate-400">{row.plan}</span>
      )}
      {/* Every link goes where its text says. The branch name opens the BRANCH —
          it used to open the PR, which is surprising in both directions. An
          empty `branchUrl` is a merged branch (its remote page is gone) or an
          origin the server does not recognise; both render as plain text rather
          than as an invented address. */}
      {row.branchUrl ? (
        <a
          href={row.branchUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[13px] text-blue-600 hover:underline dark:text-blue-400"
          title={`Branch ${row.branch} on the git host`}
        >
          {row.branch}
        </a>
      ) : (
        <span className="font-mono text-[13px] text-slate-800 dark:text-slate-200">{row.branch}</span>
      )}
      {/* How long this has been waiting to be started. LABELLED, because it is a
          different clock from the age column on the right: that one says when
          the branch tip last moved, this says when the plan was approved. An
          unlabelled `22d` in each place would be two different facts wearing one
          face. Absent where no approval date is recorded — nothing rather than a
          zero. */}
      {row.waitingDays !== null && (
        <span
          className="text-xs text-amber-700 dark:text-amber-500"
          title="Approved this long ago, and nobody has started it"
        >
          waiting {waitingLabel(row.waitingDays)}
        </span>
      )}
      <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
        <Note row={row} />
      </span>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">
        {age(row)}
      </span>
    </li>
  );
}

/**
 * The note, with `PR #<n>` turned into the link to the pull request.
 *
 * The number is composed into the note by the server's classifier (`PR #130
 * green`), so the link is applied to that substring rather than rendered as a
 * separate control — the reader looks for the PR link where the number is, and
 * that is where it now is. `green` stays plain text on purpose: the fleet row
 * carries no checks URL, and adding one is a change through `plot-host.sh` and
 * the pulse rather than a display change.
 */
function Note({ row }: { row: AgentRow }) {
  const marker = row.pr ? `PR #${row.pr.number}` : '';
  const at = marker && row.pr?.url ? row.note.indexOf(marker) : -1;
  if (at === -1) return <>{row.note}</>;
  return (
    <>
      {row.note.slice(0, at)}
      <a
        href={row.pr!.url}
        target="_blank"
        rel="noreferrer"
        className="text-blue-600 hover:underline dark:text-blue-400"
      >
        {marker}
      </a>
      {row.note.slice(at + marker.length)}
    </>
  );
}

export function AgentList({ fleet, pollSeconds, onOpenPlan }: AgentListProps) {
  // Seconds since this payload arrived. The ages the server sent are true at the
  // moment of the poll and stale a second later, so a countdown built from them
  // alone would jump by the poll interval rather than tick. This is the only
  // clock the client adds, and it runs ONLY while something is polling: a
  // counter ticking toward a refresh that is not coming is exactly the false
  // statement the countdowns exist to remove.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    if (pollSeconds === null) return;
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, [pollSeconds, fleet.generatedAt]);

  // Degrade, do not hide: before the first scan lands this says so rather than
  // showing an empty list, which would read as "no agents are working".
  if (!fleet.ready && !fleet.error) {
    return <p className="text-sm text-slate-500">Waiting for the first fleet scan…</p>;
  }

  // Both countdowns come from the SERVER, because both are the server's own
  // gates. An earlier version computed this one from the client's poll interval
  // and it read "next in 0s" permanently: `ageSeconds` dates the server's scan
  // (5 s timer) while the client polls every 4 s, so `interval − age` was
  // reliably negative and the clamp did the rest. Subtracting one clock's age
  // from another clock's interval produces a number that is never right.
  //
  // `== null` rather than `=== null`: a server that predates the field sends
  // nothing, and whether that arrives as null or undefined depends on whether
  // the response was parsed through the schema. Both mean "not reported", and
  // treating undefined as a number renders "next in NaNs".
  const gitNext =
    pollSeconds === null || fleet.scanNextInSeconds == null
      ? null
      : Math.max(0, fleet.scanNextInSeconds - tick);
  // The PR countdown comes from the SERVER, because only the server knows its
  // own backoff. Absent (an older server) means no countdown at all — a client
  // assuming 60 s would count to zero and sit there through a 120 s wait.
  const prNext =
    pollSeconds === null || fleet.prNextInSeconds == null
      ? null
      : Math.max(0, fleet.prNextInSeconds - tick);

  return (
    <div className="space-y-4">
      {fleet.error && (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Last scan failed: {fleet.error}
          {fleet.ready && ' — showing the last successful pulse below.'}
        </p>
      )}

      {GROUPS.map(({ key, icon, label, hint }) => {
        const rows = fleet.rows.filter((r) => r.group === key);
        // Every waiting-group is grouped the same way, `done` included: it is
        // the group that grows fastest over a working day, so it is the first to
        // become a list one scrolls past. A rule with an exception for the group
        // nobody reads is a rule someone has to remember.
        const plans = groupByPlan(rows);
        // A sub-heading earns its place when it SEPARATES plans or SAVES
        // repetition — and neither count alone catches both.
        //
        // `plans.length > 1` was the first rule and fails the case that
        // motivated the grouping: six QUIET rows of ONE plan got no heading, so
        // the plan name printed six times down the column — more chrome than
        // one heading above six shorter rows. `rows.length > plans.length`
        // fixes that and breaks the mirror case: two plans with one row each
        // separate nothing, and two different names would run together
        // unlabelled.
        //
        // So: more than one plan, or any plan holding more than one row.
        const headings = showPlanHeadings(rows.length, plans.length);
        return (
          <section key={key}>
            <h2 className="mb-1 flex items-baseline gap-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              <span aria-hidden>{icon}</span>
              {label}
              <span className="font-normal normal-case tracking-normal text-slate-400 dark:text-slate-600">
                {rows.length > 0 ? `(${rows.length})` : hint}
              </span>
            </h2>
            <ul className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
              {rows.length > 0 ? (
                plans.map((group) => (
                  <li key={group.plan}>
                    {/* A nameless group holds rows no plan claims, so there is
                        nothing to head them WITH: rendering the heading anyway
                        printed a bare "(3)", a label that labels nothing. */}
                    {headings && group.plan && (
                      <h3 className="border-b border-slate-200/60 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                        {/* The heading CARRIES the link, because the rows below
                            no longer print the plan name. Grouping moved the
                            name up here; the way to reach the plan has to move
                            with it, or the tab keeps the tidier layout and
                            loses the click. Once per group rather than once per
                            row, which is the point of grouping. */}
                        <PlanLink
                          plan={group.plan}
                          planFile={group.planFile}
                          onOpenPlan={onOpenPlan}
                        />
                        <span className="ml-1.5 font-normal text-slate-400 dark:text-slate-600">
                          ({group.rows.length})
                        </span>
                      </h3>
                    )}
                    <ul>
                      {group.rows.map((r) => (
                        <Row
                          key={`${r.repo}/${r.branch}`}
                          row={r}
                          onOpenPlan={onOpenPlan}
                          planInHeading={headings && Boolean(group.plan)}
                        />
                      ))}
                    </ul>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-sm text-slate-400 dark:text-slate-600">none</li>
              )}
            </ul>
          </section>
        );
      })}

      {/* The ages are the honesty: a stale source says so rather than looking
          live. They are reported separately because they fail separately —
          "git 3s ago, PR data 4 min ago" is a different situation from both
          being fresh, and the reader is the one who has to know which.

          Each age now carries a countdown beside it, because the two readings
          answer different questions and the pair is the point: how old is this,
          and when does it change. */}
      <p className="px-3 text-xs text-slate-400 dark:text-slate-600">
        {/* Counted from the ROWS, not from `summary`: the pulse summarises the
            branches plans name, and the list also shows open PRs no plan
            claims. Reading the summary here said "8 branches across 3 plans"
            under twelve visible rows. */}
        {fleet.rows.length} branches across{' '}
        {new Set(fleet.rows.map((r) => r.plan).filter(Boolean)).size} plans · scanned{' '}
        {fleet.ageSeconds + tick}s ago
        {gitNext !== null && ` · next in ${gitNext}s`}
        {fleet.prAgeSeconds !== null && ` · PR data ${fleet.prAgeSeconds + tick}s ago`}
        {fleet.prAgeSeconds !== null && prNext !== null && ` · next in ${prNext}s`}
        {fleet.prAgeSeconds === null && !fleet.prError && ' · no PR data yet'}
      </p>
      {fleet.prError && (
        <p className="px-3 text-xs text-amber-700 dark:text-amber-400">
          PR data unavailable ({fleet.prError.slice(0, 80)}) — the two groups above that
          depend on it may be incomplete.
        </p>
      )}
    </div>
  );
}
