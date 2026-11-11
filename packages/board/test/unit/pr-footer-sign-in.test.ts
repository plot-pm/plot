import { describe, expect, it } from 'vitest';

import { refusalKind } from '@plot-pm/domain';

import { prStatusEntry } from '../../src/app/lib/agent-rows/host-notes.js';
import type { Fleet } from '../../src/contract/schema.js';

/** A refused credential reads "sign in" with the connector's fix, never as an outage. */
describe('a refused credential on the PR footer', () => {
  const at = (over: Partial<Fleet>): Fleet => ({ prError: null, prNextInSeconds: null, prAgeSeconds: null, ...over } as Fleet);
  const FIX = 'GitHub refused the token from gh auth token (401 Bad credentials); run gh auth login';

  it('RefusalKind answers auth for a 401', () => {
    expect(refusalKind(FIX)).toBe('auth');
  });

  it('says sign in and names the fix, with no data and with data on screen', () => {
    for (const prAgeSeconds of [null, 30]) {
      const entry = prStatusEntry(at({ prError: FIX, prAgeSeconds }));
      expect(entry?.text).toContain('sign in');
      expect(entry?.text).toContain(FIX);
      expect(entry?.text).not.toContain('host unreachable');
      expect(entry?.tone).toBe('rose');
    }
  });
});
