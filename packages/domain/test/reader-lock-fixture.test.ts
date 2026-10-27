import { describe, expect, it } from 'vitest';

import { readerLockFixture } from '../src/adapters/reader-lock/reader-lock-fixture.js';
import { isAnswered, type PortResult } from '../src/port-result.js';
import { READER_STALE_MS, type ReaderClaim } from '../src/rules/reader-election.js';

const answer = <T>(result: PortResult<T>): T => {
  expect(isAnswered(result)).toBe(true);
  if (!isAnswered(result)) throw new Error('unreachable: asserted above');
  return result.value;
};

const claim = (pid: number, at: number): Omit<ReaderClaim, 'generation'> => ({
  pid,
  startedAt: at,
  at,
});

describe('readerLockFixture', () => {
  it('elects where no holder exists', async () => {
    const lock = readerLockFixture();
    expect(answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }))).toBe('elected');
    const held = answer(await lock.holder('github'));
    expect(held?.pid).toBe(11);
    expect(held?.generation).toBe(1);
  });

  it('reports held where a live other pid holds it', async () => {
    const lock = readerLockFixture({ isAlive: () => true });
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    const result = await lock.elect('github', { generation: 0, ...claim(22, 1_756_700_000_000) });
    expect(answer(result)).toBe('held');
  });

  it('elects over a holder read as dead', async () => {
    const lock = readerLockFixture({ isAlive: () => false });
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    const result = await lock.elect('github', { generation: 0, ...claim(22, 1_756_700_000_000) });
    expect(answer(result)).toBe('elected');
    const held = answer(await lock.holder('github'));
    expect(held?.pid).toBe(22);
    expect(held?.generation).toBe(2);
  });

  it('defaults to unknown liveness, which keeps the claim however old it reads', async () => {
    const lock = readerLockFixture();
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    const result = await lock.elect('github', {
      generation: 0,
      ...claim(22, 1_756_700_000_000 + READER_STALE_MS),
    });
    expect(answer(result)).toBe('held');
  });

  it('ages out once liveness is known, the age-only bound readerIsStale applies', async () => {
    const lock = readerLockFixture({ isAlive: () => true });
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    const result = await lock.elect('github', {
      generation: 0,
      ...claim(22, 1_756_700_000_000 + READER_STALE_MS),
    });
    expect(answer(result)).toBe('elected');
  });

  it('a superseded holder releasing after a takeover leaves the new holder untouched', async () => {
    const lock = readerLockFixture({ isAlive: () => false });
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    answer(await lock.elect('github', { generation: 0, ...claim(22, 1_756_700_000_050) }));
    answer(await lock.release('github', 11));
    const held = answer(await lock.holder('github'));
    expect(held?.pid).toBe(22);
  });

  it('releases idempotently, and a missing lock is success', async () => {
    const lock = readerLockFixture();
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    answer(await lock.release('github', 11));
    answer(await lock.release('github', 11));
    expect(answer(await lock.holder('github'))).toBeNull();
  });

  it('renews onto its own generation', async () => {
    const lock = readerLockFixture();
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_060_000) }));
    const held = answer(await lock.holder('github'));
    expect(held?.generation).toBe(1);
    expect(held?.at).toBe(1_756_700_060_000);
  });

  it('a release after renewals leaves no live claim, and the next election takes the next generation', async () => {
    const lock = readerLockFixture({ isAlive: () => true });
    for (let beat = 0; beat < 3; beat += 1) {
      answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000 + beat * 60_000) }));
    }
    answer(await lock.release('github', 11));
    answer(await lock.release('github', 11));
    expect(answer(await lock.holder('github'))).toBeNull();
    expect(answer(await lock.elect('github', { generation: 0, ...claim(22, 1_756_700_200_000) }))).toBe('elected');
    expect(answer(await lock.holder('github'))?.generation).toBe(2);
  });

  it('keeps one connector from colliding with another', async () => {
    const lock = readerLockFixture();
    answer(await lock.elect('github', { generation: 0, ...claim(11, 1_756_700_000_000) }));
    expect(answer(await lock.holder('bitbucket'))).toBeNull();
  });

  it('round-trips the reader state', async () => {
    const lock = readerLockFixture();
    expect(answer(await lock.readerState('github'))).toBeNull();
    const state = {
      v: 1 as const,
      prError: 'rate limited',
      prNextAt: 1_756_700_000_000,
      prNextIsBackoff: true,
      prFullReadFailedAt: null,
      at: 1_756_700_000_000,
    };
    answer(await lock.writeReaderState('github', state));
    expect(answer(await lock.readerState('github'))).toEqual(state);
  });

  it('round-trips heartbeats by name, scoped per connector', async () => {
    const lock = readerLockFixture();
    answer(await lock.heartbeat('github', 'fleetd', 1_756_700_000_000));
    answer(await lock.heartbeat('bitbucket', 'fleetd', 1_756_700_000_500));
    expect(answer(await lock.heartbeats('github'))).toEqual([{ name: 'fleetd', at: 1_756_700_000_000 }]);
    expect(answer(await lock.heartbeats('bitbucket'))).toEqual([{ name: 'fleetd', at: 1_756_700_000_500 }]);
  });

  it('removes one heartbeat by name and keeps the others', async () => {
    const lock = readerLockFixture();
    answer(await lock.heartbeat('github', 'reader.11', 1_756_700_000_000));
    answer(await lock.heartbeat('github', 'fleetd', 1_756_700_000_500));
    answer(await lock.removeHeartbeat('github', 'reader.11'));
    expect(answer(await lock.heartbeats('github'))).toEqual([{ name: 'fleetd', at: 1_756_700_000_500 }]);
  });

  it('reads no heartbeats where none were written, rather than failed', async () => {
    const lock = readerLockFixture();
    expect(answer(await lock.heartbeats('github'))).toEqual([]);
  });

  it('answers failed on every method where broken', async () => {
    const lock = readerLockFixture({ broken: true });
    expect(isAnswered(await lock.holder('github'))).toBe(false);
    expect(isAnswered(await lock.elect('github', { generation: 0, ...claim(11, 1) }))).toBe(false);
    expect(isAnswered(await lock.release('github', 11))).toBe(false);
    expect(isAnswered(await lock.readerState('github'))).toBe(false);
    expect(
      isAnswered(
        await lock.writeReaderState('github', {
          v: 1,
          prError: null,
          prNextAt: 1,
          prNextIsBackoff: false,
          prFullReadFailedAt: null,
          at: 1,
        }),
      ),
    ).toBe(false);
    expect(isAnswered(await lock.heartbeat('github', 'fleetd', 1))).toBe(false);
    expect(isAnswered(await lock.heartbeats('github'))).toBe(false);
    expect(isAnswered(await lock.removeHeartbeat('github', 'fleetd'))).toBe(false);
  });
});
