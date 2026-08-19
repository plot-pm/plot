import { useState } from 'react';
import type { ContinueRefusal } from '../../server/continue.js';

/**
 * The control that answers a stopped agent — **named as a continuation, and the
 * name is the design rather than the copy.**
 *
 * `claude -p` is a one-way process: no stdin after launch. The agent that wrote
 * the question has exited by the time anyone reads it, so nothing a person types
 * here reaches it. What this starts is a NEW worker in the same worktree, given
 * the brief, the answer and what already landed.
 *
 * Calling it *Reply* would be the easy label and a false one. A reply implies a
 * recipient, a thread, and an agent that will read the next message too — a
 * channel this system does not have and cannot grow without a different runtime.
 * Every string in this component is checked against that: the button, the
 * heading, the placeholder and the confirmation all say what actually happens.
 */
export const CONTINUE_LABEL = 'Continue with an answer';

/**
 * The sentence under the control, which does the work the label cannot.
 *
 * The label has to be short; this is where the reader is told the thing that
 * will otherwise surprise them — that a fresh agent starts and the old one is
 * not listening. A reader who expects a conversation and gets a new run will
 * read the result as the agent ignoring them.
 */
export const CONTINUE_HINT =
  'Starts a NEW worker in this worktree with your answer, the brief, and what already landed. ' +
  'The agent that asked has already exited — this continues the work, not a conversation.';

/** What the panel says for each refusal — four reasons, four different moves. */
export function refusalWord(reason: ContinueRefusal): string {
  switch (reason) {
    case 'unknown-branch':
      return 'No plan on this board names that branch.';
    case 'no-worktree':
      return 'No worktree for this branch on this machine — continue it from the machine that holds it.';
    case 'no-question':
      // The precondition IS the state the control was offered for, so this is
      // most likely a stale view: someone else answered it, or the worker
      // cleared its own marker between the poll and the click.
      return 'Nothing is waiting on an answer in that worktree — the marker is gone, so it may already have been answered.';
    case 'no-worker-command':
      return 'No `Worker command` is configured, so the board cannot start one — continue it yourself in the worktree.';
  }
}

export interface ContinueWithAnAnswerProps {
  branch: string;
  /**
   * Whether the route will act at all, from `/api/board`.
   *
   * A control that looks live and 403s on click is a worse answer than one that
   * says up front what it cannot do — the rule `dispatchAvailability` states and
   * this obeys.
   */
  available: boolean;
  /** Why not, when it is not. */
  unavailableReason?: string;
  /** Injected by tests; the browser's `fetch` in the app. */
  fetcher?: typeof fetch;
}

/** What the control is doing right now. */
type Phase =
  | { at: 'idle' }
  | { at: 'sending' }
  | { at: 'started'; pid: string; previousPid: string }
  | { at: 'refused'; reason: ContinueRefusal }
  | { at: 'error'; message: string };

export function ContinueWithAnAnswer({
  branch,
  available,
  unavailableReason,
  fetcher = fetch,
}: ContinueWithAnAnswerProps) {
  const [answer, setAnswer] = useState('');
  const [phase, setPhase] = useState<Phase>({ at: 'idle' });

  if (!available) {
    return (
      <div
        data-continue-unavailable
        className="shrink-0 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400"
      >
        {unavailableReason || 'Continuing is not available on this board.'}
      </div>
    );
  }

  const send = () => {
    if (answer.trim() === '' || phase.at === 'sending') return;
    setPhase({ at: 'sending' });
    fetcher('/api/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch, answer }),
    })
      .then(async (res) => {
        const body = (await res.json()) as
          | { ok: true; pid: string; previousPid: string }
          | { ok: false; reason: ContinueRefusal }
          | { error: string };
        if ('error' in body) {
          setPhase({ at: 'error', message: body.error });
          return;
        }
        if (body.ok === false) {
          setPhase({ at: 'refused', reason: body.reason });
          return;
        }
        // The answer is CLEARED once it has been sent: it is now in the
        // worktree's prompt file, and a box still holding it invites a second
        // click that would start a second worker in the same tree.
        setAnswer('');
        setPhase({ at: 'started', pid: body.pid, previousPid: body.previousPid });
      })
      .catch((e: unknown) => {
        setPhase({ at: 'error', message: e instanceof Error ? e.message : String(e) });
      });
  };

  return (
    <div
      data-continue
      className="shrink-0 border-t border-slate-200 px-4 py-3 dark:border-slate-800"
    >
      <label
        htmlFor={`continue-${branch}`}
        className="block text-xs font-medium text-slate-700 dark:text-slate-200"
      >
        {CONTINUE_LABEL}
      </label>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
        {CONTINUE_HINT}
      </p>
      <textarea
        id={`continue-${branch}`}
        data-continue-answer
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        placeholder="Answer the question the worker left in its tree…"
        className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          data-continue-send
          onClick={send}
          disabled={answer.trim() === '' || phase.at === 'sending'}
          className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
        >
          {phase.at === 'sending' ? 'Starting…' : CONTINUE_LABEL}
        </button>

        {/* THE CONFIRMATION NAMES BOTH PIDS. "Started" alone would leave a
            reader unable to tell a new run from a reused one, which is exactly
            the distinction this wave exists to make visible. */}
        {phase.at === 'started' && (
          <span data-continue-started className="text-xs text-emerald-700 dark:text-emerald-400">
            New worker started (pid {phase.pid}
            {phase.previousPid ? `, replacing pid ${phase.previousPid}` : ''}).
          </span>
        )}

        {phase.at === 'refused' && (
          <span
            data-continue-refused={phase.reason}
            className="text-xs text-amber-700 dark:text-amber-400"
          >
            {refusalWord(phase.reason)}
          </span>
        )}

        {phase.at === 'error' && (
          <span data-continue-error className="text-xs text-rose-600 dark:text-rose-400">
            {phase.message}
          </span>
        )}
      </div>
    </div>
  );
}
