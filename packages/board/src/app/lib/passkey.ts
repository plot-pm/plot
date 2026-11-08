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

type Cbor = number | Uint8Array | string | Map<number | string, Cbor>;

/** Reads one definite-length CBOR item at `at`; returns it and the offset after it. */
const readCbor = (buf: Uint8Array, at: number, depth = 0): [Cbor, number] => {
  if (depth > 4) throw new Error('CBOR nesting too deep');
  if (at >= buf.length) throw new Error('attestationObject is truncated');
  const major = buf[at]! >> 5;
  const info = buf[at]! & 0x1f;
  let pos = at + 1;
  let arg: number;
  if (info < 24) arg = info;
  else if (info >= 24 && info <= 26) {
    const width = 1 << (info - 24);
    if (pos + width > buf.length) throw new Error('attestationObject is truncated');
    arg = 0;
    for (let i = 0; i < width; i++) arg = arg * 256 + buf[pos + i]!;
    pos += width;
  } else throw new Error(info === 31 ? 'indefinite-length CBOR item is not supported' : `unsupported CBOR additional info ${info}`);
  if (major === 0) return [arg, pos];
  if (major === 1) return [-1 - arg, pos];
  if (major === 2 || major === 3) {
    if (pos + arg > buf.length) throw new Error('attestationObject is truncated');
    const bytes = buf.slice(pos, pos + arg);
    return [major === 2 ? bytes : new TextDecoder().decode(bytes), pos + arg];
  }
  if (major === 5) {
    const map = new Map<number | string, Cbor>();
    for (let i = 0; i < arg; i++) {
      const [k, afterKey] = readCbor(buf, pos, depth + 1);
      if (typeof k !== 'number' && typeof k !== 'string') throw new Error('unsupported CBOR map key');
      const [v, afterValue] = readCbor(buf, afterKey, depth + 1);
      map.set(k, v);
      pos = afterValue;
    }
    return [map, pos];
  }
  throw new Error(`unsupported CBOR type ${major}`);
};

/** DER prefix of a P-256 SubjectPublicKeyInfo, up to and including the BIT STRING header. */
const P256_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

/** The public key a registration carries: SPKI DER and its COSE algorithm. */
export interface RegisteredKey {
  alg: number;
  spki: Uint8Array;
}

/**
 * Reads the credential public key from an attestation object and converts it to SPKI DER.
 *
 * @param attestationObject - `AuthenticatorAttestationResponse.attestationObject`.
 * @returns the ES256 key as 91-byte SPKI DER with `alg` -7.
 * @throws Error naming the step that failed: a malformed object, a clear AT flag, or a COSE key that is not ES256 over P-256.
 */
export const decodeAttestationPublicKey = (attestationObject: ArrayBuffer): RegisteredKey => {
  const [root] = readCbor(new Uint8Array(attestationObject), 0);
  if (!(root instanceof Map)) throw new Error('attestationObject is not a CBOR map');
  const authData = root.get('authData');
  if (!(authData instanceof Uint8Array)) throw new Error('attestationObject has no authData byte string');
  if (authData.length < 37) throw new Error('authData is truncated');
  if ((authData[32]! & 0x40) === 0) throw new Error('AT flag not set');
  if (authData.length < 55) throw new Error('authData is truncated');
  const idLength = (authData[53]! << 8) | authData[54]!;
  const keyAt = 55 + idLength;
  if (keyAt >= authData.length) throw new Error('authData is truncated');
  const [cose] = readCbor(authData, keyAt);
  if (!(cose instanceof Map)) throw new Error('credential public key is not a CBOR map');
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty !== 2) throw new Error(`unsupported COSE key type ${String(kty)}`);
  if (alg !== -7) throw new Error(`unsupported COSE algorithm ${String(alg)}`);
  const crv = cose.get(-1);
  if (crv !== 1) throw new Error(`unsupported COSE curve ${String(crv)}`);
  const x = cose.get(-2);
  const y = cose.get(-3);
  if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) {
    throw new Error('COSE key coordinates are not 32 bytes');
  }
  const spki = new Uint8Array(P256_SPKI_PREFIX.length + 65);
  spki.set(P256_SPKI_PREFIX, 0);
  spki[P256_SPKI_PREFIX.length] = 0x04;
  spki.set(x, P256_SPKI_PREFIX.length + 1);
  spki.set(y, P256_SPKI_PREFIX.length + 33);
  return { alg: -7, spki };
};

/** The parts of `AuthenticatorAttestationResponse` the registration reads. */
export interface AttestationSource {
  attestationObject: ArrayBuffer;
  getPublicKey: () => ArrayBuffer | null;
  getPublicKeyAlgorithm: () => number;
}

/**
 * Chooses the key to register: the browser's own when it offers one, else the one decoded from the attestation object.
 *
 * @throws Error when the browser offers no key and the attestation object does not decode to a 91-byte ES256 SPKI.
 */
export const registrationKey = (response: AttestationSource): { alg: number; publicKey: ArrayBuffer } => {
  const given = response.getPublicKey();
  if (given) return { alg: response.getPublicKeyAlgorithm(), publicKey: given };
  const decoded = decodeAttestationPublicKey(response.attestationObject);
  if (decoded.spki.length !== 91) throw new Error('decoded public key is not 91 bytes');
  return { alg: decoded.alg, publicKey: decoded.spki.buffer as ArrayBuffer };
};
