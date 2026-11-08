import { useEffect, useState } from 'react';
import { passkeySettings, type PasskeyRegistration } from '@plot-pm/domain/rules/passkey-settings';
import { readRegistration, registerPasskey } from '../lib/passkey-client.js';

/**
 * The board's settings: passkey registration, its state and its one action.
 *
 * The domain decides every word and the action label (`passkeySettings`); this
 * component renders the answer and runs the registration flow. A page not on
 * `localhost` shows a notice and no controls.
 */
export const SettingsView = ({ held, onRegistration, onClose }: {
  held: PasskeyRegistration | null;
  onRegistration: (next: PasskeyRegistration | null) => void;
  onClose: () => void;
}) => {
  const shown = passkeySettings(held, typeof window === 'undefined' ? 'localhost' : window.location.hostname);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readRegistration().then(onRegistration);
  }, [onRegistration]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      setMessage(await registerPasskey(held?.registered === true));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      onRegistration(await readRegistration());
    }
  };

  return (
    <section aria-label="Settings" data-testid="settings-view" className="max-w-2xl space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold">Settings</h2>
        <button type="button" onClick={onClose} className="rounded border px-2 py-1">
          Close
        </button>
      </div>
      <h3 className="font-medium">Passkey</h3>
      {shown.notice ? (
        <p data-testid="passkey-origin-notice">{shown.notice}</p>
      ) : (
        <>
          <p data-testid="passkey-registration">{shown.line}</p>
          {shown.credential && <p className="font-mono text-xs">Credential {shown.credential}</p>}
          {shown.action && (
            <button type="button" disabled={busy} onClick={() => void run()} className="rounded border px-2 py-1">
              {shown.action}
            </button>
          )}
        </>
      )}
      {message && <p data-testid="passkey-message">{message}</p>}
    </section>
  );
};
