import { describe, expect, it } from 'vitest';

import { readerLockFixture } from '../src/adapters/index.js';
import { isAnswered, type PortResult } from '../src/port-result.js';

const answer = <T>(result: PortResult<T>): T => {
  expect(isAnswered(result)).toBe(true);
  if (!isAnswered(result)) throw new Error('unreachable: asserted above');
  return result.value;
};

describe('readerLockFixture', () => {
  it('elects the first caller and tells the second to follow', async () => {
    // A fixture holds its state in memory, so two callers sharing one lock
    // are two `elect` calls against the same instance — the property under
    // test is the pid comparison, not which object made the call.
    const lock = readerLockFixture();
    expect(
      answer(await lock.elect('k', { pid: 11, startedAt: null, at: 1_756_700_000_000 })),
    ).toBe('elected');
    expect(
      answer(await lock.elect('k', { pid: 12, startedAt: null, at: 1_756_700_000_001 })),
    ).toBe('held');
  });

  it('starts from a claim a test placed', async () => {
    const lock = readerLockFixture({
      held: { k: { pid: 99, startedAt: null, at: 1_756_700_000_000 } },
    });
    expect(answer(await lock.holder('k'))?.pid).toBe(99);
    expect(answer(await lock.elect('k', { pid: 11, startedAt: null, at: 1_756_700_000_001 }))).toBe(
      'held',
    );
  });

  it('reclaims a lock whose process is gone', async () => {
    const lock = readerLockFixture({
      isAlive: (pid) => pid !== 99,
      held: { k: { pid: 99, startedAt: null, at: 1_756_700_000_000 } },
    });
    expect(answer(await lock.elect('k', { pid: 11, startedAt: null, at: 1_756_700_000_001 }))).toBe(
      'elected',
    );
  });

  it('releases only this process own claim', async () => {
    const lock = readerLockFixture({
      held: { k: { pid: 99, startedAt: null, at: 1_756_700_000_000 } },
    });
    answer(await lock.release('k', 11));
    expect(answer(await lock.holder('k'))?.pid).toBe(99);
  });

  it('releases what it holds', async () => {
    const lock = readerLockFixture();
    await lock.elect('k', { pid: 11, startedAt: null, at: 1 });
    answer(await lock.release('k', 11));
    expect(answer(await lock.holder('k'))).toBeNull();
  });

  it('reports an unreadable key as failed on every operation', async () => {
    const lock = readerLockFixture({ unreadable: ['k'] });
    expect(isAnswered(await lock.holder('k'))).toBe(false);
    expect(isAnswered(await lock.elect('k', { pid: 11, startedAt: null, at: 1 }))).toBe(false);
    expect(isAnswered(await lock.release('k', 11))).toBe(false);
  });

  it('renews rather than refusing the holder that asks again', async () => {
    const lock = readerLockFixture();
    await lock.elect('k', { pid: 11, startedAt: null, at: 1 });
    expect(answer(await lock.elect('k', { pid: 11, startedAt: null, at: 2 }))).toBe('elected');
    expect(answer(await lock.holder('k'))?.at).toBe(2);
  });
});
