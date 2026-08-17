import { useEffect, useRef, useState } from 'react';
import type { Card, DispatchInfo } from '../../contract/schema.js';

/**
 * How often to ask what happened, once a click is outstanding.
 *
 * Its own clock rather than the board's `pulse`, and that is the difference
 * between this button and Start work. A dispatch MOVES A ROW, so the board's
 * own re-read of git is the confirmation and counting pulses is exactly right.
 * A refused approval changes nothing on the board at all — no row moves, no
 * card travels — so there is nothing to watch, and the answer has to be
 * fetched from the route that holds it.
 */
const POLL_MS = 700;

/** Long enough for a merge plus a push; past this, the log is the answer. */
const GIVE_UP_MS = 120_000;

/**
 * Approve: the board's second acting control, and the only one that writes to
 * the git host.
 *
 * ONE CONFIRMATION, IN THE BUTTON ITSELF. The first click arms it, the second
 * runs it, a click anywhere else cancels. No dialog, no modal above a modal, no
 * new pattern — and the armed label names the CONSEQUENCE (`merges PR #146?`)
 * rather than repeating the verb, because the consequence is the part a reader
 * needs before committing to it.
 *
 * The friction is deliberate and it is also *modest*: the same irreversibility
 * exists when the command is typed in a terminal, where nothing confirms
 * anything, and it gets typed by rote — eight approvals in one evening through
 * the identical sequence. A button is not more dangerous than that. So one
 * confirmation, not a dialog someone would learn to dismiss.
 */
export interface ApproveButtonProps {
  card: Card;
  /** Whether the server will act, and why not — see the board's `approve`. */
  approve: DispatchInfo;
  /** Reports that a click is outstanding (true) or has settled (false). */
  onApproving?: (active: boolean) => void;
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
 * A plan under `Review: pr` has a plan PR and the number is the most concrete
 * thing a reader could be told. A plan that names no PR is NOT an error: the
 * card shows on every Draft plan by design, and `Review: in-session` approvals
 * merge nothing at all. So the fallback says what is still true — that this
 * approves the plan — rather than inventing a PR number or hiding the button.
 *
 * Exported for test: the two branches are display logic with a real edge case,
 * and the PR-less one is the branch a fixture is most likely to hit.
 */
export function armedLabel(card: Card): string {
  const pr = card.prs[0];
  return pr ? `Approve — merges PR #${pr.number}?` : `Approve — approves ${card.slug}?`;
}

export function ApproveButton({ card, approve, onApproving }: ApproveButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const armed = state.kind === 'armed';
  const running = state.kind === 'running';

  // Announce the transition, and always announce the way back out — including
  // on unmount, or a card that scrolls away mid-approval would leave the board
  // polling fast forever. Same rule as StartWorkButton's `onStarting`.
  useEffect(() => {
    if (!running || !onApproving) return;
    onApproving(true);
    return () => onApproving(false);
  }, [running, onApproving]);

  // A CLICK ELSEWHERE CANCELS. Registered only while armed, so the board is not
  // carrying a document listener for every Draft card on screen. `pointerdown`
  // rather than `click`: it fires before the button's own handler on a second
  // click, so the guard below is what keeps arming from cancelling itself.
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!armed) return;
    const cancel = (e: Event) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setState({ kind: 'idle' });
    };
    document.addEventListener('pointerdown', cancel, true);
    // Escape too. An armed control with no keyboard way out is a trap for
    // anyone who armed it by pressing Enter on it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setState({ kind: 'idle' });
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', cancel, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [armed]);

  // Ask what happened. The board cannot tell us — an approval that fails moves
  // nothing — so this reads the route that kept the command's own words.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(`/api/approve/${encodeURIComponent(card.slug)}`);
        const body = (await res.json()) as { state?: string; message?: string; log?: string };
        if (cancelled) return;
        if (body.state === 'failed') {
          // The whole point of the route: the SCRIPT'S OWN WORDS, verbatim.
          // Replacing them with "failed" would send the reader to a terminal,
          // and then the command could have been typed there in the first place.
          setState({ kind: 'failed', message: body.message || 'the approve command failed' });
          return;
        }
        if (body.state === 'done') {
          // Nothing to say. The card is about to leave Discovery on the next
          // board poll, and the card moving IS the confirmation — derived from
          // git, never asserted from a reply.
          setState({ kind: 'idle' });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        // Deliberately not a diagnosis. The command is still going or its log
        // is the only thing that knows; the board asserting either would be
        // making something up.
        setState({ kind: 'failed', message: 'still running — see the approve log' });
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
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: card.slug }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setState({ kind: 'failed', message: body.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const onClick = () => {
    if (state.kind === 'idle' || state.kind === 'failed') {
      // A failed attempt re-arms rather than re-runs: the reason has just been
      // read, and the next click should be as deliberate as the first was.
      setState({ kind: 'armed' });
      return;
    }
    if (state.kind === 'armed') void run();
  };

  return (
    <span ref={rootRef} className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        type="button"
        onClick={onClick}
        disabled={running || !approve.available}
        aria-busy={running}
        // The armed state is announced, not merely coloured: a reader on a
        // screen reader must hear that this click is the one that acts.
        aria-pressed={armed}
        title={approve.available ? `Run /plot-approve ${card.slug}` : approve.reason}
        className={
          armed
            ? 'rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 hover:underline dark:bg-amber-900/40 dark:text-amber-200'
            : 'text-xs font-medium text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline dark:text-blue-400 dark:disabled:text-slate-600'
        }
      >
        {running ? 'approving…' : armed ? armedLabel(card) : 'Approve'}
      </button>
      {state.kind === 'failed' && (
        // The command's own message, on the card. Pre-wrapped: /plot-approve
        // writes sentences, and a merge refusal can carry more than one line.
        <span className="whitespace-pre-line text-xs text-red-700 dark:text-red-400">
          {state.message}
        </span>
      )}
    </span>
  );
}
