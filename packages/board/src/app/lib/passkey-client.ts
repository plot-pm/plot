// The browser's calls to the passkey routes, shared by the settings view
// (registration) and the sidebar panel (release approval). The server decides;
// this file only calls.
import type { PasskeyRegistration } from '@plot-pm/domain/rules/passkey-settings';
import { ACTION_TIMEOUT_MS } from './bounded-fetch.js';
import { assertWith, b64url, refusalWording, type IssuedChallenge } from './passkey.js';

/** POSTs a JSON body and answers the status with the parsed body, `{}` where it does not parse. */
export const post = async (url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

/** Reads `GET /api/passkey`; answers `null` where the read fails. */
export const readRegistration = async (): Promise<PasskeyRegistration | null> => {
  try {
    const res = await fetch('/api/passkey', { signal: AbortSignal.timeout(ACTION_TIMEOUT_MS) });
    return (await res.json()) as PasskeyRegistration;
  } catch {
    return null;
  }
};

/** Asks `POST /api/passkey/challenge` for a challenge over `what`; throws the refusal's wording on a refusal. */
export const challenge = async (what: Record<string, unknown>): Promise<IssuedChallenge> => {
  const got = await post('/api/passkey/challenge', what);
  if (got.status !== 200) throw new Error(refusalWording(String(got.body.reason ?? ''), String(got.body.detail ?? '')));
  return got.body as unknown as IssuedChallenge;
};

/**
 * Registers a platform passkey, or replaces the registered one.
 *
 * @param replacing - whether a passkey is registered; replacing it needs an assertion from it first.
 * @returns the sentence to show the operator.
 */
export const registerPasskey = async (replacing: boolean): Promise<string> => {
  const replace = replacing ? await assertWith(await challenge({ action: 'passkey-replace' })) : undefined;
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
};
