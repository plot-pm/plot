import { describe, expect, it } from 'vitest';

import { notifierNone } from '../src/adapters/notifier/notifier-none.js';

describe('notifierNone', () => {
  it('answers unaskable, never a failure', async () => {
    expect(await notifierNone().notify('anything')).toEqual({ ok: false, why: 'unaskable' });
  });
});
