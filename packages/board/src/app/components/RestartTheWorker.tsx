import { useState } from 'react';
import type { ContinueRefusal } from '@plot-pm/fleet/shared/continuation';
import { refusalWord } from './ContinueWithAnAnswer.js';

/** The button's label. */
export const RESTART_LABEL = 'Restart the worker';

/** The sentence under the button: what starts, and what it inherits. */
export const RESTART_HINT =
  'Starts a NEW worker in this worktree. It inherits the tree as it stands, including uncommitted work, and carries on from the brief and `git log`.';

export interface RestartTheWorkerProps {
  branch: string;
  /** Whether `POST /api/restart` will act at all, from `/api/board`. */
  available: boolean;
  /** Why not, when it is not. */
  unavailableReason?: string;
  /** Injected by tests; the browser's `fetch` in the app. */
  fetcher?: typeof fetch;
}

type Phase =
  | { at: 'idle' }
  | { at: 'sending' }
  | { at: 'started'; pid: string; previousPid: string }
  | { at: 'refused'; reason: ContinueRefusal }
  | { at: 'error'; message: string };

/** The control that starts a new worker on a claimed branch whose worker is dead. */
export const RestartTheWorker = ({ branch, available, unavailableReason, fetcher = fetch }: RestartTheWorkerProps) => {
  const [phase, setPhase] = useState<Phase>({ at: 'idle' });

  if (!available) {
    return (
      <div
        data-restart-unavailable
        className="shrink-0 border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400"
      >
        {unavailableReason || 'Restarting is not available on this board.'}
      </div>
    );
  }

  const send = () => {
    if (phase.at === 'sending') return;
    setPhase({ at: 'sending' });
    fetcher('/api/restart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    })
      .then(async (res) => {
        const body = (await res.json()) as
          | { ok: true; pid: string; previousPid: string }
          | { ok: false; reason: ContinueRefusal }
          | { error: string };
        if ('error' in body) setPhase({ at: 'error', message: body.error });
        else if (body.ok === false) setPhase({ at: 'refused', reason: body.reason });
        else setPhase({ at: 'started', pid: body.pid, previousPid: body.previousPid });
      })
      .catch((e: unknown) => {
        setPhase({ at: 'error', message: e instanceof Error ? e.message : String(e) });
      });
  };

  return (
    <div data-restart className="shrink-0 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{RESTART_HINT}</p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          data-restart-send
          onClick={send}
          disabled={phase.at === 'sending' || phase.at === 'started'}
          className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
        >
          {phase.at === 'sending' ? 'Starting…' : RESTART_LABEL}
        </button>
        {phase.at === 'started' && (
          <span data-restart-started className="text-xs text-emerald-700 dark:text-emerald-400">
            New worker started (pid {phase.pid}
            {phase.previousPid ? `, replacing pid ${phase.previousPid}` : ''}).
          </span>
        )}
        {phase.at === 'refused' && (
          <span data-restart-refused={phase.reason} className="text-xs text-amber-700 dark:text-amber-400">
            {refusalWord(phase.reason)}
          </span>
        )}
        {phase.at === 'error' && (
          <span data-restart-error className="text-xs text-rose-600 dark:text-rose-400">
            {phase.message}
          </span>
        )}
      </div>
    </div>
  );
};
