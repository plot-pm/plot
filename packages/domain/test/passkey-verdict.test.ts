import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { passkeyFile } from '../src/adapters/passkey/passkey-file.js';
import type { PasskeyRecord } from '../src/entities/passkey.js';
import { FLAG_UP, FLAG_UV, passkeyVerdict } from '../src/rules/passkey-verdict.js';

const ORIGIN = 'http://localhost:4455';
const RP_ID = 'localhost';
const CHALLENGE = Buffer.from('a-challenge-of-some-length').toString('base64url');

const keyPair = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
const spki = (key: KeyObject): string => key.export({ type: 'spki', format: 'der' }).toString('base64url');

interface Build {
  privateKey: KeyObject;
  type?: string;
  challenge?: string;
  origin?: string;
  rpId?: string;
  flags?: number;
  signCount?: number;
}

/** A signed assertion over `authenticatorData ‖ sha256(clientDataJSON)`, as the browser would send it. */
const assertion = (b: Build) => {
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: b.type ?? 'webauthn.get',
    challenge: b.challenge ?? CHALLENGE,
    origin: b.origin ?? ORIGIN,
  }));
  const authData = Buffer.alloc(37);
  createHash('sha256').update(b.rpId ?? RP_ID).digest().copy(authData, 0);
  authData[32] = b.flags ?? FLAG_UP | FLAG_UV;
  authData.writeUInt32BE(b.signCount ?? 1, 33);
  const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]), b.privateKey);
  return {
    credentialId: 'cred-1',
    authenticatorData: authData.toString('base64url'),
    clientDataJSON: clientDataJSON.toString('base64url'),
    signature: signature.toString('base64url'),
  };
};

describe('passkeyVerdict over the adapter', () => {
  let root: string;
  let pair: ReturnType<typeof keyPair>;
  const expected = { challenge: CHALLENGE, origin: ORIGIN, rpId: RP_ID };

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'passkey-verdict-'));
    pair = keyPair();
    const record: PasskeyRecord = { v: 1, credentialId: 'cred-1', publicKey: spki(pair.publicKey), signCount: 0, registeredAt: '2026-11-06T00:00:00Z' };
    await passkeyFile(root).register(record);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const check = async (b: Partial<Build>, over: Partial<ReturnType<typeof assertion>> = {}) => {
    const out = await passkeyFile(root).verify({ ...assertion({ privateKey: pair.privateKey, ...b }), ...over }, expected);
    if (!out.ok) throw new Error('port failed');
    return out.value;
  };

  it('verifies a user-verified assertion and stores the new sign count', async () => {
    expect(await check({})).toEqual({ kind: 'verified', credentialId: 'cred-1' });
    const held = await passkeyFile(root).read();
    expect(held.ok && held.value?.signCount).toBe(1);
  });

  it.each([
    ['a changed type', { type: 'webauthn.create' }, 'type'],
    ['a changed challenge', { challenge: 'other' }, 'challenge'],
    ['a changed origin', { origin: 'http://127.0.0.1:4455' }, 'origin'],
    ['a changed RP id hash', { rpId: 'example.com' }, 'rp-id-hash'],
    ['a cleared UP flag', { flags: FLAG_UV }, 'user-present'],
    ['a cleared UV flag', { flags: FLAG_UP }, 'user-verified'],
  ] as const)('refuses %s by naming the check', async (_name, build, named) => {
    expect(await check(build)).toEqual({ kind: 'refused', check: named });
  });

  it('refuses a sign count that did not move', async () => {
    expect(await check({ signCount: 5 })).toMatchObject({ kind: 'verified' });
    expect(await check({ signCount: 5 })).toEqual({ kind: 'refused', check: 'sign-count' });
    expect(await check({ signCount: 4 })).toEqual({ kind: 'refused', check: 'sign-count' });
  });

  it('accepts a counter that stays zero where the stored one is zero', async () => {
    expect(await check({ signCount: 0 })).toMatchObject({ kind: 'verified' });
  });

  it('refuses an assertion signed by a different key', async () => {
    const other = keyPair();
    const out = await passkeyFile(root).verify(assertion({ privateKey: other.privateKey }), expected);
    expect(out).toEqual({ ok: true, value: { kind: 'refused', check: 'signature' } });
  });

  it('refuses another credential id', async () => {
    expect(await check({}, { credentialId: 'cred-2' })).toEqual({ kind: 'refused', check: 'credential' });
  });

  it('refuses a malformed authenticator data', async () => {
    expect(await check({}, { authenticatorData: 'AAAA' })).toEqual({ kind: 'refused', check: 'malformed' });
  });

  it('reads an absent store as unregistered, never a pass', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'passkey-empty-'));
    try {
      const out = await passkeyFile(empty).verify(assertion({ privateKey: pair.privateKey }), expected);
      expect(out).toEqual({ ok: true, value: { kind: 'unregistered' } });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('keeps the first registration: a second register changes nothing', async () => {
    const other: PasskeyRecord = { v: 1, credentialId: 'cred-2', publicKey: spki(keyPair().publicKey), signCount: 0, registeredAt: 'later' };
    expect(await passkeyFile(root).register(other)).toEqual({ ok: true, value: 'exists' });
    const held = await passkeyFile(root).read();
    expect(held.ok && held.value?.credentialId).toBe('cred-1');
  });
});

describe('passkeyVerdict', () => {
  const readings = { type: 'webauthn.get', challenge: 'c', origin: 'o', rpIdHash: 'h', flags: FLAG_UP | FLAG_UV, signCount: 2, signature: 'valid' } as const;
  const want = { challenge: 'c', origin: 'o', rpIdHash: 'h', storedSignCount: 1 };

  it('passes a clean reading', () => {
    expect(passkeyVerdict(readings, want)).toEqual({ ok: true });
  });

  it('names the signature when only it fails', () => {
    expect(passkeyVerdict({ ...readings, signature: 'invalid' }, want)).toEqual({ ok: false, check: 'signature' });
  });
});
