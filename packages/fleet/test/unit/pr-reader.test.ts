import { describe, expect, it } from 'vitest';

import { HEARTBEAT_STALE_MS } from '@plot-pm/domain/rules/reader-election';
import { readerLockFixture } from '@plot-pm/domain/adapters';

import { stillFollowed } from '../../src/server/entry/pr-reader.js';

/** A liveness reader that always answers "alive" for the pids given. */
const allAlive = async (pids: readonly number[]) =>
  new Map(pids.map((pid) => [pid, { alive: true, startedAt: null }]));

/** A liveness reader that always answers "dead" for the pids given. */
const allDead = async (pids: readonly number[]) =>
  new Map(pids.map((pid) => [pid, { alive: false, startedAt: null }]));

describe('stillFollowed — the reader checks heartbeat counts, never a starting pid', () => {
  it('reads followers from a live board heartbeat whose own pid never named this reader at start', async () => {
    // The acceptance clause: "survives the exit of the board that started it".
    // The board that started this reader is long gone — its pid appears
    // nowhere in this call — and a second board's heartbeat is what keeps
    // the reader alive. Nothing here is keyed to a starting pid at all.
    const now = Date.now();
    const otherBoardPid = 999_999;
    const heartbeats = [{ name: `board.${otherBoardPid}`, at: now }];
    expect(await stillFollowed(heartbeats, now, allAlive)).toBe('followers');
  });

  it('reads none once every board heartbeat is both stale and the process dead, regardless of which board started the reader', async () => {
    const now = Date.now();
    const startingBoardPid = 111_111;
    // Deliberately a heartbeat under a DIFFERENT pid than the board that
    // started this reader — proving the exit check counts live heartbeats,
    // not whether the starting board's own pid is still running.
    const heartbeats = [{ name: `board.${startingBoardPid + 1}`, at: now - HEARTBEAT_STALE_MS - 1 }];
    expect(await stillFollowed(heartbeats, now, allDead)).toBe('none');
  });

  it('reads none with zero heartbeats published, independent of any pid', async () => {
    const now = Date.now();
    expect(await stillFollowed([], now, allAlive)).toBe('none');
  });

  it('stays followed exactly up to HEARTBEAT_STALE_MS and reads none one millisecond past it — the 2-minute bound named by the constant, not a hardcoded guess', async () => {
    const now = Date.now();
    const boardPid = 222_222;
    const justFresh = [{ name: `board.${boardPid}`, at: now - (HEARTBEAT_STALE_MS - 1) }];
    expect(await stillFollowed(justFresh, now, allAlive)).toBe('followers');

    const justStale = [{ name: `board.${boardPid}`, at: now - HEARTBEAT_STALE_MS }];
    expect(await stillFollowed(justStale, now, allAlive)).toBe('none');
  });
});

describe('stillFollowed — a fleetd-named heartbeat this reader just wrote is not evidence of a second process', () => {
  it('does not mistake its own just-written fleetd heartbeat for a live external fleetd', async () => {
    // fleetPrs — shared with the real daemon — stamps every successful
    // pass's heartbeat under the literal name "fleetd", whichever process
    // ran it. Without selfAt, this reader would read its own pass as "a live
    // fleetd" and could never see "none".
    const now = Date.now();
    const selfAt = now - 10;
    const heartbeats = [{ name: 'fleetd', at: selfAt }];
    expect(await stillFollowed(heartbeats, now, allDead, selfAt)).toBe('none');
  });

  it('still reads fleetd where the fresh fleetd heartbeat carries a different timestamp than this process last stamped', async () => {
    const now = Date.now();
    const selfAt = now - 50_000;
    const externalAt = now - 1_000;
    const heartbeats = [{ name: 'fleetd', at: externalAt }];
    expect(await stillFollowed(heartbeats, now, allDead, selfAt)).toBe('fleetd');
  });

  it('reads fleetd where selfAt is null — no self-write has happened yet, so every fleetd heartbeat is external', async () => {
    const now = Date.now();
    const heartbeats = [{ name: 'fleetd', at: now - 1_000 }];
    expect(await stillFollowed(heartbeats, now, allDead, null)).toBe('fleetd');
  });

  it("a real fleetPrs pass against an in-memory lock produces exactly the self-written heartbeat shape stillFollowed must recognize as its own", async () => {
    // Proves the fix against the actual mechanism rather than a hand-built
    // fixture: fleetPrs (shared, unmodified) always writes under the name
    // "fleetd" on a successful pass, so a reader using the moment it handed
    // to that pass as selfAt reads its own pass as "none" rather than
    // "fleetd" once nothing else follows.
    const { fleetPrs } = await import('../../src/shared/fleet-clock.js');
    const { freshPrState } = await import('../../src/shared/pr-refresh.js');
    const lock = readerLockFixture();
    const now = Date.now();
    const world = {
      scripts: { hostSaid: async () => ({ answer: 'answered' as const, stdout: '' }) },
      host: { backend: async () => ({ ok: true as const, value: 'github' }) },
      store: {
        read: async () => ({ ok: true as const, value: null }),
        write: async () => ({ ok: true as const, value: undefined }),
        location: async () => ({ ok: true as const, value: '/dev/null' }),
      },
      now: () => now,
    } as unknown as import('../../src/shared/pr-refresh.js').PrWorld;
    const readPrs = fleetPrs(world, freshPrState(), { lock }, () => undefined);
    await readPrs();
    const beats = await lock.heartbeats('github');
    const fleetdBeat = beats.ok ? beats.value.find((b) => b.name === 'fleetd') : undefined;
    expect(fleetdBeat?.at).toBe(now);
    expect(await stillFollowed(beats.ok ? beats.value : [], now, allDead, now)).toBe('none');
    expect(await stillFollowed(beats.ok ? beats.value : [], now, allDead, null)).toBe('fleetd');
  });
});
