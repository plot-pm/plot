import { useEffect, useRef, useState } from 'react';
import type { DispatchInfo, IssueAnswer, IssueRow } from '../../contract/schema.js';
import { ACTING_CLASS, ActingSpinner } from './ui/ActingSpinner.js';

/**
 * *Create story* — the ticket row's SECOND action, and the control that used to
 * be offered only to refuse.
 *
 * **It replaced a categorical refusal with a conditional one.** The old control
 * carried a constant: *"a story is a decision you make — where it lives, whether
 * it is wanted yet — so it is created with /story-tracking at a terminal, not
 * from a board click"*, and its comment said this was *"not an oversight to be
 * filled by a later wave"*. Measured against the skill it describes, neither
 * named decision is what it claims:
 *
 * - **Where it lives** — `story-tracking` names its own escape: *"Skip the
 *   question only when the repo has exactly one home"*.
 * - **Whether it is wanted yet** — triage, with the skill's own override: an
 *   explicit request beats triage advice. **A click here IS that request.**
 *
 * And the ground the refusal stood on — *an unattended agent has nobody to ask*
 * — is refuted by the practice: `/story-tracking` is run unattended several
 * times a day from the prompt, through the same `PLOT_UNATTENDED` contract that
 * makes *Create plan* work.
 *
 * So the refusals that remain are about THIS REPO, not about the act: an unset
 * `Story command`, or several declared story homes. Both name what is missing.
 *
 * The interaction is `CreatePlanButton`'s, deliberately and to the letter: arm
 * on the first click, act on the second, cancel on a click elsewhere or Escape.
 * Two acting controls in one menu that confirmed differently would be two things
 * to learn, and this one spawns the same class of agent.
 */

/** How often to ask what happened, once a click is outstanding. */
const POLL_MS = 700;

/**
 * Long enough for an agent to read a ticket, run its triage and write a story.
 * Past this, the log is the answer.
 */
const GIVE_UP_MS = 300_000;

export interface CreateStoryButtonProps {
  issue: IssueRow;
  /** Whether this board will act — `Board.story`. Half the question; see below. */
  story: DispatchInfo;
  /** Whether the tracker can be asked at all — `Fleet.issueAnswer`. The other half. */
  issueAnswer: IssueAnswer;
}

type State =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'running' }
  | { kind: 'done' }
  | { kind: 'failed'; message: string };

/**
 * What the armed button says — the consequence, and the consequence is the
 * COMMITMENT as much as the act.
 *
 * `Create story — track #228?` names both halves: a story will exist, and what
 * it is for. The distinction the old refusal reached for is real and worth
 * keeping in the words: **a plan is a commitment to do work; a story is a
 * commitment to track work.** *Track* is the verb that says which one this is,
 * beside a *Create plan* that says `Draft`.
 *
 * Exported for test.
 */
export function armedLabel(issue: IssueRow): string {
  return `Create story — track #${issue.number}?`;
}

/**
 * Why the control will not act, or "" when it will.
 *
 * **TWO INDEPENDENT QUESTIONS, and both must pass** — the shape
 * `CreatePlanButton.refusalReason` established, and the same two questions: the
 * binding says whether this board can spawn anything, `issueAnswer` says whether
 * the tracker can be asked at all.
 *
 * **What it no longer does is refuse categorically.** The function this replaces
 * took no arguments and returned a constant, which is what made it a claim about
 * stories rather than a fact about this board. Everything here is a fact about
 * this board and this host, and the two repo-level facts it cannot see —
 * an unset `Story command`, several declared homes — come back from the route as
 * refusals that name the key.
 *
 * Exported for test — the branches are the plan's own requirement.
 */
export function refusalReason(story: DispatchInfo, issueAnswer: IssueAnswer): string {
  if (issueAnswer === 'unsupported') {
    return 'this git host has no issue read, so a ticket cannot become a story from here';
  }
  if (issueAnswer === 'failed') {
    return 'the issue lookup is failing, so this ticket cannot be read — nothing was created';
  }
  if (!story.available) return story.reason || 'this board cannot create stories';
  return '';
}

