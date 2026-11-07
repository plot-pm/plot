import { describe, expect, it } from 'vitest';

import { passkeySettings } from '../src/rules/passkey-settings.js';

describe('passkeySettings', () => {
  it('shows a pending line and no marker while the read is unanswered', () => {
    const s = passkeySettings(null, 'localhost');
    expect(s.line).toBe('Reading the registered passkey…');
    expect(s.marker).toBe(false);
    expect(s.action).toBeNull();
    expect(s.notice).toBeNull();
  });

  it('marks the gear and offers Register when no passkey is registered', () => {
    const s = passkeySettings({ registered: false }, 'localhost');
    expect(s).toMatchObject({ line: 'No passkey registered', action: 'Register', marker: true, credential: null, notice: null });
  });

  it('offers Replace with a shortened id and the local date when a passkey is registered', () => {
    const at = '2026-11-07T10:30:00.000Z';
    const s = passkeySettings({ registered: true, credentialId: 'abcdefghijklmnopqrstuvwxyz', registeredAt: at }, 'localhost');
    expect(s.line).toBe(`Passkey registered on ${new Date(at).toLocaleString()}`);
    expect(s.action).toBe('Replace');
    expect(s.credential).toBe('abcdefghijkl…');
    expect(s.marker).toBe(false);
  });

  it('keeps a short credential id whole', () => {
    expect(passkeySettings({ registered: true, credentialId: 'abc', registeredAt: '2026-11-07T10:30:00Z' }, 'localhost').credential).toBe('abc');
  });

  it('shows a registered date that does not parse as given', () => {
    expect(passkeySettings({ registered: true, credentialId: 'abc', registeredAt: 'yesterday' }, 'localhost').line).toBe('Passkey registered on yesterday');
  });

  it.each([null, { registered: false }, { registered: true, credentialId: 'abc', registeredAt: '2026-11-07T10:30:00Z' }])(
    'answers the notice and no action or marker off localhost for %j',
    (held) => {
      const s = passkeySettings(held, '192.168.1.5');
      expect(s.notice).toContain('192.168.1.5');
      expect(s.action).toBeNull();
      expect(s.marker).toBe(false);
    },
  );
});
