import { useCallback, useEffect, useState } from 'react';
import type { PasskeyRegistration } from '@plot-pm/domain/rules/passkey-settings';
import { assertWith, originNotice, refusalWording } from '../lib/passkey.js';
import { challenge, post, readRegistration } from '../lib/passkey-client.js';

/**
 * The release approval passkey controls: the registered credential and a release approval. Registration lives in `SettingsView`.
 *
 * A release approval needs a user-verified assertion from the platform
 * authenticator; the server decides and this panel only shows its answer. The
 * panel shows a notice and no controls where the page is not on `localhost`.
 * It renders closed, as one summary line, so the Agents tab keeps its footer in
 * view; its input row wraps at a phone's width.
 */
export function PasskeyPanel() {
  const notice = typeof window === 'undefined' ? null : originNotice(window.location.hostname);
  const [held, setHeld] = useState<PasskeyRegistration | null>(null);
  const [pr, setPr] = useState('');
  const [sha, setSha] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setHeld(await readRegistration());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (act: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      setMessage(await act());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void load();
    }
  };

  const approve = () =>
    run(async () => {
      const subject = { action: 'release-approve', pr: Number(pr), sha };
      const assertion = await assertWith(await challenge(subject));
      const done = await post('/api/release-approve', { pr: Number(pr), sha, assertion });
      if (done.status === 200 && done.body.approved) return `Release PR #${pr} approved with passkey ${String(done.body.credentialId ?? '')}.`;
      return refusalWording(String(done.body.reason ?? ''), String(done.body.detail ?? ''));
    });

  const ready = /^\d+$/.test(pr) && /^[0-9a-f]{7,40}$/i.test(sha);

  return (
    <details aria-label="Passkey" className="rounded border border-zinc-700 px-3 py-1 text-sm" data-testid="passkey-panel">
      <summary className="cursor-pointer font-medium">Release approval passkey</summary>
      <div className="space-y-2 pb-2 pt-1">
      {notice ? (
        <p data-testid="passkey-origin-notice">{notice}</p>
      ) : (
        <>
          <p data-testid="passkey-registration">
            {held === null
              ? 'Reading the registered passkey…'
              : held.registered
                ? `Registered credential ${held.credentialId} since ${held.registeredAt}`
                : 'No passkey registered.'}
          </p>
          {held?.registered === false && <p>Register a passkey in Settings</p>}
          <div className="flex flex-wrap gap-2">
            <input aria-label="Release PR number" placeholder="release PR #" value={pr} onChange={(e) => setPr(e.target.value)} className="w-28 rounded border bg-transparent px-1" />
            <input aria-label="Release PR head sha" placeholder="head sha" value={sha} onChange={(e) => setSha(e.target.value)} className="w-64 rounded border bg-transparent px-1" />
            <button type="button" disabled={busy || !ready || !held?.registered} onClick={approve} className="rounded border px-2 py-1">
              Approve release with passkey
            </button>
          </div>
        </>
      )}
      {message && <p data-testid="passkey-message">{message}</p>}
      </div>
    </details>
  );
}
