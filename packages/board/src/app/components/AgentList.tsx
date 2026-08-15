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
 */
const GROUPS: { key: WaitingGroup; icon: string; label: string; hint: string }[] = [
  { key: 'waiting-on-you', icon: '⚠', label: 'Waiting on you', hint: 'review, merge, decide' },
  { key: 'working', icon: '🤖', label: 'Working', hint: 'nothing to do — just look' },
  { key: 'waiting-on-machine', icon: '⏳', label: 'Waiting on a machine', hint: 'nothing — CI will finish' },
  { key: 'quiet', icon: '💤', label: 'Quiet', hint: 'still thinking, or dead?' },
  { key: 'not-started', icon: '📋', label: 'Not started', hint: 'nobody has taken it' },
  { key: 'done', icon: '✅', label: 'Done', hint: 'merged' },
];

function age(row: AgentRow): string {
  if (row.ageMinutes === null) return '—';
  if (row.ageMinutes < 60) return `${row.ageMinutes}m`;
  const h = Math.floor(row.ageMinutes / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function Row({ row }: { row: AgentRow }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-200/60 px-3 py-2 text-sm last:border-0 dark:border-slate-800">
      {/* Constant today, and visually quiet. It exists now so the list does not
          need rebuilding when a second repo appears. */}
      <span className="w-16 shrink-0 truncate text-xs text-slate-400 dark:text-slate-600">{row.repo}</span>
      <span className="font-mono text-[13px] text-slate-800 dark:text-slate-200">{row.branch}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400">{row.plan}</span>
      <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{row.note}</span>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">
        {age(row)}
      </span>
    </li>
  );
}

export function AgentList({ fleet }: { fleet: Fleet }) {
  // Degrade, do not hide: before the first scan lands this says so rather than
  // showing an empty list, which would read as "no agents are working".
  if (!fleet.ready && !fleet.error) {
    return <p className="text-sm text-slate-500">Waiting for the first fleet scan…</p>;
  }

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
                rows.map((r) => <Row key={`${r.repo}/${r.branch}`} row={r} />)
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
          being fresh, and the reader is the one who has to know which. */}
      <p className="px-3 text-xs text-slate-400 dark:text-slate-600">
        {fleet.summary.branches} branches across {fleet.summary.plans} plans · scanned{' '}
        {fleet.ageSeconds}s ago
        {fleet.prAgeSeconds !== null && ` · PR data ${fleet.prAgeSeconds}s ago`}
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
