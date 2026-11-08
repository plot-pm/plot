import { useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';

/**
 * *Release claim* — removes the claim on a branch that holds no work.
 *
 * Calls `POST /api/release-claim`, which clears the manifests naming the
 * branch, deletes its remote ref and detaches its desk. The route refuses a
 * branch whose agent is live or whose pull request is open, and its `detail`
 * is shown as the reason.
 *
 * Arm on the first click, act on the second: the act deletes a remote ref.
 */
export interface ReleaseClaimButtonProps {
  /** The branch whose claim is released — the POST body's `branch`. */
  branch: string;
  /** Injected by tests; the browser's `fetch` in the app. */
  fetcher?: typeof fetch;
}

type State =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'running' }
  | { kind: 'released'; detail: string }
  | { kind: 'failed'; message: string };

export const ReleaseClaimButton = ({ branch, fetcher = fetch }: ReleaseClaimButtonProps) => {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const release = async () => {
    setState({ kind: 'running' });
    try {
      const res = await fetcher('/api/release-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
        signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
      });
      const body = (await res.json()) as { released?: boolean; detail?: string; error?: string };
      if (res.ok && body.released) setState({ kind: 'released', detail: body.detail ?? '' });
      else setState({ kind: 'failed', message: body.detail ?? body.error ?? `HTTP ${res.status}` });
    } catch (e) {
      setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const onClick = () => {
    if (state.kind === 'running' || state.kind === 'released') return;
    if (state.kind === 'armed') void release();
    else setState({ kind: 'armed' });
  };

  const label =
    state.kind === 'running' ? 'releasing…'
      : state.kind === 'armed' ? 'Confirm release'
        : state.kind === 'released' ? 'Released'
          : 'Release claim';

  return (
    <>
      <button
        type="button"
        data-release-claim
        onClick={onClick}
        disabled={state.kind === 'running' || state.kind === 'released'}
        aria-label={`Release the claim on ${branch}`}
        className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-40 dark:text-blue-400"
      >
        {label}
      </button>
      {state.kind === 'released' && (
        <span data-release-claim-done className="ml-2 text-xs text-emerald-700 dark:text-emerald-400">
          {state.detail}
        </span>
      )}
      {state.kind === 'failed' && (
        <span data-release-claim-failed className="ml-2 text-xs text-rose-600 dark:text-rose-400">
          {state.message}
        </span>
      )}
    </>
  );
};
