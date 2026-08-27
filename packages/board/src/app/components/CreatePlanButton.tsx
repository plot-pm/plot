import { useEffect, useRef, useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';
import type { DispatchInfo, IssueAnswer, IssueRow } from '../../contract/schema.js';
import { ACTING_CLASS, ActingSpinner } from './ui/ActingSpinner.js';

/**
 * *Create plan* — the issue row's ONE action, and the only thing on this board
 * that turns something which is not a plan into one.
 *
 * **It creates a Draft.** The row exists to ask *is this worth planning?*, and
 * a control that produced an approved plan would answer that question rather
 * than pose it. The armed label says `creates a Draft` for exactly this reason:
 * the consequence a reader needs before committing is not *a plan appears* but
 * *a plan appears, and nothing has been decided yet*.
 *
 * **Nothing reaches the tracker.** No comment, no label, no state change. The
 * row disappears because the created plan REFERENCES the issue, which is a fact
 * about the plan and not about the tracker — so the confirmation this control
 * waits for is the row going away on the next refresh, never a reply.
 *
 * The interaction is `ApproveButton`'s, deliberately and to the letter: arm on
 * the first click, act on the second, cancel on a click elsewhere or Escape.
 * Two acting controls on one surface that confirmed differently would be two
 * things to learn, and this one is spawning an agent — the same class of act.
 */

/** How often to ask what happened, once a click is outstanding. */
const POLL_MS = 700;

/**
 * Long enough for an agent to read an issue, decide the ceremony and write a
 * plan file. Past this, the log is the answer — and the ROW is: a plan that
 * landed makes it disappear whatever this poll believes.
 */
const GIVE_UP_MS = 300_000;

export interface CreatePlanButtonProps {
  issue: IssueRow;
  /** Whether this board will act — `Board.idea`. Half the question; see below. */
  idea: DispatchInfo;
  /** Whether the tracker can be asked at all — `Fleet.issueAnswer`. The other half. */
  issueAnswer: IssueAnswer;
}

type State =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'running' }
  | { kind: 'failed'; message: string };

/**
 * What the armed button says — the consequence, and the consequence is the
 * BOUNDARY as much as the act.
 *
 * `Create plan — Draft for #228?` names both halves: a plan will exist, and it
 * will be a Draft. A label that said only "create a plan" would leave a reader
 * to wonder whether the click also commits the work, which is precisely the
 * decision this row is asking them to make separately.
 *
 * Exported for test.
 */
export function armedLabel(issue: IssueRow): string {
  return `Create plan — Draft for #${issue.number}?`;
}

/**
 * Why the control will not act, or "" when it will.
 *
 * **TWO INDEPENDENT QUESTIONS, and both must pass.** The binding says whether
 * this board can spawn anything; `issueAnswer` says whether the tracker can be
 * asked at all. A Bitbucket repo (`unsupported`) and a tracker whose lookup
 * broke (`failed`) each make the action impossible for reasons the binding
 * knows nothing about — and offering a button that cannot work is worse than
 * offering none, because the reader spends a click to learn it.
 *
 * `failed` is refused rather than attempted, and it does NOT read as "no
 * issues": the row is on screen precisely because the last good lookup found
 * it, and the message says the lookup is broken rather than implying the issue
 * is gone. An outage is not an answer, in this direction too.
 *
 * Exported for test — the four branches are the brief's own requirement.
 */
export function refusalReason(idea: DispatchInfo, issueAnswer: IssueAnswer): string {
  if (issueAnswer === 'unsupported') {
    return 'this git host has no issue read, so an issue cannot become a plan from here';
  }
  if (issueAnswer === 'failed') {
    return 'the issue lookup is failing, so this issue cannot be read — nothing was created';
  }
  if (!idea.available) return idea.reason || 'this board cannot create plans';
  return '';
}

