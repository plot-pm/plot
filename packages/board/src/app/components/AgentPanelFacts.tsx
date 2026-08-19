import type { AgentPanel } from '../../server/agent-panel.js';

/**
 * Seconds → the shortest phrase that is still true, for uptime.
 *
 * Coarse ON PURPOSE. Uptime answers *has this agent been going a while*, and a
 * reader deciding whether a run has stalled does not act differently at 4h12m
 * than at 4h. Rendering the extra precision would suggest the number is more
 * exact than a `ps` reading sampled whenever a panel happened to open.
 *
 * Exported for test: the boundaries are where a formatter goes wrong, and they
 * are invisible in rendered markup.
 */
export function uptimeLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
}

/**
 * A token count → a short label, e.g. `104k`.
 *
 * Thousands rather than exact digits for the same reason uptime is coarse: the
 * number moves with every reply, and its use is to convey *roughly how full is
 * this context*.
 */
export function tokenLabel(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * An ISO timestamp → how long ago, relative to `now`.
 *
 * `now` is injected rather than read from the clock so a test can assert the
 * wording without racing it — the defect the brief warns about, in its
 * formatting form.
 */
export function agoLabel(iso: string, now: number = Date.now()): string | null {
  const then = Date.parse(iso);
  // An unparseable timestamp is one more unrecognised field, and it omits like
  // every other one rather than rendering "Invalid Date".
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  return `${uptimeLabel(seconds)} ago`;
}

/**
 * One labelled fact, or nothing at all.
 *
 * **The omission rule lives HERE, in one place, rather than in six conditionals
 * at the call sites.** A field the panel could not read renders no label, no
 * dash and no "unknown" — the row simply is not there. That is the wave's
 * accepted failure mode made structural: there is no code path that can print a
 * placeholder, because the component that would print it returns null first.
 */
export function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex min-w-0 items-baseline gap-2" data-fact={label}>
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <span className="min-w-0 truncate font-mono text-xs text-slate-700 dark:text-slate-300">
        {value}
      </span>
    </div>
  );
}

export interface AgentPanelFactsProps {
  panel: AgentPanel | null;
  /** Injected by tests so "last activity" does not race the clock. */
  now?: number;
}

/**
 * The header block of the agent panel: what is known about the run.
 *
 * Split from the modal so the omission rules can be tested as pure rendering,
 * without a fetch, a timer or a dialog in the way. The assertion that matters —
 * *an unreadable transcript leaves model, context and last activity absent* —
 * is about this component and nothing else.
 *
 * **Every value here is either a fact or missing.** Nothing is defaulted, and
 * `uptimeSeconds: null` (a worker that has exited) renders no uptime rather
 * than `0s` — a frozen number would be believed exactly the way a stale model
 * name would.
 */
export function AgentPanelFacts({ panel, now }: AgentPanelFactsProps) {
  if (!panel) return null;
  if (!panel.ok) {
    return (
      <p
        data-panel-miss={panel.reason}
        className="shrink-0 border-b border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400"
      >
        {panel.reason === 'no-worktree'
          ? 'No worktree for this branch on this machine — ask the machine that took it.'
          : 'No scan has reported this branch — the next pulse may know it.'}
      </p>
    );
  }

  const ago = panel.lastActivity ? agoLabel(panel.lastActivity, now) : null;

  return (
    <div
      data-agent-facts
      className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 border-b border-slate-200 px-4 py-3 dark:border-slate-800"
    >
      <Fact label="pid" value={panel.pid} />
      {/* Absent for a worker that has exited — see uptimeSeconds. */}
      <Fact
        label="uptime"
        value={panel.uptimeSeconds === null ? null : uptimeLabel(panel.uptimeSeconds)}
      />
      <Fact label="branch" value={panel.branch} />
      <Fact label="state" value={panel.worker} />
      <Fact label="plan" value={panel.plan} />
      <Fact label="wave" value={panel.wave} />
      {/* The three from the transcript. Each omits independently: a format that
          moved `usage` but kept `model` shows the model and no context, which
          is more useful than an all-or-nothing block and costs nothing. */}
      <Fact label="model" value={panel.model} />
      <Fact
        label="context"
        value={panel.contextTokens === undefined ? null : `${tokenLabel(panel.contextTokens)} tokens`}
      />
      <Fact label="last activity" value={ago} />
      {/* Full width: a worktree path and a worker command are both long. */}
      <div className="col-span-2 min-w-0">
        <Fact label="worktree" value={panel.worktree} />
      </div>
      <div className="col-span-2 min-w-0">
        <Fact label="command" value={panel.command} />
      </div>
    </div>
  );
}
