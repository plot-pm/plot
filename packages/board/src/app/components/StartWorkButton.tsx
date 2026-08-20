import { useEffect, useRef, useState } from 'react';
import type { Card, DispatchInfo } from '../../contract/schema.js';
import { ACTING_CLASS, ActingSpinner } from './ui/ActingSpinner.js';

/**
 * WHAT THE BUTTON WATCHES — the count its own action moves.
 *
 * `card.started` describes the PLAN; a dispatch starts a BRANCH. A plan with
 * three waves is `started: true` for ever after its first branch is dispatched,
 * so a button waiting on that flag can never see a second wave land: it sat
 * through three pulses and reported *no change — see log* about a dispatch that
 * had prepared a worktree and pushed a claim. Measured on 2026-08-17 on the
 * exact card `started: true, claimed: 0, eligible: 1`.
 *
 * `waveSummary.claimed` is the count a dispatch moves, on EVERY wave — a claim
 * is a pushed ref, and claiming one more branch is precisely what succeeded.
 *
 * Still DERIVED, never asserted. What changes is which fact is read, not
 * whether git confirms it: the pulse re-reads the refs and this compares the
 * count across pulses. The button still does not move the row.
 *
 * Returns `undefined` when the answer is UNKNOWN — no pulse has landed, so
 * there is no count to compare and *nothing changed* would be a guess. The
 * caller keeps waiting rather than concluding either way.
 */
export function claimedCount(card: Card): number | undefined {
  return card.waveSummary?.claimed;
}

/**
 * May this button act, and if not, in whose words?
 *
 * Three refusals, in the order they are learned, and each carries the reason on
 * the control itself — the row action menu's rule: refuse with the reason,
 * rather than accept and disappoint three pulses later.
 *
 * 1. **The server will not act** — no dispatch binding, a non-localhost host.
 *    `DispatchInfo` already says so in its own words, and those win: they are
 *    about whether anything may act at all.
 * 2. **No pulse has landed.** Both counts are `.optional()` in the contract —
 *    *"Absent when there is no pulse"* — and without a scan the board does not
 *    know which wave is eligible, so a dispatch would be a click into the dark
 *    that it also could not report on afterwards. It says it is waiting for the
 *    first scan: the same posture the board takes when it has lost contact,
 *    rather than a fourth vocabulary for *I don't know*.
 *
 *    It deliberately does NOT fall back to `card.started` here. That would keep
 *    the defect alive in precisely the window where it is most likely — a
 *    freshly restarted board — hidden behind an apparently-working button.
 * 3. **Nothing is eligible.** With `eligible: 0` every wave is claimed, merged
 *    or blocked and there is no branch to take. Saying so before the click is
 *    the whole improvement over accepting and going quiet.
 *
 * A card with no `waveSummary` at all is a pre-wave plan, not a missing pulse:
 * `plot-dispatch.sh` is the authority on those and refuses in its own words, so
 * the button lets the click through rather than inventing a precondition.
 */
export function startRefusal(card: Card, dispatch: DispatchInfo): string | undefined {
  if (!dispatch.available) return dispatch.reason;
  const summary = card.waveSummary;
  if (!summary) return undefined;
  if (summary.claimed === undefined || summary.eligible === undefined) {
    return 'waiting for the first fleet scan';
  }
  if (summary.eligible === 0) return 'no branch is eligible to start';
  return undefined;
}

/**
 * What a pulse says about a dispatch still in flight.
 *
 * `confirmed` — one more branch is claimed than when the click went out. That
 * is what a dispatch does, so that is what confirms it.
 *
 * `waiting` — no movement yet, or no answer to compare: a count that is absent
 * on either side is UNKNOWN, never *unchanged*. It must not read as
 * confirmation, and it must not read as a decline either.
 *
 * `gave-up` — enough pulses have passed to stop waiting. The button does not
 * guess WHICH failure happened; the script wrote the truth to the log.
 *
 * Exported for test because this is the whole defect in one expression, and
 * because the case that matters — a plan already `started: true`, so the flag
 * the old code watched could never move — is a comparison of two numbers rather
 * than anything a rendered page shows.
 */
export type PulseVerdict = 'confirmed' | 'waiting' | 'gave-up';

export function verdictFromPulse(args: {
  /** `claimed` when the click went out; `undefined` if no pulse had landed. */
  claimedAtClick: number | undefined;
  /** `claimed` now. `undefined` if the pulse has since stopped landing. */
  claimedNow: number | undefined;
  /** Pulses elapsed since the click. */
  pulsesElapsed: number;
  /** How many to wait before giving up. */
  limit: number;
}): PulseVerdict {
  const { claimedAtClick, claimedNow, pulsesElapsed, limit } = args;
  if (claimedAtClick !== undefined && claimedNow !== undefined && claimedNow > claimedAtClick) {
    return 'confirmed';
  }
  return pulsesElapsed >= limit ? 'gave-up' : 'waiting';
}

/**
 * How many board refreshes to wait for the row to move before the button stops
 * watching for it.
 *
 * Long enough for a worktree create plus a push, short of leaving someone
 * staring at a spinner. When it elapses the button says only what it KNOWS — it
 * dispatched, and the next pulse re-derives from git — and stops there. It does
 * not guess which of the failure modes happened, and it no longer even asserts
 * that one did: a claim can still be in flight after three pulses. The
 * dispatcher wrote the truth to its log, and the `Status` entry in the row's
 * menu is the durable route to it; inventing a verdict here would be the board
 * asserting something it does not know, which is the failure mode this whole
 * design is arranged against.
 */
const PULSES_BEFORE_GIVING_UP = 3;

