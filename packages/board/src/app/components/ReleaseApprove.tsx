import { useState } from 'react';
import type { ReleaseApprovable } from '@plot-pm/domain/rules/release-approvable';
import type { AgentRow } from '../../contract/schema.js';
import { approveRelease } from '../lib/release-approve.js';

/**
 * The Release group's "Approve release" button.
 *
 * The button always shows. `button` comes from `releaseStatusLine`, which also writes the
 * status line, so the button and the line cannot disagree; the reason is the button's title.
 * The click approves the bound row's own PR number and head, and the server re-reads both
 * before it merges. `onDone` runs after every click, so the group re-reads the passkey.
 */
export const ReleaseApprove = ({ button, row, onDone }: { button: ReleaseApprovable; row: AgentRow | null; onDone: () => void }) => {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pr = row?.pr ?? null;

  const click = async () => {
    if (busy || button.state !== 'enabled' || pr === null || pr.headSha === undefined) return;
    const { number, headSha } = pr;
    setBusy(true);
    setMessage('');
    try {
      setMessage(await approveRelease(number, headSha));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <span className="flex min-w-0 flex-col items-end gap-1" data-testid="release-approve">
      <button
        type="button"
        disabled={button.state === 'disabled' || busy}
        title={button.reason || undefined}
        onClick={click}
        className="delivery-approve"
      >
        Approve release
      </button>
      {message && <span className="max-w-48 break-words text-right text-xs" data-testid="release-approve-message">{message}</span>}
    </span>
  );
};
