import { useEffect, useRef, useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';
import type { DispatchInfo } from '../../contract/schema.js';
import { ACTING_CLASS, ActingSpinner } from './ui/ActingSpinner.js';

/**
 * *Implement* — the entrance a person walks, run from the board.
 *
 * `/plot-implement` is the preparation that comes before writing code: the
 * staleness preflight, the branch, the hand-off brief, the `Started:` record.
 * It is the complement of Dispatch on the same plan row — Dispatch fans a plan
 * out to detached workers, this prepares ONE wave the way a person picking the
 * plan up would, then stops. Which of the two applies is the operator's call
 * (*am I picking this up, or is the fleet taking it?*), so the board offers
 * both and defaults to neither.
 *
 * **Single click, no arming.** Unlike Approve and Deliver, this is not
 * irreversible: it creates a branch and a brief, both cheap to undo. So it
 * follows `DispatchAllButton`'s interaction — one click acts — rather than
 * `DeliverButton`'s arm-then-act. It takes the same spinner-and-refusal
 * treatment every acting control has, because a detached spawn cannot report
 * its result in the response.
 *
 * **Nothing moves on the board, so the outcome is read back.** `/plot-implement`
 * prepares work; it does not flip a plan's phase, so no card leaves its column
 * on success. That makes this control unlike Dispatch (which confirms by a
 * claim landing) and like Deliver (which reads a status route): the ONLY signal
 * of what the click did is `GET /api/implement/<slug>` — whether the agent
 * stopped on drift, or prepared the wave. So it polls, and reports.
 *
 * This is rendered ONLY where the plan has eligible work (see `PlanActions`'s
 * `hasEligibleWork` gate), so the per-plan "is there work to start" question
 * lives at the call site, and this control asks only whether the BOARD can act
 * (`implement.available`).
 */

/** How often to ask what happened, once a click is outstanding. */
const POLL_MS = 700;

/** Long enough for the preflight, branch, brief and Started record; then the log. */
const GIVE_UP_MS = 300_000;

export interface ImplementButtonProps {
  /** The plan slug this prepares — the POST body, and nothing else. */
  slug: string;
  /** Whether the server will act, and why not — the board's `implement`. */
  implement: DispatchInfo;
  /** Reports that a click is outstanding (true) or has settled (false). */
  onActing?: (active: boolean) => void;
  /**
   * The word on the control, when the reader's question is not *implement this
   * plan*. A row missing its brief asks a narrower one — see
   * {@link WriteBriefButton} — and the answer is the same route, the same POST
   * body, the same outcome. Only the word differs, because only the question
   * does. Defaults to *Implement*.
   */
  label?: string;
  /** The word while a click is outstanding. Defaults to *implementing…*. */
  actingLabel?: string;
  /**
   * The hover title when the control will act. A caller that renames the
   * control renames what it promises, so the two travel together. The refusal
   * reason still wins when it cannot act — that is not the caller's to override.
   */
  title?: string;
}

type State =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'prepared' }
  | { kind: 'failed'; message: string };

export function ImplementButton({
  slug,
  implement,
  onActing,
  label = 'Implement',
  actingLabel = 'implementing…',
  title,
}: ImplementButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const running = state.kind === 'running';

  /**
   * IS ONE OF MINE ALREADY RUNNING? — the guard `DispatchAllButton` and
   * `DeliverButton` both carry: two clicks inside one tick both read `idle` from
   * state a render behind and both POST, which is two `/plot-implement` agents
   * for one decision. A ref changes synchronously, so the second of the pair
   * sees it.
   */
  const inFlight = useRef(false);
  useEffect(() => {
    if (!running) inFlight.current = false;
  }, [running]);

  // Announce the transition, and always announce the way back out — including on
  // unmount, or a menu that closes mid-run leaves the board polling fast forever.
  // Same rule as DeliverButton's `onActing`.
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
        const res = await fetch(`/api/implement/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(ACTION_TIMEOUT_MS) });
        const body = (await res.json()) as { state?: string; message?: string };
        if (cancelled) return;
        if (body.state === 'failed') {
          setState({ kind: 'failed', message: body.message || 'the implement command failed' });
          return;
        }
        if (body.state === 'done') {
          // Prepared: the command exited 0. What it prepared — a branch, a brief,
          // a Started record, or a drift report it stopped on — is in the log; the
          // board itself moves nothing here, so this is the whole of the signal.
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
        signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
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
        data-implement={slug}
        onClick={() => {
          // `aria-disabled` does not stop a click the way `disabled` does, so the
          // refusal has to be stated here as well: the attribute is what assistive
          // technology reads, this is what makes it true.
          if (inFlight.current || blocked) return;
          inFlight.current = true;
          void run();
        }}
        // `aria-disabled` rather than the native attribute, the decision #160
        // settled: a natively disabled button leaves the tab order, taking the
        // control AND its explanation out of reach of the reader who cannot see
        // the page has dimmed.
        aria-disabled={blocked || undefined}
        aria-busy={running}
        title={implement.available ? (title ?? `Implement ${slug} — prepare a slice with /plot-implement`) : implement.reason}
        className={
          blocked
            ? `cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600${running ? ` ${ACTING_CLASS}` : ''}`
            : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {running ? actingLabel : label}
        {/* Beside the word, never instead of it — motion must not be the only
            carrier of a fact, and the label is what a screen reader gets. */}
        {running && <ActingSpinner />}
        {/* Why it will not act, for a reader with no pointer to hover. */}
        {refusal && <span className="sr-only"> — unavailable: {refusal}</span>}
      </button>
      {state.kind === 'prepared' && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Prepared — see the implement log
        </span>
      )}
      {state.kind === 'failed' && (
        <span
          data-implement-error={slug}
          className="whitespace-pre-line text-xs text-red-700 dark:text-red-400"
        >
          {state.message}
        </span>
      )}
    </span>
  );
}