export function CreatePlanButton({ issue, idea, issueAnswer }: CreatePlanButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const armed = state.kind === 'armed';
  const running = state.kind === 'running';

  /**
   * IS ONE OF MINE ALREADY RUNNING? — the guard `ApproveButton` measured into
   * existence, and it matters more here.
   *
   * `blocked` reads `state`, and `setState` does not take effect until the next
   * render, so two clicks on the ARMED button inside one tick both see `armed`
   * and both call `run()`. There it is a second merge attempt; here it is TWO
   * `/plot-idea` agents on one issue, racing to write two plan files for one
   * signal — the row's own failure mode, caused by the row's own action. A ref
   * changes synchronously, so the second of that pair sees the flag set.
   */
  const inFlight = useRef(false);

  useEffect(() => {
    if (!running) inFlight.current = false;
  }, [running]);

  // A CLICK ELSEWHERE CANCELS, and so does Escape — an armed control with no
  // keyboard way out is a trap for anyone who armed it by pressing Enter.
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

  // Ask what happened. The board's own refresh is the REAL confirmation — a
  // plan that references the issue makes this row disappear — but a refusal
  // moves nothing at all, so the reason has to be fetched from the route that
  // kept the command's own words.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(`/api/idea/${issue.number}`, { signal: AbortSignal.timeout(ACTION_TIMEOUT_MS) });
        const body = (await res.json()) as { state?: string; message?: string };
        if (cancelled) return;
        if (body.state === 'failed') {
          // The command's own words, verbatim — the whole point of the route.
          setState({ kind: 'failed', message: body.message || 'the idea command failed' });
          return;
        }
        if (body.state === 'done') {
          // Nothing to say, and deliberately no claim that a plan exists: the
          // command exited 0, and whether it WROTE a plan that references this
          // issue is answered by the row disappearing on the next board poll —
          // derived from git, never asserted from an exit code.
          setState({ kind: 'idle' });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        // Not a diagnosis. The agent is still going or its log is the only
        // thing that knows; asserting either would be making something up.
        setState({ kind: 'failed', message: 'still running — see the idea log' });
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running, issue.number]);

  const run = async () => {
    setState({ kind: 'running' });
    try {
      const res = await fetch('/api/idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // THE NUMBER, AND NOTHING ELSE. The server reads the issue's title and
        // body from the host itself, so no text this page holds can become the
        // problem statement an agent acts on.
        //
        // `type` is stated because `/plot-idea` unattended STOPS without one
        // and writes no plan file — it drives release notes and the version
        // bump, and that skill forbids inferring it from a title. `feature` is
        // the board's declared default rather than a guess about this issue;
        // the plan is a Draft precisely so a reader can correct it.
        body: JSON.stringify({ number: issue.number, type: 'feature' }),
        signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
      });
      const body = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        // `detail` first: the refusals carry it, and it is the sentence that
        // says which of the four happened.
        setState({ kind: 'failed', message: body.detail ?? body.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const refusal = refusalReason(idea, issueAnswer);
  const blocked = running || refusal !== '';

  const onClick = () => {
    // `aria-disabled` does not stop a click the way `disabled` does, so the
    // refusal has to be stated here as well. Both are needed: the attribute is
    // what assistive technology reads, this is what makes it true.
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
        data-create-plan={issue.number}
        onClick={onClick}
        // `aria-disabled` rather than the native attribute, the decision #160
        // settled: a natively disabled button leaves the tab order, which takes
        // the control AND its explanation out of reach of exactly the reader
        // who cannot see that the page has dimmed.
        aria-disabled={blocked || undefined}
        aria-busy={running}
        aria-pressed={armed}
        title={refusal || `Create a Draft plan from issue #${issue.number}`}
        className={
          armed
            ? 'rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 hover:underline dark:bg-amber-900/40 dark:text-amber-200'
            : blocked
              ? `cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600${running ? ` ${ACTING_CLASS}` : ''}`
              : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {running ? 'creating…' : armed ? armedLabel(issue) : 'Create plan'}
        {/* Beside the word, never instead of it — motion must not be the only
            carrier of a fact, and the label is what a screen reader gets. */}
        {running && <ActingSpinner />}
        {/* Why it will not act, for a reader with no pointer to hover. */}
        {refusal && <span className="sr-only"> — unavailable: {refusal}</span>}
      </button>
      {state.kind === 'failed' && (
        <span
          data-create-plan-error={issue.number}
          className="whitespace-pre-line text-xs text-red-700 dark:text-red-400"
        >
          {state.message}
        </span>
      )}
    </span>
  );
}
