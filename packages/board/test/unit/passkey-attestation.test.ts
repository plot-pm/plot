import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeAttestationPublicKey, registrationKey } from '../../src/app/lib/passkey.js';

const head = (major: number, n: number): number[] => {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  return [(major << 5) | 25, n >> 8, n & 0xff];
};
const uint = (n: number): number[] => (n >= 0 ? head(0, n) : head(1, -1 - n));
const bstr = (b: Uint8Array | number[]): number[] => [...head(2, b.length), ...b];
const tstr = (s: string): number[] => [...head(3, s.length), ...Buffer.from(s)];
const map = (pairs: number[][]): number[] => [...head(5, pairs.length / 2), ...pairs.flat()];

const coseOf = (key: KeyObject, alg = -7): number[] => {
  const jwk = key.export({ format: 'jwk' });
  return map([
    uint(1), uint(2), uint(3), uint(alg), uint(-1), uint(1),
    uint(-2), bstr(Buffer.from(jwk.x!, 'base64url')),
    uint(-3), bstr(Buffer.from(jwk.y!, 'base64url')),
  ]);
};

const authDataOf = (cose: number[], opts: { flags?: number; idLength?: number; tail?: number[] } = {}): number[] => {
  const idLength = opts.idLength ?? 16;
  return [
    ...new Array(32).fill(7), opts.flags ?? 0x41, 0, 0, 0, 1,
    ...new Array(16).fill(0), idLength >> 8, idLength & 0xff, ...new Array(idLength).fill(9),
    ...cose, ...(opts.tail ?? []),
  ];
};

const attestationOf = (authData: number[]): ArrayBuffer => {
  const bytes = Uint8Array.from(map([tstr('fmt'), tstr('none'), tstr('attStmt'), map([]), tstr('authData'), bstr(authData)]));
  return bytes.buffer;
};

const fresh = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
const spkiOf = (key: KeyObject): Buffer => key.export({ type: 'spki', format: 'der' });

describe('decodeAttestationPublicKey', () => {
  it('equals the SPKI node exports for the same key', () => {
    for (let i = 0; i < 20; i++) {
      const { publicKey } = fresh();
      const out = decodeAttestationPublicKey(attestationOf(authDataOf(coseOf(publicKey))));
      expect(out.alg).toBe(-7);
      expect(out.spki.length).toBe(91);
      expect(Buffer.from(out.spki).equals(spkiOf(publicKey))).toBe(true);
    }
  });

  it('yields a key that verifies a signature the way the adapter reads it', () => {
    const { publicKey, privateKey } = fresh();
    const out = decodeAttestationPublicKey(attestationOf(authDataOf(coseOf(publicKey))));
    const message = Buffer.from('release 2.32.0');
    const signature = sign('sha256', message, privateKey);
    const key = createPublicKey({ key: Buffer.from(out.spki), format: 'der', type: 'spki' });
    expect(verify('sha256', message, key, signature)).toBe(true);
  });

  it('is not shifted by an extensions map after the key', () => {
    const { publicKey } = fresh();
    const tail = map([tstr('credProtect'), uint(2)]);
    const out = decodeAttestationPublicKey(attestationOf(authDataOf(coseOf(publicKey), { flags: 0xc1, tail })));
    expect(Buffer.from(out.spki).equals(spkiOf(publicKey))).toBe(true);
  });

  it.each([0, 255])('decodes a credential id of %i bytes', (idLength) => {
    const { publicKey } = fresh();
    const out = decodeAttestationPublicKey(attestationOf(authDataOf(coseOf(publicKey), { idLength })));
    expect(Buffer.from(out.spki).equals(spkiOf(publicKey))).toBe(true);
  });

  it('refuses a clear AT flag by name', () => {
    const { publicKey } = fresh();
    expect(() => decodeAttestationPublicKey(attestationOf(authDataOf(coseOf(publicKey), { flags: 0x01 })))).toThrow('AT flag not set');
  });

  it('refuses an object that is not a map by name', () => {
    expect(() => decodeAttestationPublicKey(Uint8Array.from(bstr([1, 2, 3])).buffer)).toThrow('attestationObject is not a CBOR map');
  });

  it('refuses an RSA key with the algorithm it found', () => {
    const { publicKey } = fresh();
    expect(() => decodeAttestationPublicKey(attestationOf(authDataOf(coseOf(publicKey, -257))))).toThrow('unsupported COSE algorithm -257');
  });

  it('refuses an indefinite-length item by name', () => {
    const bytes = Uint8Array.from([0xbf, 0xff]);
    expect(() => decodeAttestationPublicKey(bytes.buffer)).toThrow('indefinite-length CBOR item is not supported');
  });

  it('refuses a truncated buffer by name', () => {
    const { publicKey } = fresh();
    const whole = new Uint8Array(attestationOf(authDataOf(coseOf(publicKey))));
    expect(() => decodeAttestationPublicKey(whole.slice(0, 40).buffer)).toThrow('attestationObject is truncated');
  });
});

describe('registrationKey', () => {
  const { publicKey } = fresh();
  const attestationObject = attestationOf(authDataOf(coseOf(publicKey)));

  it('uses the browser key when getPublicKey returns one', () => {
    const browser = new Uint8Array([1, 2, 3]).buffer;
    const out = registrationKey({ attestationObject, getPublicKey: () => browser, getPublicKeyAlgorithm: () => -7 });
    expect(out.publicKey).toBe(browser);
    expect(out.alg).toBe(-7);
  });

  it('decodes the attestation object when getPublicKey returns null', () => {
    const out = registrationKey({ attestationObject, getPublicKey: () => null, getPublicKeyAlgorithm: () => -7 });
    expect(Buffer.from(out.publicKey).equals(spkiOf(publicKey))).toBe(true);
  });
});
