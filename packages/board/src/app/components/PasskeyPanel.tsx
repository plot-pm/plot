import { useCallback, useEffect, useState } from 'react';
import { ACTION_TIMEOUT_MS } from '../lib/bounded-fetch.js';
import { assertWith, b64url, originNotice, refusalWording, type IssuedChallenge } from '../lib/passkey.js';

interface Registration {
  registered: boolean;
  credentialId?: string;
  registeredAt?: string;
}

const post = async (url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

/**
 * The passkey controls: the registered credential and a release approval.
 *
 * A release approval needs a user-verified assertion from the platform
 * authenticator; the server decides and this panel only shows its answer. The
 * panel shows a notice and no controls where the page is not on `localhost`.
 */
export function PasskeyPanel() {
  const notice = typeof window === 'undefined' ? null : originNotice(window.location.hostname);
  const [held, setHeld] = useState<Registration | null>(null);
  const [pr, setPr] = useState('');
  const [sha, setSha] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/passkey', { signal: AbortSignal.timeout(ACTION_TIMEOUT_MS) });
      setHeld((await res.json()) as Registration);
    } catch {
      setHeld(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const challenge = async (what: Record<string, unknown>): Promise<IssuedChallenge> => {
    const got = await post('/api/passkey/challenge', what);
    if (got.status !== 200) throw new Error(refusalWording(String(got.body.reason ?? ''), String(got.body.detail ?? '')));
    return got.body as unknown as IssuedChallenge;
  };

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

  const register = () =>
    run(async () => {
      const replace = held?.registered ? await assertWith(await challenge({ action: 'passkey-replace' })) : undefined;
      const created = (await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { id: 'localhost', name: 'Plot board' },
          user: { id: new TextEncoder().encode('plot-board'), name: 'plot', displayName: 'Plot board' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
          timeout: 60_000,
        },
      })) as PublicKeyCredential | null;
      if (!created) return 'No credential was created.';
      const response = created.response as AuthenticatorAttestationResponse;
      const key = response.getPublicKey();
      if (!key) return 'The authenticator returned no public key.';
      const done = await post('/api/passkey/register', {
        credentialId: b64url(created.rawId),
        publicKey: b64url(key),
        alg: response.getPublicKeyAlgorithm(),
        assertion: replace,
      });
      return done.status === 200 ? 'Passkey registered.' : refusalWording(String(done.body.reason ?? ''), String(done.body.detail ?? ''));
    });

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
    <section aria-label="Passkey" className="rounded border border-zinc-700 p-3 text-sm space-y-2" data-testid="passkey-panel">
      <div className="font-medium">Release approval passkey</div>
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
          <button type="button" disabled={busy} onClick={register} className="rounded border px-2 py-1">
            {held?.registered ? 'Replace passkey' : 'Register passkey'}
          </button>
          <div className="flex gap-2">
            <input aria-label="Release PR number" placeholder="release PR #" value={pr} onChange={(e) => setPr(e.target.value)} className="w-28 rounded border bg-transparent px-1" />
            <input aria-label="Release PR head sha" placeholder="head sha" value={sha} onChange={(e) => setSha(e.target.value)} className="w-64 rounded border bg-transparent px-1" />
            <button type="button" disabled={busy || !ready || !held?.registered} onClick={approve} className="rounded border px-2 py-1">
              Approve release with passkey
            </button>
          </div>
        </>
      )}
      {message && <p data-testid="passkey-message">{message}</p>}
    </section>
  );
}