export function CreateStoryButton({ issue, story, issueAnswer }: CreateStoryButtonProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const armed = state.kind === 'armed';
  const running = state.kind === 'running';

  /**
   * IS ONE OF MINE ALREADY RUNNING? — the guard `CreatePlanButton` documents,
   * and it matters here for its reason: `blocked` reads `state`, and `setState`
   * does not take effect until the next render, so two clicks on the ARMED
   * button inside one tick would both call `run()` and spawn TWO
   * `/story-tracking` agents on one ticket. A ref changes synchronously.
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

  // Ask what happened — and here that is the WHOLE answer, which is the one way
  // this control differs from `CreatePlanButton`.
  //
  // A created plan makes its issue row DISAPPEAR: every plan carries an `Issue:`
  // field the board reads, so the board can derive the outcome from git on the
  // next refresh and the button needs to claim nothing. A story carries no such
  // field and moves no row at all. So a success that said nothing would be
  // indistinguishable from a click that did nothing — the unobserved-reported-
  // as-observed defect, inverted. This route's own words are the only evidence
  // there is, so `done` is SHOWN.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(`/api/story/${issue.number}`);
        const body = (await res.json()) as { state?: string; message?: string };
        if (cancelled) return;
        if (body.state === 'failed') {
          // The command's own words, verbatim — the whole point of the route.
          setState({ kind: 'failed', message: body.message || 'the story command failed' });
          return;
        }
        if (body.state === 'done') {
          // The command exited 0. Deliberately NOT "a story exists": whether it
          // wrote one — and whether its own triage advised against and it said
          // so — is in the story and the log, which is where the skill puts it.
          // This says what was observed and stops there.
          setState({ kind: 'done' });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        // Not a diagnosis. The agent is still going or its log is the only thing
        // that knows; asserting either would be making something up.
        setState({ kind: 'failed', message: 'still running — see the story log' });
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
      const res = await fetch('/api/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // THE NUMBER, AND NOTHING ELSE. The server reads the ticket's title and
        // body from the host itself, so no text this page holds can become the
        // brief an agent acts on.
        //
        // NO `type`, and no triage verdict either. `/api/idea` states a Type
        // because `/plot-idea` unattended stops without one; `/story-tracking`
        // needs no such field, and a triage opinion sent from here would be a
        // second place to keep that heuristic correct — the plan's closed Open
        // Point. The skill runs its own triage on the ticket the route hands it.
        body: JSON.stringify({ number: issue.number }),
      });
      const body = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        // `detail` first: the refusals carry it, and it is the sentence that
        // names the missing key or the unanswered home question.
        setState({ kind: 'failed', message: body.detail ?? body.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const refusal = refusalReason(story, issueAnswer);
  const blocked = running || refusal !== '';

  const onClick = () => {
    // `aria-disabled` does not stop a click the way `disabled` does, so the
    // refusal has to be stated here as well. Both are needed: the attribute is
    // what assistive technology reads, this is what makes it true.
    if (blocked) return;
    if (state.kind === 'idle' || state.kind === 'failed' || state.kind === 'done') {
      // A finished attempt re-arms rather than re-runs, the same rule a failed
      // one follows: the outcome has just been read, and a second story for one
      // ticket should be as deliberate as the first was.
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
        data-create-story={issue.number}
        onClick={onClick}
        // `aria-disabled` rather than the native attribute, the decision #160
        // settled: a natively disabled button leaves the tab order, which takes
        // the control AND its explanation out of reach of exactly the reader who
        // cannot see that the page has dimmed.
        aria-disabled={blocked || undefined}
        aria-busy={running}
        aria-pressed={armed}
        title={refusal || `Create a story from ticket #${issue.number}`}
        className={
          armed
            ? 'rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 hover:underline dark:bg-amber-900/40 dark:text-amber-200'
            : blocked
              ? `cursor-not-allowed text-xs font-medium text-slate-400 no-underline dark:text-slate-600${running ? ` ${ACTING_CLASS}` : ''}`
              : 'text-xs font-medium text-blue-600 hover:underline dark:text-blue-400'
        }
      >
        {running ? 'creating…' : armed ? armedLabel(issue) : 'Create story'}
        {/* Beside the word, never instead of it — motion must not be the only
            carrier of a fact, and the label is what a screen reader gets. */}
        {running && <ActingSpinner />}
        {/* Why it will not act, for a reader with no pointer to hover. */}
        {refusal && <span className="sr-only"> — unavailable: {refusal}</span>}
      </button>
      {state.kind === 'done' && (
        <span
          data-create-story-done={issue.number}
          className="text-xs text-slate-600 dark:text-slate-400"
        >
          {/* WHAT WAS OBSERVED, and not one word past it. The command exited 0;
              the story and the log say what it decided, including a triage it
              may have overridden on this explicit request. */}
          ran — see the story log
        </span>
      )}
      {state.kind === 'failed' && (
        <span
          data-create-story-error={issue.number}
          className="whitespace-pre-line text-xs text-red-700 dark:text-red-400"
        >
          {state.message}
        </span>
      )}
    </span>
  );
}
