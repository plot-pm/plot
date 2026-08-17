import { useEffect, useRef, useState } from 'react';
import type { Card, DispatchInfo } from '../../contract/schema.js';

/**
 * How many board refreshes to wait for the row to move before saying so.
 *
 * Long enough for a worktree create plus a push, short of leaving someone
 * staring at a spinner. When it elapses the button does NOT guess which of the
 * failure modes happened — the claim lost its race, no branch was eligible, the
 * script failed. The script already wrote the truth to the log; inventing a
 * reason here would be the board asserting something it does not know, which is
 * the failure mode this whole design is arranged against.
 */
const PULSES_BEFORE_GIVING_UP = 3;

export interface StartWorkButtonProps {
  card: Card;
  /** Whether the server will act, and why not — see DispatchInfoSchema. */
  dispatch: DispatchInfo;
  /**
   * Bumps once per board refresh. The button counts these rather than wall
   * clock: what it is waiting for is a re-read of git, so the thing to count is
   * re-reads.
   */
  pulse: number;
  /**
   * Reports that a click is outstanding (true) or has settled (false). The
   * board uses it to poll faster while anyone is waiting — the button itself
   * decides nothing about rates.
   */
  onStarting?: (active: boolean) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'starting'; since: number; log: string }
  | { kind: 'no-change'; log: string }
  | { kind: 'failed'; message: string };

/**
 * Start work: the board's one control that changes something.
 *
 * A real `<button>`, never an anchor. Open is an anchor on purpose — it has a
 * URL, and cmd/ctrl/middle-click must open the plan natively. This has no URL
 * and must never be openable in a new tab, prefetched, or bookmarked; it is a
 * state change, not a destination. A real button also gives keyboard activation
 * and a native `disabled`, so *starting…* is a real disabled control rather
 * than a simulated one.
 */
export function StartWorkButton({ card, dispatch, pulse, onStarting }: StartWorkButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const starting = state.kind === 'starting';

  /**
   * IS ONE OF MINE ALREADY RUNNING? — and nothing else.
   *
   * `blocked` below reads `state`, and `setState` does not take effect until
   * the next render, so two clicks inside one tick both saw `idle` and both
   * called `fetch`. Measured in test/integration/double-click.browser.test.ts:
   * two POSTs, on a button whose comment claimed one. A ref changes
   * SYNCHRONOUSLY, so the second click of that pair sees the flag already set.
   *
   * It does not replace `blocked`, which carries the OTHER refusals — no
   * dispatch binding, a non-localhost host — and those are about whether this
   * may act at all, a different question with a different answer.
   */
  const inFlight = useRef(false);

  // Released where the STATE is, not in a `finally` beside the fetch. The
  // button stays pending until the pulse confirms or gives up, and a ref
  // released when the request returned would re-arm it while it still reads
  // `starting…` — clickable again behind a label saying it is busy.
  useEffect(() => {
    if (!starting) inFlight.current = false;
  }, [starting]);

  // Announce the transition, and always announce the way back out — including
  // on unmount, or a card that scrolls out of a lane while starting would leave
  // the board polling fast forever.
  useEffect(() => {
    if (!starting || !onStarting) return;
    onStarting(true);
    return () => onStarting(false);
  }, [starting, onStarting]);

  // What "the row moved" means for this card. A dispatch that succeeds makes
  // plot-implement/the worker record a Started:, which moves the card out of
  // Design and into Development — so `started` flipping IS the confirmation,
  // read back from git rather than asserted from the 202.
  const startedRef = useRef(card.started);

  useEffect(() => {
    if (state.kind !== 'starting') {
      startedRef.current = card.started;
      return;
    }
    // Feedback is DERIVED, never asserted: the button does not move the row.
    // The pulse re-reads git and the row travels on its own. An optimistic
    // update would be faster and would make the board display something it does
    // not know.
    if (card.started !== startedRef.current) {
      setState({ kind: 'idle' });
      return;
    }
    if (pulse - state.since >= PULSES_BEFORE_GIVING_UP) {
      setState({ kind: 'no-change', log: state.log });
    }
  }, [pulse, card.started, state]);

  const start = async () => {
    // Disabled until the next pulse confirms, so a double click does not fire
    // two runs — see the `inFlight` ref above, which is what makes that true
    // within a single tick. Local state only — no server-side in-flight
    // registry: a second TAB is a different question, and git holds the lock
    // there; the claim race is the real safety net.
    setState({ kind: 'starting', since: pulse, log: '' });
    try {
      const res = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: card.slug }),
      });
      const body = (await res.json()) as { slug?: string; log?: string; error?: string };
      if (!res.ok) {
        setState({ kind: 'failed', message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setState((prev) =>
        prev.kind === 'starting' ? { ...prev, log: body.log ?? '' } : prev,
      );
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const blocked = starting || !dispatch.available;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // `aria-disabled` does not stop a click the way `disabled` does, so
          // the refusal has to be stated here as well. Both are needed and
          // neither is redundant: the attribute is what assistive technology
          // reads, this is what makes it true.
          //
          // The ref comes FIRST and answers a different question: `blocked`
          // reads state a render behind, so within one tick it is the ref that
          // knows one of these is already running.
          if (inFlight.current || blocked) return;
          inFlight.current = true;
          void start();
        }}
        // `aria-disabled` rather than the native `disabled` attribute.
        //
        // A natively disabled button is removed from the tab order, which takes
        // the control AND its explanation out of reach of exactly the reader
        // who cannot see that the page has dimmed. Announced-but-inert keeps
        // both: the button is still reachable, still named, and says why it
        // will not act.
        aria-disabled={blocked || undefined}
        aria-busy={starting}
        // The reason lives on the control itself where it is unavailable: a
        // disabled button with no explanation reads as a bug. `title` for a
        // pointer, and `aria-describedby` would need an id per card — the
        // accessible NAME already carries it below.
        title={dispatch.available ? `Dispatch the next eligible branch of ${card.slug}` : dispatch.reason}
        className={
          blocked
            ? 'cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600'
            : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {starting ? 'starting…' : 'Start work'}
        {/* Why it will not act, for a reader with no pointer to hover and no
            view of the dimmed page. Off screen, so the row is unchanged. */}
        {!dispatch.available && dispatch.reason && (
          <span className="sr-only"> — unavailable: {dispatch.reason}</span>
        )}
      </button>
      {state.kind === 'no-change' && (
        // Deliberately not a diagnosis. Three things produce this and the board
        // can tell them apart only by reading the log the script wrote.
        <span
          className="text-xs text-amber-700 dark:text-amber-400"
          title={state.log ? `Dispatcher log: ${state.log}` : undefined}
        >
          no change — see log{state.log ? `: ${state.log}` : ''}
        </span>
      )}
      {state.kind === 'failed' && (
        <span className="text-xs text-red-700 dark:text-red-400">{state.message}</span>
      )}
    </>
  );
}
