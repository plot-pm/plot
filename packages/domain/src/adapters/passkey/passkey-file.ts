import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { decodePasskeyRecord, encodePasskeyRecord, type PasskeyRecord } from '../../entities/passkey.js';
import type { Passkey, PasskeyAssertion, PasskeyExpected, PasskeyOutcome } from '../../ports/passkey.js';
import { passkeyVerdict } from '../../rules/passkey-verdict.js';

/** Where the credential lives under a repository root. */
export const passkeyPath = (repoRoot: string): string =>
  join(repoRoot, '.plot', 'state', 'passkey.json');

const b64 = (text: string): Buffer => Buffer.from(text, 'base64url');

/** The signature check: ES256 over `authenticatorData ‖ sha256(clientDataJSON)` under an SPKI key. */
const signatureHolds = (record: PasskeyRecord, assertion: PasskeyAssertion): boolean => {
  try {
    const key = createPublicKey({ key: b64(record.publicKey), format: 'der', type: 'spki' });
    const signed = Buffer.concat([
      b64(assertion.authenticatorData),
      createHash('sha256').update(b64(assertion.clientDataJSON)).digest(),
    ]);
    return cryptoVerify('sha256', signed, key, b64(assertion.signature));
  } catch {
    return false;
  }
};

/**
 * Keeps the credential in `.plot/state/passkey.json` and verifies assertions
 * over `node:crypto`.
 *
 * @param repoRoot - the repository the file belongs to.
 * @returns a `Passkey` over that one file.
 */
export const passkeyFile = (repoRoot: string): Passkey => {
  const path = passkeyPath(repoRoot);

  const read = async (): Promise<PortResult<PasskeyRecord | null>> => {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return answered(null);
      return failed<PasskeyRecord | null>();
    }
    return answered(decodePasskeyRecord(text));
  };

  const write = async (record: PasskeyRecord): Promise<PortResult<void>> => {
    const temp = `${path}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temp, encodePasskeyRecord(record), { encoding: 'utf8', mode: 0o600 });
      await rename(temp, path);
      return answered(undefined);
    } catch {
      return failed<void>();
    }
  };

  return {
    read,
    register: async (record) => {
      const held = await read();
      if (!held.ok) return failed();
      // A file that exists and does not parse is not an absent store: refuse to overwrite it.
      if (held.value !== null) return answered('exists' as const);
      try {
        await readFile(path, 'utf8');
        return answered('exists' as const);
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') return failed();
      }
      const wrote = await write(record);
      return wrote.ok ? answered('registered' as const) : failed();
    },
    replace: write,
    verify: async (assertion: PasskeyAssertion, expected: PasskeyExpected): Promise<PortResult<PasskeyOutcome>> => {
      const held = await read();
      if (!held.ok) return failed();
      const record = held.value;
      if (record === null) return answered<PasskeyOutcome>({ kind: 'unregistered' });
      if (assertion.credentialId !== record.credentialId) {
        return answered<PasskeyOutcome>({ kind: 'refused', check: 'credential' });
      }
      let client: { type?: unknown; challenge?: unknown; origin?: unknown };
      const authData = b64(assertion.authenticatorData);
      try {
        client = JSON.parse(b64(assertion.clientDataJSON).toString('utf8')) as typeof client;
      } catch {
        return answered<PasskeyOutcome>({ kind: 'refused', check: 'malformed' });
      }
      if (authData.length < 37 || typeof client !== 'object' || client === null) {
        return answered<PasskeyOutcome>({ kind: 'refused', check: 'malformed' });
      }
      const signCount = authData.readUInt32BE(33);
      const verdict = passkeyVerdict(
        {
          type: String(client.type),
          challenge: String(client.challenge),
          origin: String(client.origin),
          rpIdHash: authData.subarray(0, 32).toString('hex'),
          flags: authData[32] ?? 0,
          signCount,
          signature: signatureHolds(record, assertion) ? 'valid' : 'invalid',
        },
        {
          challenge: expected.challenge,
          origin: expected.origin,
          rpIdHash: createHash('sha256').update(expected.rpId).digest('hex'),
          storedSignCount: record.signCount,
        },
      );
      if (!verdict.ok) return answered<PasskeyOutcome>({ kind: 'refused', check: verdict.check });
      if (signCount > record.signCount) {
        const wrote = await write({ ...record, signCount });
        if (!wrote.ok) return failed();
      }
      return answered<PasskeyOutcome>({ kind: 'verified', credentialId: record.credentialId });
    },
  };
};
