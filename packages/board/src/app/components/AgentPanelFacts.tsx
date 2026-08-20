import { useState } from 'react';
import type { AgentPanel } from '../../server/agent-panel.js';

/**
 * A worker command → its single-line collapsed preview.
 *
 * The command the dispatcher launches is ~1,400 characters — the whole brief
 * the agent was handed, prose and all, with the newlines that prose carries.
 * The collapsed form is what the panel shows before anyone expands it, and it
 * must read as ONE line: newlines and runs of whitespace become single spaces
 * so no wrap can reintroduce a break, and the ends are trimmed so the preview
 * does not open on a gap.
 *
 * **Lossless BY DESIGN.** This collapses whitespace and nothing else — the
 * brief path, the flags, every token survives — because the expanded view and
 * the Copy control render the ORIGINAL string, not this. A collapse that
 * dropped characters would make Copy yield "the truncated render", which is the
 * exact defect this field exists to remove. Exported for test: the boundary
 * cases (a tab, a leading space, an embedded newline) are invisible in markup.
 */
export function commandFirstLine(command: string): string {
  return command.replace(/\s+/g, ' ').trim();
}

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

/**
 * A labelled fact whose value is a DESTINATION — pressed rather than read.
 *
 * `BRANCH` and `PLAN` name things the board already holds: a row to scroll to,
 * a card to open. A reader who opened the panel to understand an agent should
 * reach those without hunting, so the value becomes a button.
 *
 * **A button, not a link, and that is the finding's own rule.** There is no URL
 * to href to — the reveal happens IN the page (a scroll, a modal), not by
 * navigation — so an anchor would be a lie about what a click does. It is the
 * same shape the board applies to *Show in board*.
 *
 * **Degrades to a plain `Fact` when it has nowhere to go.** With no `onOpen`
 * the value still shows, but as text — the board's rule for a dead PR link: an
 * affordance that cannot navigate must not look like one. And the omission rule
 * still holds first: an absent value renders nothing, button or not.
 *
 * Exported for test — that a handlerless fact is NOT a button is the half a
 * naive "always render a button" gets wrong.
 */
export function LinkFact({
  label,
  value,
  onOpen,
}: {
  label: string;
  value: string | null | undefined;
  onOpen?: () => void;
}) {
  if (value === null || value === undefined || value === '') return null;
  if (!onOpen) return <Fact label={label} value={value} />;
  return (
    <div className="flex min-w-0 items-baseline gap-2" data-fact={label}>
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <button
        type="button"
        onClick={onOpen}
        data-fact-link={label}
        title={value}
        className="min-w-0 truncate text-left font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
      >
        {value}
      </button>
    </div>
  );
}

/**
 * A labelled fact whose value is a PATH TO COPY, never to follow.
 *
 * The worktree is the one value on the panel that names something outside the
 * browser, and a browser refuses to navigate from `http://localhost` to
 * `file://` — so a link would offer a move the browser then declines. The path
 * leaves the browser by being copied into a terminal instead.
 *
 * The path is shown AND copyable: Copy sits beside the value, never replacing
 * it, so a reader can still read the whole path (and the `title` carries it in
 * full where the cell truncates). The success flash is transient component
 * state — a copy is a momentary act, not a fact about the run.
 *
 * Exported for test — that it is never an anchor is the assertion that pins the
 * "a link would lie" rule.
 */
export function CopyFact({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const [copied, setCopied] = useState(false);
  if (value === null || value === undefined || value === '') return null;
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        // Long enough to read, short enough that it is gone before the reader
        // wonders whether it stuck. It is a flash, not a state.
        setTimeout(() => setCopied(false), 1_200);
      },
      () => {
        // A clipboard the browser blocked leaves the path on screen to select
        // by hand — the same honest fallback the log path already relies on.
      },
    );
  };
  return (
    <div className="flex min-w-0 items-baseline gap-2" data-fact={label}>
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <span
        data-fact-copy={label}
        title={value}
        className="min-w-0 truncate font-mono text-xs text-slate-700 dark:text-slate-300"
      >
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        data-copy-path
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        {copied ? 'Copied' : 'Copy path'}
      </button>
    </div>
  );
}

