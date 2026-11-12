import { useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';

/**
 * *Delete branch* — deletes the remote ref of a loose branch.
 *
 * Calls `POST /api/loose-delete`, which refuses a protected, named, held or claimed
 * branch, an open PR, a merged PR, an unpushed commit and a reading that does not
 * answer, pins the tip at `refs/plot/reaped/<branch>/<sha>`
 * and only then deletes. A refusal's `detail` is shown as the reason, and the ref is
 * untouched.
 *
 * Arm on the first click, act on the second: the act deletes a remote ref.
 */
export interface LooseDeleteButtonProps {
  /** The branch to delete — the POST body's `branch`. */
  branch: string;
  /** Injected by tests; the browser's `fetch` in the app. */
  fetcher?: typeof fetch;
}

type State =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'running' }
  | { kind: 'deleted'; restore: string }
  | { kind: 'failed'; message: string };

export const LooseDeleteButton = ({ branch, fetcher = fetch }: LooseDeleteButtonProps) => {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const remove = async () => {
    setState({ kind: 'running' });
    try {
      const res = await fetcher('/api/loose-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
        signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
      });
      const body = (await res.json()) as { ok?: boolean; pin?: string; detail?: string; error?: string };
      if (res.ok && body.ok) setState({ kind: 'deleted', restore: `git branch ${branch} ${body.pin ?? ''}`.trim() });
      else setState({ kind: 'failed', message: body.detail ?? body.error ?? `HTTP ${res.status}` });
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const onClick = () => {
    if (state.kind === 'running' || state.kind === 'deleted') return;
    if (state.kind === 'armed') void remove();
    else setState({ kind: 'armed' });
  };

  const label =
    state.kind === 'running' ? 'deleting…'
      : state.kind === 'armed' ? 'Confirm delete'
        : state.kind === 'deleted' ? 'Deleted'
          : 'Delete branch';

  return (
    <>
      <button
        type="button"
        data-loose-delete
        onClick={onClick}
        disabled={state.kind === 'running' || state.kind === 'deleted'}
        aria-label={`Delete the branch ${branch}`}
        className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-40 dark:text-rose-400"
      >
        {label}
      </button>
      {state.kind === 'deleted' && (
        <span data-loose-delete-done className="ml-2 font-mono text-xs text-emerald-700 dark:text-emerald-400">
          {state.restore}
        </span>
      )}
      {state.kind === 'failed' && (
        <span data-loose-delete-failed className="ml-2 text-xs text-rose-600 dark:text-rose-400">
          {state.message}
        </span>
      )}
    </>
  );
};
