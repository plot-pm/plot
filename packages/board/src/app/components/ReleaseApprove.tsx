import { useEffect, useState } from 'react';
import type { PasskeyRegistration } from '@plot-pm/domain/rules/passkey-settings';
import { releaseApprovable } from '@plot-pm/domain/rules/release-approvable';
import type { AgentRow } from '../../contract/schema.js';
import { readRegistration } from '../lib/passkey-client.js';
import { approveRelease, releaseReadingOf } from '../lib/release-approve.js';

/**
 * The release PR row's "Approve release" button.
 *
 * The button always shows. `releaseApprovable` decides whether it is enabled and,
 * where it is not, the reason this renders beside it. The click approves the row's
 * own PR number and head, and the server re-reads both before it merges.
 */
export const ReleaseApprove = ({ row }: { row: AgentRow }) => {
  const [held, setHeld] = useState<PasskeyRegistration | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void readRegistration().then(setHeld);
  }, []);

  const reading = releaseReadingOf(row.pr);
  const answer = releaseApprovable(reading, held);
  const pr = row.pr;

  const click = async () => {
    if (busy || answer.state !== 'enabled' || pr === null || pr.headSha === undefined) return;
    const { number, headSha } = pr;
    setBusy(true);
    setMessage('');
    try {
      setMessage(await approveRelease(number, headSha));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void readRegistration().then(setHeld);
    }
  };

  return (
    <span className="flex shrink-0 items-center gap-2" data-testid="release-approve">
      <button
        type="button"
        disabled={answer.state === 'disabled' || busy}
        title={answer.reason || undefined}
        onClick={click}
        className="rounded border px-2 py-0.5 text-xs"
      >
        Approve release
      </button>
      {answer.reason && <span className="text-xs text-slate-500" data-testid="release-approve-reason">{answer.reason}</span>}
      {message && <span className="text-xs" data-testid="release-approve-message">{message}</span>}
    </span>
  );
};
