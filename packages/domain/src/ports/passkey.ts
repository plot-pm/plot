import type { PasskeyRecord } from '../entities/passkey.js';
import type { PortResult } from '../port-result.js';
import type { PasskeyCheck } from '../rules/passkey-verdict.js';

/** The fields of a WebAuthn assertion the server needs, each base64url as the browser sent it. */
export interface PasskeyAssertion {
  readonly credentialId: string;
  readonly authenticatorData: string;
  readonly clientDataJSON: string;
  readonly signature: string;
}

/** What the server expects of the assertion it asked for. */
export interface PasskeyExpected {
  /** The challenge the server issued, base64url. */
  readonly challenge: string;
  /** The exact origin the board is served from, `http://localhost:<port>`. */
  readonly origin: string;
  /** The relying party id, `localhost`. */
  readonly rpId: string;
}

/** What `verify` answers: a verified assertion, or why it did not verify. */
export type PasskeyOutcome =
  | { readonly kind: 'verified'; readonly credentialId: string }
  | { readonly kind: 'unregistered' }
  | { readonly kind: 'refused'; readonly check: PasskeyCheck | 'credential' | 'malformed' };

/** What `register` answers: the credential was stored, or one is already registered. */
export type PasskeyRegistered = 'registered' | 'exists';

/**
 * Keeps the one registered passkey and verifies assertions against it — one
 * file per repository, local to the machine that wrote it.
 */
export interface Passkey {
  /**
   * Reads the registered credential.
   *
   * @returns `null` where none is registered or the file is not one this Plot
   *   knows; `failed` where the read itself broke.
   */
  read(): Promise<PortResult<PasskeyRecord | null>>;

  /**
   * Stores a credential where none is registered. The first registration wins:
   * a second call changes nothing and answers `exists`.
   *
   * @param record - the credential to store.
   */
  register(record: PasskeyRecord): Promise<PortResult<PasskeyRegistered>>;

  /**
   * Replaces the registered credential. The caller has verified an assertion
   * from the credential being replaced.
   *
   * @param record - the credential to store.
   */
  replace(record: PasskeyRecord): Promise<PortResult<void>>;

  /**
   * Verifies an assertion against the registered credential and, on a pass,
   * stores the new sign count.
   *
   * @param assertion - the browser's assertion.
   * @param expected - the challenge, origin and RP id the server asked for.
   * @returns the outcome; an absent store is `unregistered`, never a pass.
   */
  verify(assertion: PasskeyAssertion, expected: PasskeyExpected): Promise<PortResult<PasskeyOutcome>>;
}
