import { describe, expect, it } from 'vitest';
import { b64url, fromB64url, originNotice, refusalWording } from '../../src/app/lib/passkey.js';

describe('the passkey page helpers', () => {
  it('shows no notice on localhost and names the host elsewhere', () => {
    expect(originNotice('localhost')).toBeNull();
    expect(originNotice('127.0.0.1')).toContain('127.0.0.1');
  });

  it.each(['person-unproven', 'passkey-unregistered', 'passkey-refused', 'challenge-expired'])('words the refusal %s', (reason) => {
    expect(refusalWording(reason)).toMatch(/^Not approved/);
  });

  it('appends the failed check', () => {
    expect(refusalWording('passkey-refused', 'check: user-verified')).toContain('check: user-verified');
  });

  it('round-trips base64url', () => {
    const bytes = Uint8Array.from([251, 255, 0, 62, 63]);
    expect([...fromB64url(b64url(bytes.buffer))]).toEqual([...bytes]);
  });
});
