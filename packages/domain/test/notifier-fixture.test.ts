import { describe, expect, it } from 'vitest';

import { notifierFixture } from '../src/adapters/notifier/notifier-fixture.js';

describe('notifierFixture', () => {
  it('answers ok and records the message by default', async () => {
    const sent: string[] = [];
    const notifier = notifierFixture({ sent });
    expect(await notifier.notify('hi')).toEqual({ ok: true });
    expect(sent).toEqual(['hi']);
  });

  it('answers unaskable when unconfigured, and still records nothing', async () => {
    const sent: string[] = [];
    const notifier = notifierFixture({ sent, unconfigured: true });
    expect(await notifier.notify('hi')).toEqual({ ok: false, why: 'unaskable' });
    expect(sent).toEqual([]);
  });

  it('records the attempt even when it fails', async () => {
    const sent: string[] = [];
    const notifier = notifierFixture({ sent, failCode: 7 });
    expect(await notifier.notify('hi')).toEqual({ ok: false, why: 'failed', code: 7 });
    expect(sent).toEqual(['hi']);
  });
});