/**
 * The COMMAND field: a preview that opens to the whole thing, and a Copy.
 *
 * The plain {@link Fact} truncates to one clipped line, which is right for a pid
 * or a model name and wrong for the one value on this panel that is ~1,400
 * characters — the entire brief the agent was handed, the single most useful
 * fact when an agent misbehaves. Measured, the truncation stopped inside
 * `.plot/briefs/`, so the reader could not even see which brief was named.
 *
 * So this field, and only this field, gets a dedicated control:
 *
 * - **Collapsed** it shows {@link commandFirstLine} — one line, clipped — which
 *   is the panel's default and answers "what command, roughly".
 * - **Expanded** it shows the ORIGINAL string, wrapped, so the whole brief
 *   including its path is readable in place.
 * - **Copy** yields the ORIGINAL string, always — the exact bytes the worker was
 *   launched with, never the collapsed preview. That is the wave's contract: the
 *   reader who copies gets the command, not the render of it.
 *
 * The omission rule from {@link Fact} is kept: an empty command (`""`, the shape
 * a fleet with no `Worker command` configured takes) renders nothing at all,
 * because there is nothing to expand or copy.
 */
export function CommandFact({ command }: { command: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  if (command === null || command === undefined || command === '') return null;

  const copy = async () => {
    // The command is present in the DOM either way, so a reader can always
    // select it by hand; this is the convenience path. `navigator.clipboard`
    // is absent over plain http and in older browsers — the same caveat
    // PlanModal names — so a failure is swallowed rather than thrown at a
    // reader who can still select the text they can see.
    try {
      await navigator.clipboard?.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Left uncopied; the value is on screen to select.
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1" data-fact="command" data-command-fact>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          command
        </span>
        <button
          type="button"
          data-command-toggle
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="shrink-0 text-[11px] text-sky-600 hover:underline dark:text-sky-400"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
        <button
          type="button"
          data-command-copy
          onClick={copy}
          className="shrink-0 text-[11px] text-sky-600 hover:underline dark:text-sky-400"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* The value carries a stable hook so a test can read exactly what is
          shown. Collapsed it is the one-line preview and clips; expanded it is
          the ORIGINAL string, wrapped, so nothing is hidden. */}
      <span
        data-command-value
        className={
          expanded
            ? 'min-w-0 whitespace-pre-wrap break-all font-mono text-xs text-slate-700 dark:text-slate-300'
            : 'min-w-0 truncate font-mono text-xs text-slate-700 dark:text-slate-300'
        }
      >
        {expanded ? command : commandFirstLine(command)}
      </span>
    </div>
  );
}

export interface AgentPanelFactsProps {
  panel: AgentPanel | null;
  /** Injected by tests so "last activity" does not race the clock. */
  now?: number;
  /**
   * Open the plan governing this branch — reveals the finding's PLAN fact as a
   * destination. Given the plan's FILE (what `panel.plan` carries), because the
   * board opens a plan by file, not by the name it renders.
   *
   * Optional: absent (or a panel whose `plan` is "") leaves PLAN plain text,
   * which is the "an affordance that cannot navigate must not look like one"
   * fallback rather than a dead button.
   */
  onOpenPlan?: (planFile: string) => void;
  /**
   * Scroll to and highlight this branch's fleet row — the BRANCH fact's
   * destination. Optional for the same reason as `onOpenPlan`.
   */
  onRevealBranch?: (branch: string) => void;
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
export function AgentPanelFacts({ panel, now, onOpenPlan, onRevealBranch }: AgentPanelFactsProps) {
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
      {/* BRANCH names a row this board holds — pressing it scrolls there and
          highlights it. Plain text where no reveal is wired (the panel outside
          the fleet page), which is the affordance rule, not a dead button. */}
      <LinkFact
        label="branch"
        value={panel.branch}
        onOpen={onRevealBranch ? () => onRevealBranch(panel.branch) : undefined}
      />
      <Fact label="state" value={panel.worker} />
      {/* PLAN names a card. `panel.plan` is the plan's FILE, which is how the
          board opens one; the name it renders is the same string. No card for a
          plan the board never walked — then it stays plain text. */}
      <LinkFact
        label="plan"
        value={panel.plan}
        onOpen={onOpenPlan && panel.plan ? () => onOpenPlan(panel.plan) : undefined}
      />
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
      {/* WORKTREE leaves the browser, so it offers Copy path rather than a link
          — a browser will not follow http://localhost → file://, and a link
          that cannot navigate must not look like one. */}
      <div className="col-span-2 min-w-0">
        <CopyFact label="worktree" value={panel.worktree} />
      </div>
      <div className="col-span-2 min-w-0">
        <CommandFact command={panel.command} />
      </div>
    </div>
  );
}
