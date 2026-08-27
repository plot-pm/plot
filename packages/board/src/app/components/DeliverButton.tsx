import { useEffect, useRef, useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';
import type { DispatchInfo } from '../../contract/schema.js';
import { ACTING_CLASS, ActingSpinner } from './ui/ActingSpinner.js';

/**
 * *Deliver* — the decision a person makes about a plan the board has measured
 * complete.
 *
 * A plan whose every non-deferred branch has merged is bumped into Testing by
 * the server on its own; that bump is a MEASUREMENT (*docs/board-domain-model.md*:
 * every wave being complete is a measurement, delivering is a decision). This
 * control is where the decision is made: it spawns `/plot-deliver`, which
 * re-verifies the merges, flips the phase to Delivered and moves the plan. It
 * does not itself change the plan — and it is never fired automatically, so
 * reaching Testing never implies it was pressed.
 *
 * The interaction is `ResliceButton`'s, to the letter and deliberately: arm on
 * the first click, act on the second, cancel on a click elsewhere or Escape. It
 * spawns a plot agent — the same class of act as Slice this wave and Commission
 * design — and controls on one board that confirmed differently would be things
 * to learn twice. The armed label names the CONSEQUENCE
 * (`spawns /plot-deliver for <slug>?`), because what the click starts is the
 * part a reader needs before committing to it.
 *
 * **Nothing is asserted from the reply.** A delivery moves the card out of
 * Testing only once its phase flips, which the board re-derives from git on the
 * next refresh. So the click's outcome is read back from `GET /api/deliver/<slug>`
 * only to surface the command's own words on a refusal; success is the card
 * leaving Testing, which the board sees for itself.
 *
 * This component is rendered ONLY on a `deliverable` card (see `PlanActions`),
 * the same way `ResliceButton` renders only on an `unsliced-wave` row — so the
 * per-plan "is this complete" gate lives at the call site, and this control asks
 * only whether the BOARD can act (`deliver.available`).
 */

/** How often to ask what happened, once a click is outstanding. */
const POLL_MS = 700;

/** Long enough for an agent to verify every PR and move the plan; then the log. */
const GIVE_UP_MS = 300_000;

export interface DeliverButtonProps {
  /** The plan slug this delivers — the POST body, and nothing else. */
  slug: string;
  /** Whether the server will act, and why not — the board's `deliver`. */
  deliver: DispatchInfo;
  /** Reports that a click is outstanding (true) or has settled (false). */
  onActing?: (active: boolean) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'running' }
  | { kind: 'failed'; message: string };

/**
 * What the armed button says — the consequence, named as precisely as the slug
 * allows.
 *
 * `Deliver — spawns /plot-deliver for <slug>?` states both halves: an agent will
 * run, and which plan it acts on. A label repeating the verb would leave a
 * reader to wonder whether the click writes the transition itself — which it
 * deliberately does NOT (`/plot-deliver` verifies first, then moves the plan).
 *
 * Exported for test.
 */
export function armedLabel(slug: string): string {
  return `Deliver — spawns /plot-deliver for ${slug}?`;
}

export function DeliverButton({ slug, deliver, onActing }: DeliverButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const armed = state.kind === 'armed';
  const running = state.kind === 'running';

  /**
   * IS ONE OF MINE ALREADY RUNNING? — the guard `ResliceButton` measured into
   * existence, and it matters here as much: two clicks on the ARMED button inside
   * one tick both read `armed` from state a render behind and both call `run()`,
   * which is two `/plot-deliver` agents for one decision. A ref changes
   * synchronously, so the second of that pair sees it.
   */
  const inFlight = useRef(false);
  useEffect(() => {
    if (!running) inFlight.current = false;
  }, [running]);

  // Announce the transition, and always announce the way back out — including on
  // unmount, or a menu that closes mid-delivery leaves the board polling fast
  // forever. Same rule as ResliceButton's `onActing`.
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

  // Ask what happened. The board cannot tell us on a refusal — nothing moved —
  // so this reads the route that kept the command's own words.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(`/api/deliver/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(ACTION_TIMEOUT_MS) });
        const body = (await res.json()) as { state?: string; message?: string };
        if (cancelled) return;
        if (body.state === 'failed') {
          setState({ kind: 'failed', message: body.message || 'the deliver command failed' });
          return;
        }
        if (body.state === 'done') {
          // Nothing to assert: the command exited 0, and whether it moved the
          // plan is answered by the card leaving Testing on the next board poll —
          // derived from git, never from this reply.
          setState({ kind: 'idle' });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setState({ kind: 'failed', message: 'still running — see the deliver log' });
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
      const res = await fetch('/api/deliver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // THE SLUG, AND NOTHING ELSE. The server reads the plan from disk and
        // checks its own waves against the pulse, so no text this page holds
        // becomes the plan an agent acts on — the same rule Slice this wave
        // follows.
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

  const blocked = running || !deliver.available;

  const onClick = () => {
    // `aria-disabled` does not stop a click the way `disabled` does, so the
    // refusal has to be stated here as well: the attribute is what assistive
    // technology reads, this is what makes it true.
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

  return (
    <span ref={rootRef} className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        data-deliver={slug}
        onClick={onClick}
        // `aria-disabled` rather than the native attribute, the decision #160
        // settled: a natively disabled button leaves the tab order, taking the
        // control AND its explanation out of reach of the reader who cannot see
        // the page has dimmed.
        aria-disabled={blocked || undefined}
        aria-busy={running}
        aria-pressed={armed}
        title={deliver.available ? `Deliver ${slug} — flip its phase to Delivered` : deliver.reason}
        className={
          armed
            ? 'rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 hover:underline dark:bg-amber-900/40 dark:text-amber-200'
            : blocked
              ? `cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600${running ? ` ${ACTING_CLASS}` : ''}`
              : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {running ? 'delivering…' : armed ? armedLabel(slug) : 'Deliver'}
        {/* Beside the word, never instead of it — motion must not be the only
            carrier of a fact, and the label is what a screen reader gets. */}
        {running && <ActingSpinner />}
        {/* Why it will not act, for a reader with no pointer to hover. */}
        {!deliver.available && deliver.reason && (
          <span className="sr-only"> — unavailable: {deliver.reason}</span>
        )}
      </button>
      {state.kind === 'failed' && (
        <span
          data-deliver-error={slug}
          className="whitespace-pre-line text-xs text-red-700 dark:text-red-400"
        >
          {state.message}
        </span>
      )}
    </span>
  );
}
