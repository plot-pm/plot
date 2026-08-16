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
    // Disabled until the next pulse confirms, so a double click or a second tab
    // does not fire two runs. Local state only — no server-side in-flight
    // registry: git holds the lock, and the claim race is the real safety net.
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

  return (
    <>
      <button
        type="button"
        onClick={() => void start()}
        disabled={starting || !dispatch.available}
        aria-busy={starting}
        // The reason lives on the control itself where it is unavailable: a
        // disabled button with no explanation reads as a bug.
        title={dispatch.available ? `Dispatch the next eligible branch of ${card.slug}` : dispatch.reason}
        className="text-xs font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline dark:text-blue-400 dark:disabled:text-slate-600"
      >
        {starting ? 'starting…' : 'Start work'}
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
