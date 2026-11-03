import { describe, expect, it } from 'vitest';

import { mergeIdentity, type MergerAppReading } from '../src/rules/merge-identity.js';

describe('mergeIdentity', () => {
  it('answers app for a usable key on GitHub', () => {
    expect(mergeIdentity('github', { read: 'usable' })).toEqual({ identity: 'app' });
  });

  it('holds merger-app-missing for an absent key on GitHub', () => {
    expect(mergeIdentity('github', { read: 'absent' })).toEqual({ identity: 'hold', reason: 'merger-app-missing' });
  });

  it('holds merger-app-invalid for an invalid key on GitHub', () => {
    expect(mergeIdentity('github', { read: 'invalid', reason: 'malformed' })).toEqual({
      identity: 'hold',
      reason: 'merger-app-invalid',
    });
  });

  it('holds merger-app-unread for an unread key, or no reading at all, on GitHub', () => {
    expect(mergeIdentity('github', { read: 'unread' })).toEqual({ identity: 'hold', reason: 'merger-app-unread' });
    expect(mergeIdentity('github', undefined)).toEqual({ identity: 'hold', reason: 'merger-app-unread' });
  });

  it('answers host for any other backend, with every reading unconsulted', () => {
    const readings: readonly (MergerAppReading | undefined)[] = [
      { read: 'usable' },
      { read: 'absent' },
      { read: 'invalid', reason: 'malformed' },
      { read: 'unread' },
      undefined,
    ];
    for (const reading of readings) {
      expect(mergeIdentity('bitbucket', reading)).toEqual({ identity: 'host' });
    }
  });
});
