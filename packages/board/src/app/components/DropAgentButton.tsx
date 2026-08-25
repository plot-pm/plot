import { useEffect, useRef, useState } from 'react';
import type { DispatchInfo, AgentEntry } from '../../contract/schema.js';
import { ACTING_CLASS, ActingSpinner } from './ui/ActingSpinner.js';

/**
 * *Drop this agent* — the manual reconciliation for registry entries the
 * automatic resolver cannot clear.
 *
 * A settled worker whose worktree was removed manually, or whose manifest
 * outlived its process, cannot be cleared by the automatic cleanliness
 * resolver — it checks the worktree, and no worktree means no answer. This
 * control is the escape hatch: it removes the manifest so the WORKING section
 * stops showing a row for an agent that is gone.
 *
 * IT REFUSES TO DROP A LIVE WORKER. The endpoint checks the entry's state
 * before acting, and a `running` or `waiting` entry is refused regardless of
 * what this button says. The registry is a record, not a killswitch.
 *
 * The interaction is `DeliverButton`'s arm/confirm pattern: arm on the first
 * click, act on the second, cancel on a click elsewhere or Escape. Unlike
 * `DeliverButton` this does NOT spawn an agent — the endpoint removes the
 * manifest synchronously — so there is no polling loop; the reply says
 * whether the drop succeeded.
 *
 * This component is rendered ONLY on a broken agent row (`isBrokenState`), the
 * same way `DeliverButton` renders only on a `deliverable` card — so the per-
 * entry "is this droppable" gate lives at the call site, and this control asks
 * only whether the BOARD can act (`drop.available`).
 */

export interface DropAgentButtonProps {
  /** The agent entry this drops — needs session for the POST body. */
  agent: AgentEntry;
  /** Whether the server will act, and why not — the board's `drop`. */
  drop: DispatchInfo;
  /** Reports that a click is outstanding (true) or has settled (false). */
  onActing?: (active: boolean) => void;
  /** Called when the drop succeeds — the row can remove itself. */
  onDropped?: () => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'running' }
  | { kind: 'dropped' }
  | { kind: 'failed'; message: string };

/**
 * What the armed button says — the consequence, naming the session id that
 * will be removed.
 *
 * The session id is what identifies the manifest; naming it lets a reader
 * verify they are dropping the right one. Truncated to 12 characters, the
 * same shortening the row's name cell uses.
 *
 * Exported for test.
 */
export function armedLabel(session: string): string {
  const short = session.length > 12 ? session.slice(0, 12) + '…' : session;
  return `Drop ${short}?`;
}

export function DropAgentButton({ agent, drop, onActing, onDropped }: DropAgentButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const armed = state.kind === 'armed';
  const running = state.kind === 'running';

  /**
   * IS ONE OF MINE ALREADY RUNNING? — the guard `DeliverButton` has, for the
   * same reason: two clicks on the ARMED button inside one tick both read
   * `armed` from state a render behind and both call `run()`. A ref changes
   * synchronously, so the second of that pair sees it.
   */
  const inFlight = useRef(false);
  useEffect(() => {
    if (!running) inFlight.current = false;
  }, [running]);

  // Announce the transition, and always announce the way back out — including
  // on unmount, or a menu that closes mid-drop leaves the board marked acting.
  useEffect(() => {
    if (!running || !onActing) return;
    onActing(true);
    return () => onActing(false);
  }, [running, onActing]);

  // A CLICK ELSEWHERE CANCELS, and so does Escape. Registered only while armed.
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!armed) return;
    const cancel = (e: Event) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setState({ kind: 'idle' });
    };
    document.addEventListener('pointerdown', cancel, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setState({ kind: 'idle' });
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', cancel, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [armed]);

  const run = async () => {
    setState({ kind: 'running' });
    try {
      const res = await fetch('/api/registry/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: agent.session }),
      });
      const body = (await res.json()) as {
        dropped?: boolean;
        reason?: string;
        error?: string;
      };
      if (!res.ok) {
        setState({ kind: 'failed', message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      if (body.dropped) {
        setState({ kind: 'dropped' });
        onDropped?.();
      } else {
        // The endpoint refused but reported 200 — this is the entry-specific
        // refusal (live worker, unknown state) rather than a server error.
        setState({ kind: 'failed', message: body.reason ?? 'could not drop' });
      }
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const blocked = running || !drop.available || !agent.session;

  const onClick = () => {
    // `aria-disabled` does not stop a click the way `disabled` does, so the
    // refusal has to be stated here as well.
    if (blocked) return;
    if (state.kind === 'idle' || state.kind === 'failed') {
      // A failed attempt re-arms rather than re-runs: the reason has just been
      // read, and the next click should be as deliberate as the first was.
      setState({ kind: 'armed' });
      return;
    }
    if (state.kind === 'armed') {
      if (inFlight.current) return;
      inFlight.current = true;
      void run();
    }
  };

  // No session = no manifest = nothing to drop. The row should not render this
  // control at all, but if it does, the button is disabled.
  if (!agent.session) return null;

  return (
    <span ref={rootRef} className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        data-drop-agent={agent.session}
        onClick={onClick}
        // `aria-disabled` rather than the native attribute: a natively disabled
        // button leaves the tab order, taking the control AND its explanation
        // out of reach.
        aria-disabled={blocked || undefined}
        aria-busy={running}
        aria-pressed={armed}
        title={drop.available ? `Drop the manifest for ${agent.session}` : drop.reason}
        className={
          armed
            ? 'rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 hover:underline dark:bg-amber-900/40 dark:text-amber-200'
            : blocked
              ? `cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600${running ? ` ${ACTING_CLASS}` : ''}`
              : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {running ? 'dropping…' : armed ? armedLabel(agent.session) : 'Drop this agent'}
        {running && <ActingSpinner />}
        {!drop.available && drop.reason && (
          <span className="sr-only"> — unavailable: {drop.reason}</span>
        )}
      </button>
      {state.kind === 'dropped' && (
        <span className="text-xs text-slate-500 dark:text-slate-400">removed</span>
      )}
      {state.kind === 'failed' && (
        <span
          data-drop-error={agent.session}
          className="whitespace-pre-line text-xs text-red-700 dark:text-red-400"
        >
          {state.message}
        </span>
      )}
    </span>
  );
}
