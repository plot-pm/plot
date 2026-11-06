import { z } from 'zod';

/** The authenticator-data flag bit for user presence. */
export const FLAG_UP = 0x01;
/** The authenticator-data flag bit for user verification. */
export const FLAG_UV = 0x04;

/**
 * The checks {@link passkeyVerdict} makes, in the order it makes them. A
 * refusal names the first one that failed.
 */
export const PasskeyCheckSchema = z.enum([
  'type',
  'challenge',
  'origin',
  'rp-id-hash',
  'user-present',
  'user-verified',
  'sign-count',
  'signature',
]);
export type PasskeyCheck = z.infer<typeof PasskeyCheckSchema>;

/** What the adapter decoded from one assertion. */
export interface PasskeyReadings {
  /** `clientDataJSON.type`. */
  readonly type: string;
  /** `clientDataJSON.challenge`, base64url as the browser wrote it. */
  readonly challenge: string;
  /** `clientDataJSON.origin`. */
  readonly origin: string;
  /** The first 32 bytes of the authenticator data, hex. */
  readonly rpIdHash: string;
  /** The flags byte of the authenticator data. */
  readonly flags: number;
  /** The 32-bit signature counter of the authenticator data. */
  readonly signCount: number;
  /** Whether the signature over `authenticatorData ‖ sha256(clientDataJSON)` verified under the registered key. */
  readonly signature: 'valid' | 'invalid';
}

/** What the server expects of the assertion it asked for. */
export interface PasskeyExpectation {
  /** The challenge the server issued, base64url. */
  readonly challenge: string;
  /** The exact origin the board is served from. */
  readonly origin: string;
  /** `sha256(rpId)`, hex. */
  readonly rpIdHash: string;
  /** The sign count stored with the credential. */
  readonly storedSignCount: number;
}

/** The verdict: the assertion passes, or the first check that failed. */
export type PasskeyVerdict = { readonly ok: true } | { readonly ok: false; readonly check: PasskeyCheck };

/**
 * Decides whether a decoded WebAuthn assertion proves a user-verified use of the
 * registered credential for the challenge the server issued.
 *
 * The UV flag is read from the signed authenticator data: the browser's
 * `userVerification` option alone proves nothing to the server. A sign count
 * passes when it exceeds the stored one, or when both are zero (an
 * authenticator that keeps no counter).
 *
 * @param readings - the decoded assertion and its signature result.
 * @param expected - the challenge, origin, RP id hash and stored sign count.
 * @returns `{ ok: true }`, or `{ ok: false, check }` naming the first failed check.
 */
export const passkeyVerdict = (readings: PasskeyReadings, expected: PasskeyExpectation): PasskeyVerdict => {
  const no = (check: PasskeyCheck): PasskeyVerdict => ({ ok: false, check });
  if (readings.type !== 'webauthn.get') return no('type');
  if (readings.challenge !== expected.challenge) return no('challenge');
  if (readings.origin !== expected.origin) return no('origin');
  if (readings.rpIdHash !== expected.rpIdHash) return no('rp-id-hash');
  if ((readings.flags & FLAG_UP) === 0) return no('user-present');
  if ((readings.flags & FLAG_UV) === 0) return no('user-verified');
  const moved = readings.signCount > expected.storedSignCount
    || (readings.signCount === 0 && expected.storedSignCount === 0);
  if (!moved) return no('sign-count');
  if (readings.signature !== 'valid') return no('signature');
  return { ok: true };
};