/**
 * What the button says once it stops watching, and NOTHING MORE.
 *
 * The old message was *no change — see log*, and it was wrong twice over: it
 * asserted a FAILURE the button cannot know happened — a dispatch that prepared
 * a worktree, pushed a booking and started an agent still leaves `claimed`
 * unmoved for longer than the wait — and it offered the recourse as a TRANSIENT
 * path that the next re-render destroyed, so a reader told to *see log* found no
 * log to see.
 *
 * The button knows two things and says only those: it dispatched, and the next
 * pulse re-reads git. So the message reassures rather than diagnoses, and the
 * row travelling to WORKING is the confirmation. The dispatcher log — the thing
 * *see log* pointed at — now has a home that outlives this render: the `Status`
 * entry in the row's `...` menu, present whenever a dispatcher log exists.
 */
export const DISPATCHED_WORD = 'Agent work will show up shortly';

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
  | { kind: 'starting'; since: number }
  // The click has been dispatched and the button has stopped watching for the
  // row to move. NOT a failure and NOT a log path: the button reassures and the
  // pulse confirms — see DISPATCHED_WORD. The dispatcher log lives in the menu.
  | { kind: 'dispatched' }
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

  // What "it worked" means for this card: ONE MORE BRANCH IS CLAIMED.
  //
  // Not `card.started`, which this used to watch. That flag describes the PLAN
  // and the action starts a BRANCH, so on a plan of more than one wave it is
  // already true when the button is clicked and can never change again — see
  // `claimedCount` for the measurement. `claimed` moves on every wave, because
  // claiming a branch is exactly what a dispatch does.
  const claimedRef = useRef(claimedCount(card));
  const claimed = claimedCount(card);

  useEffect(() => {
    if (state.kind !== 'starting') {
      claimedRef.current = claimed;
      return;
    }
    // Feedback is DERIVED, never asserted: the button does not move the row.
    // The pulse re-reads git and the row travels on its own. An optimistic
    // update would be faster and would make the board display something it does
    // not know. This changes WHICH FACT is read, not whether git confirms it.
    const verdict = verdictFromPulse({
      claimedAtClick: claimedRef.current,
      claimedNow: claimed,
      pulsesElapsed: pulse - state.since,
      limit: PULSES_BEFORE_GIVING_UP,
    });
    if (verdict === 'confirmed') setState({ kind: 'idle' });
    // The wait elapsed without the row moving. The button does not conclude a
    // FAILURE from that — a claim can still be in flight — so it drops the
    // spinner and shows the reassurance, nothing more. The dispatcher log is a
    // menu entry away for anyone who wants to know what actually happened.
    else if (verdict === 'gave-up') setState({ kind: 'dispatched' });
  }, [pulse, claimed, state]);

  const start = async () => {
    // Disabled until the next pulse confirms, so a double click does not fire
    // two runs — see the `inFlight` ref above, which is what makes that true
    // within a single tick. Local state only — no server-side in-flight
    // registry: a second TAB is a different question, and git holds the lock
    // there; the claim race is the real safety net.
    setState({ kind: 'starting', since: pulse });
    try {
      const res = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: card.slug }),
      });
      const body = (await res.json()) as { slug?: string; log?: string; error?: string };
      // A non-2xx is the ONE thing the button can report as a failure: the
      // dispatch was refused before it began, and the server said why in words.
      // The 202 body still carries `log` (the dispatcher log path), but the
      // button no longer keeps it: the row's `Status` menu entry reads that log
      // durably, rather than this render owning a pointer it will destroy.
      if (!res.ok) {
        setState({ kind: 'failed', message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      // Stay `starting` on success — the spinner runs until the pulse confirms
      // the row moved (idle) or the wait elapses (dispatched). Nothing to store.
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  // Every reason this will not act, in the words of whoever owns it. The
  // server's refusals still come from `DispatchInfo`; the two new ones — no
  // pulse yet, nothing eligible — are the board's own, and both are stated
  // BEFORE the click rather than after three pulses of silence.
  const refusal = startRefusal(card, dispatch);
  const blocked = starting || refusal !== undefined;

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
        title={refusal ?? `Dispatch the next eligible branch of ${card.slug}`}
        // Dimmed while in flight, on the SAME state that drives the label —
        // `starting`, never a timer of its own — so the contrast comes back
        // exactly when the pulse resolves the click. The refused styling stays
        // as it was: `blocked` is a superset of `starting`, and a click that is
        // being acted on must not look like one the board declined.
        className={
          blocked
            ? `cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600${starting ? ` ${ACTING_CLASS}` : ''}`
            : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {starting ? 'starting…' : 'Start work'}
        {/* Beside the word, never instead of it. Motion must not be the only
            carrier of a fact, and the label is what a screen reader gets. */}
        {starting && <ActingSpinner />}
        {/* Why it will not act, for a reader with no pointer to hover and no
            view of the dimmed page. Off screen, so the row is unchanged.
            Suppressed while starting: that refusal is temporary and already
            announced by the label and `aria-busy`. */}
        {!starting && refusal && (
          <span className="sr-only"> — unavailable: {refusal}</span>
        )}
      </button>
      {state.kind === 'dispatched' && (
        // Reassurance, not a verdict — and no log path. The button dispatched;
        // whether the agent started is a fact the next pulse carries, not one
        // this render can claim. Neutral (slate), not amber: an amber warning
        // would re-assert the failure the old message wrongly implied. Anyone
        // who wants the dispatcher's own words opens the row's `Status` menu.
        <span data-dispatched className="text-xs text-slate-500 dark:text-slate-400">
          {DISPATCHED_WORD}
        </span>
      )}
      {state.kind === 'failed' && (
        <span className="text-xs text-red-700 dark:text-red-400">{state.message}</span>
      )}
    </>
  );
}
