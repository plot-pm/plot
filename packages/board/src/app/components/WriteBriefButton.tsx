import { useEffect, useRef, useState } from 'react';
import type { DispatchInfo } from '../../contract/schema.js';
import { ACTING_CLASS, ActingSpinner } from './ui/ActingSpinner.js';

/**
 * *Write brief* — the action a row offers when it needs its brief written.
 *
 * **The same route as Implement, the same outcome for THIS row.** A row that
 * `needsBrief` is an otherwise-startable branch missing the specification a
 * worker reads first. `/plot-implement` writes that brief as part of its
 * preparation — so this button is Implement scoped to one branch, offered where
 * the brief is the only thing standing between the row and a dispatch.
 *
 * **The label says what the click does for THIS branch.** The plan head's
 * Implement button says "Implement" because it is preparing a whole plan; this
 * says "Write brief" because that is the effect the row needs and the gap the
 * row is showing. Same route, same POST body (the plan slug), different word
 * because the reader's question is different.
 *
 * **Single click, no arming.** Creating a brief is not irreversible: a file can
 * be deleted, and `/plot-implement` stopping on drift is the normal case for a
 * branch already started. So it takes the single-click interaction that
 * `ImplementButton` uses rather than an arm-then-act pattern.
 *
 * Uses the same `/api/implement` route that `ImplementButton` uses. The route
 * prepares the whole plan's next wave, which for a plan with one eligible
 * branch is the one branch the row shows. Offered only where `needsBrief(row)`
 * is true, so the narrowing is in the predicate, not the route.
 */

/** How often to ask what happened, once a click is outstanding. */
const POLL_MS = 700;

/** Long enough for the preflight, branch, brief and Started record; then the log. */
const GIVE_UP_MS = 300_000;

export interface WriteBriefButtonProps {
  /** The plan slug to implement — writes the brief as a side effect. */
  slug: string;
  /** The branch this row shows — named in the title, for context. */
  branch: string;
  /** Whether the server will act, and why not — the board's `implement`. */
  implement: DispatchInfo;
  /** Reports that a click is outstanding (true) or has settled (false). */
  onActing?: (active: boolean) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'prepared' }
  | { kind: 'failed'; message: string };

export function WriteBriefButton({ slug, branch, implement, onActing }: WriteBriefButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const running = state.kind === 'running';

  /**
   * IS ONE OF MINE ALREADY RUNNING? — the guard every acting button carries: two
   * clicks inside one tick both read `idle` from state a render behind and both
   * POST. A ref changes synchronously, so the second of the pair sees it.
   */
  const inFlight = useRef(false);
  useEffect(() => {
    if (!running) inFlight.current = false;
  }, [running]);

  // Announce the transition, and always announce the way back out — including on
  // unmount, or a menu that closes mid-run leaves the board polling fast forever.
  useEffect(() => {
    if (!running || !onActing) return;
    onActing(true);
    return () => onActing(false);
  }, [running, onActing]);

  // Ask what happened. Nothing moves on the board — /plot-implement prepares
  // work rather than changing a phase — so this status route is the only way to
  // learn the click's outcome.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(`/api/implement/${encodeURIComponent(slug)}`);
        const body = (await res.json()) as { state?: string; message?: string };
        if (cancelled) return;
        if (body.state === 'failed') {
          setState({ kind: 'failed', message: body.message || 'the implement command failed' });
          return;
        }
        if (body.state === 'done') {
          // Prepared: the command exited 0. What it prepared — a branch, a brief,
          // a Started record, or a drift report it stopped on — is in the log.
          setState({ kind: 'prepared' });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setState({ kind: 'failed', message: 'still running — see the implement log' });
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running, slug]);

  const run = async () => {
    setState({ kind: 'running' });
    try {
      const res = await fetch('/api/implement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // THE SLUG, AND NOTHING ELSE. The server passes it to /plot-implement,
        // which reads the plan from disk itself — so no text this page holds
        // becomes the plan an agent acts on.
        body: JSON.stringify({ slug }),
      });
      const body = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        // `detail` first: the refusals carry it, and it is the sentence that
        // says which one happened.
        setState({ kind: 'failed', message: body.detail ?? body.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const refusal = !implement.available ? implement.reason : undefined;
  const blocked = running || refusal !== undefined;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        data-write-brief={branch}
        onClick={() => {
          // `aria-disabled` does not stop a click the way `disabled` does, so the
          // refusal has to be stated here as well: the attribute is what assistive
          // technology reads, this is what makes it true.
          if (inFlight.current || blocked) return;
          inFlight.current = true;
          void run();
        }}
        // `aria-disabled` rather than the native attribute: a natively disabled
        // button leaves the tab order, taking the control AND its explanation
        // out of reach.
        aria-disabled={blocked || undefined}
        aria-busy={running}
        title={implement.available ? `Write brief for ${branch}` : implement.reason}
        className={
          blocked
            ? `cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600${running ? ` ${ACTING_CLASS}` : ''}`
            : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {running ? 'writing…' : 'Write brief'}
        {/* Beside the word, never instead of it — motion must not be the only
            carrier of a fact, and the label is what a screen reader gets. */}
        {running && <ActingSpinner />}
        {/* Why it will not act, for a reader with no pointer to hover. */}
        {refusal && <span className="sr-only"> — unavailable: {refusal}</span>}
      </button>
      {state.kind === 'prepared' && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Done — see implement log
        </span>
      )}
      {state.kind === 'failed' && (
        <span
          data-write-brief-error={branch}
          className="whitespace-pre-line text-xs text-red-700 dark:text-red-400"
        >
          {state.message}
        </span>
      )}
    </span>
  );
}
