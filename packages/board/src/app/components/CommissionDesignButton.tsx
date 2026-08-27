import { useEffect, useRef, useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';
import type { Card, DispatchInfo } from '../../contract/schema.js';
import { ACTING_CLASS, ActingSpinner } from './ui/ActingSpinner.js';

/**
 * *Commission design* — the OTHER answer to a Draft plan, beside *Approve*.
 *
 * Approve hands the plan to development; this says it needs a spec, a spike or a
 * tracer bullet FIRST, and creates a plan in phase `Design` to hold that work.
 * It ships that phase minimally rather than as a refusal — the phase landed in
 * #259 and nothing filled it, so a menu entry that only explained why it could
 * not act would leave the phase unreachable for longer.
 *
 * The interaction is `ApproveButton`'s, to the letter and deliberately: arm on
 * the first click, act on the second, cancel on a click elsewhere or Escape.
 * This spawns an agent — the same class of act as Approve and Create plan — and
 * three acting controls on one surface that confirmed differently would be three
 * things to learn. The armed label names the CONSEQUENCE (`moves <slug> to
 * Design?`), because the consequence is the part a reader needs before
 * committing to it.
 *
 * **Nothing is asserted from the reply.** A commission that fails moves no row —
 * the plan's phase is what changes, and the board re-derives that from git on
 * the next refresh. So the click's outcome is read back from
 * `GET /api/commission/<slug>` only to surface the command's own words on a
 * refusal; success is the plan moving out of Draft, which the board sees for
 * itself.
 */

/** How often to ask what happened, once a click is outstanding. */
const POLL_MS = 700;

/** Long enough for an agent to read a plan and rewrite it; past this, the log. */
const GIVE_UP_MS = 300_000;

export interface CommissionDesignButtonProps {
  card: Card;
  /** Whether the server will act, and why not — the board's `commission`. */
  commission: DispatchInfo;
  /** Reports that a click is outstanding (true) or has settled (false). */
  onActing?: (active: boolean) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'running' }
  | { kind: 'failed'; message: string };

/**
 * What the armed button says — the consequence, named as precisely as the card
 * can name it.
 *
 * `Commission design — moves <slug> to Design?` states both halves: a plan will
 * move, and where it will move to. A label repeating the verb would leave a
 * reader to wonder whether the click drafts the spec too — precisely the thing
 * this deliberately does NOT do (it creates the empty section and stops).
 *
 * Exported for test.
 */
export function armedLabel(card: Card): string {
  return `Commission design — moves ${card.slug} to Design?`;
}

export function CommissionDesignButton({ card, commission, onActing }: CommissionDesignButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const armed = state.kind === 'armed';
  const running = state.kind === 'running';

  /**
   * IS ONE OF MINE ALREADY RUNNING? — the guard `ApproveButton` measured into
   * existence, and it matters as much here: two clicks on the ARMED button
   * inside one tick both read `armed` from state a render behind and both call
   * `run()`, which is two `/plot` agents writing two Design plans for one
   * decision. A ref changes synchronously, so the second of that pair sees it.
   */
  const inFlight = useRef(false);
  useEffect(() => {
    if (!running) inFlight.current = false;
  }, [running]);

  // Announce the transition, and always announce the way back out — including on
  // unmount, or a menu that closes mid-commission leaves the board polling fast
  // forever. Same rule as ApproveButton's `onApproving`.
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
        const res = await fetch(`/api/commission/${encodeURIComponent(card.slug)}`, { signal: AbortSignal.timeout(ACTION_TIMEOUT_MS) });
        const body = (await res.json()) as { state?: string; message?: string };
        if (cancelled) return;
        if (body.state === 'failed') {
          setState({ kind: 'failed', message: body.message || 'the commission command failed' });
          return;
        }
        if (body.state === 'done') {
          // Nothing to assert: the command exited 0, and whether it wrote a
          // Design-phase plan is answered by the plan moving out of Draft on the
          // next board poll — derived from git, never from this reply.
          setState({ kind: 'idle' });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        setState({ kind: 'failed', message: 'still running — see the commission log' });
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running, card.slug]);

  const run = async () => {
    setState({ kind: 'running' });
    try {
      const res = await fetch('/api/commission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // THE SLUG, AND NOTHING ELSE. The server reads the plan from disk and
        // checks its phase itself, so no text this page holds becomes the plan
        // an agent acts on — the same rule Create plan follows with the number.
        body: JSON.stringify({ slug: card.slug }),
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

  const blocked = running || !commission.available;

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
        data-commission={card.slug}
        onClick={onClick}
        // `aria-disabled` rather than the native attribute, the decision #160
        // settled: a natively disabled button leaves the tab order, taking the
        // control AND its explanation out of reach of the reader who cannot see
        // the page has dimmed.
        aria-disabled={blocked || undefined}
        aria-busy={running}
        aria-pressed={armed}
        title={commission.available ? `Move ${card.slug} into Design` : commission.reason}
        className={
          armed
            ? 'rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 hover:underline dark:bg-amber-900/40 dark:text-amber-200'
            : blocked
              ? `cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600${running ? ` ${ACTING_CLASS}` : ''}`
              : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {running ? 'commissioning…' : armed ? armedLabel(card) : 'Commission design'}
        {/* Beside the word, never instead of it — motion must not be the only
            carrier of a fact, and the label is what a screen reader gets. */}
        {running && <ActingSpinner />}
        {/* Why it will not act, for a reader with no pointer to hover. */}
        {!commission.available && commission.reason && (
          <span className="sr-only"> — unavailable: {commission.reason}</span>
        )}
      </button>
      {state.kind === 'failed' && (
        <span
          data-commission-error={card.slug}
          className="whitespace-pre-line text-xs text-red-700 dark:text-red-400"
        >
          {state.message}
        </span>
      )}
    </span>
  );
}
