// The browser half of the passkey release approval: what the page may attempt
// and how it words a refusal. The server decides; this file only shows.

/** The origin host the relying party id `localhost` accepts. */
export const PASSKEY_HOST = 'localhost';

/**
 * Whether this page may call `navigator.credentials`.
 *
 * @param hostname - `location.hostname`.
 * @returns the notice to show instead of the controls, or `null` when the page is on `localhost`.
 */
export const originNotice = (hostname: string): string | null =>
  hostname === PASSKEY_HOST ? null : `A passkey works only on http://localhost:<port>. This page is on ${hostname}; open the board at localhost to register or approve.`;

/** The words shown for a refusal name the server answers. */
export const refusalWording = (reason: string, detail?: string): string => {
  const base: Record<string, string> = {
    'person-unproven': 'Not approved: the request carried no verified passkey.',
    'passkey-unregistered': 'Not approved: no passkey is registered. Register one first.',
    'passkey-refused': 'Not approved: the passkey assertion failed a check.',
    'challenge-expired': 'Not approved: the challenge expired or was already used. Try again.',
    'passkey-exists': 'A passkey is already registered. Replacing it needs the registered passkey.',
  };
  const head = base[reason] ?? `Not approved: ${reason}.`;
  return detail ? `${head} ${detail}` : head;
};

/** Encodes bytes as base64url, the form every passkey route takes. */
export const b64url = (bytes: ArrayBuffer): string => {
  let text = '';
  for (const b of new Uint8Array(bytes)) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Decodes a base64url string to bytes. */
export const fromB64url = (text: string): Uint8Array<ArrayBuffer> => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

/** The challenge route's answer. */
export interface IssuedChallenge {
  challenge: string;
  rpId: string;
  credentialId: string;
}

/**
 * Asks the authenticator for a user-verified assertion over a server challenge.
 *
 * @param issued - the challenge route's answer.
 * @returns the assertion in the shape `POST /api/release-approve` takes.
 */
export const assertWith = async (issued: IssuedChallenge): Promise<Record<string, string>> => {
  const got = (await navigator.credentials.get({
    publicKey: {
      challenge: fromB64url(issued.challenge),
      rpId: issued.rpId,
      allowCredentials: [{ type: 'public-key', id: fromB64url(issued.credentialId) }],
      userVerification: 'required',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!got) throw new Error('the authenticator returned no assertion');
  const r = got.response as AuthenticatorAssertionResponse;
  return {
    credentialId: b64url(got.rawId),
    authenticatorData: b64url(r.authenticatorData),
    clientDataJSON: b64url(r.clientDataJSON),
    signature: b64url(r.signature),
  };
};
