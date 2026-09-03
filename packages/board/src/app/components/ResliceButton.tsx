import { useEffect, useRef, useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';
import type { DispatchInfo } from '../../contract/schema.js';
import { ACTING_CLASS, ActingSpinner } from './ui/ActingSpinner.js';

/**
 * *Slice this wave* — the answer to a wave the board reports `unsliced-wave`.
 *
 * A wave that holds more than one live branch cannot be dispatched: the fleet
 * hands out one branch per worker, and a wave of several has no single branch to
 * hand out. `/plot-reslice` reads those branches' diffs and PRs and proposes one
 * named wave per branch in an argued order — but naming is judgement, so it ASKS
 * a person before it rewrites the plan's `## Branches`. This control spawns that
 * command; it does not itself change the plan.
 *
 * The interaction is `CommissionDesignButton`'s, to the letter and deliberately:
 * arm on the first click, act on the second, cancel on a click elsewhere or
 * Escape. It spawns a plot agent — the same class of act as Commission design
 * and Create plan — and controls on one board that confirmed differently would
 * be things to learn twice. The armed label names the CONSEQUENCE
 * (`spawns /plot-reslice for <slug>?`), because what the click starts is the
 * part a reader needs before committing to it.
 *
 * **Nothing is asserted from the reply.** A reslice that a person confirms moves
 * no row here — it rewrites `## Branches`, and the board re-derives its waves
 * from git on the next refresh. So the click's outcome is read back from
 * `GET /api/reslice/<slug>` only to surface the command's own words on a
 * refusal; success is the wave splitting, which the board sees for itself.
 */

/** How often to ask what happened, once a click is outstanding. */
const POLL_MS = 700;

/** Long enough for an agent to read the branches and propose waves; then the log. */
const GIVE_UP_MS = 300_000;

export interface ResliceButtonProps {
  /** The plan slug whose tangled wave this slices — the POST body, and nothing else. */
  slug: string;
  /** Whether the server will act, and why not — the board's `reslice`. */
  reslice: DispatchInfo;
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
 * `Slice this wave — spawns /plot-reslice for <slug>?` states both halves: an
 * agent will run, and which plan it acts on. A label repeating the verb would
 * leave a reader to wonder whether the click rewrites the plan itself — precisely
 * the thing this deliberately does NOT do (`/plot-reslice` asks first).
 *
 * Exported for test.
 */
export function armedLabel(slug: string): string {
  return `Slice this plan — spawns /plot-reslice for ${slug}?`;
}

export function ResliceButton({ slug, reslice, onActing }: ResliceButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const armed = state.kind === 'armed';
  const running = state.kind === 'running';

  /**
   * IS ONE OF MINE ALREADY RUNNING? — the guard `ApproveButton` measured into
   * existence, and it matters here as much: two clicks on the ARMED button inside
   * one tick both read `armed` from state a render behind and both call `run()`,
   * which is two `/plot-reslice` agents for one decision. A ref changes
   * synchronously, so the second of that pair sees it.
   */
  const inFlight = useRef(false);
  useEffect(() => {
    if (!running) inFlight.current = false;
  }, [running]);

  // Announce the transition, and always announce the way back out — including on
  // unmount, or a menu that closes mid-reslice leaves the board polling fast
  // forever. Same rule as CommissionDesignButton's `onActing`.
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
        const res = await fetch(`/api/reslice/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(ACTION_TIMEOUT_MS) });
        const body = (await res.json()) as { state?: string; message?: string };
        if (cancelled) return;
        if (body.state === 'failed') {
          setState({ kind: 'failed', message: body.message || 'the reslice command failed' });
          return;
        }
        if (body.state === 'done') {
          // Nothing to assert: the command exited 0, and whether it rewrote
          // `## Branches` is answered by the wave splitting on the next board
          // poll — derived from git, never from this reply.
          setState({ kind: 'idle' });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setState({ kind: 'failed', message: 'still running — see the reslice log' });
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
      const res = await fetch('/api/reslice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // THE SLUG, AND NOTHING ELSE. The server reads the plan from disk and
        // checks its own waves, so no text this page holds becomes the plan an
        // agent acts on — the same rule Commission design follows.
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

  const blocked = running || !reslice.available;

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
        data-reslice={slug}
        onClick={onClick}
        // `aria-disabled` rather than the native attribute, the decision #160
        // settled: a natively disabled button leaves the tab order, taking the
        // control AND its explanation out of reach of the reader who cannot see
        // the page has dimmed.
        aria-disabled={blocked || undefined}
        aria-busy={running}
        aria-pressed={armed}
        title={reslice.available ? `Cut ${slug}'s slice into one slice per branch` : reslice.reason}
        className={
          armed
            ? 'rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 hover:underline dark:bg-amber-900/40 dark:text-amber-200'
            : blocked
              ? `cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600${running ? ` ${ACTING_CLASS}` : ''}`
              : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {running ? 'slicing…' : armed ? armedLabel(slug) : 'Slice this plan'}
        {/* Beside the word, never instead of it — motion must not be the only
            carrier of a fact, and the label is what a screen reader gets. */}
        {running && <ActingSpinner />}
        {/* Why it will not act, for a reader with no pointer to hover. */}
        {!reslice.available && reslice.reason && (
          <span className="sr-only"> — unavailable: {reslice.reason}</span>
        )}
      </button>
      {state.kind === 'failed' && (
        <span
          data-reslice-error={slug}
          className="whitespace-pre-line text-xs text-red-700 dark:text-red-400"
        >
          {state.message}
        </span>
      )}
    </span>
  );
}
