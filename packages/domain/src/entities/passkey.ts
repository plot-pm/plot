import { z } from 'zod';

/** The version word the passkey file carries. A literal, so another format fails the parse. */
export const PASSKEY_VERSION = 1;

/** The COSE algorithm id for ES256, the only algorithm a registration accepts. */
export const COSE_ES256 = -7;

/**
 * The one registered credential: the person's platform authenticator.
 *
 * `publicKey` is the SPKI DER the browser returns from
 * `AuthenticatorAttestationResponse.getPublicKey()`, base64url. `signCount` is
 * the last counter a verified assertion carried.
 */
export const PasskeyRecordSchema = z
  .object({
    v: z.literal(PASSKEY_VERSION),
    credentialId: z.string().min(1),
    publicKey: z.string().min(1),
    signCount: z.number().int().min(0),
    registeredAt: z.string().min(1),
  })
  .strict();
export type PasskeyRecord = z.infer<typeof PasskeyRecordSchema>;

/**
 * Parses the passkey file's text.
 *
 * @param text - the file's contents.
 * @returns the record, or null where the text is empty, unparseable or another version.
 */
export const decodePasskeyRecord = (text: string): PasskeyRecord | null => {
  if (text.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = PasskeyRecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

/**
 * Renders a record as the text written to disk.
 *
 * @param record - the record to render.
 * @returns the file's contents, newline-terminated.
 */
export const encodePasskeyRecord = (record: PasskeyRecord): string =>
  `${JSON.stringify(record, null, 2)}\n`;
