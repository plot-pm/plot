import { answered, failed, type PortResult } from '../../port-result.js';
import { readerIsStale, type ReaderClaim } from '../../rules/reader-election.js';
import type { ReaderState } from '../../entities/reader-state.js';
import type { ReaderLock } from '../../ports/reader-lock.js';

/** The seams a test sets directly, in place of a filesystem. */
export interface ReaderLockFixtureOptions {
  /** Whether a pid is alive; defaults to answering `null` (unknown) for every pid. */
  isAlive?: (pid: number) => boolean | null;
  /** Makes every call answer `failed`, for a caller's failure-path test. */
  broken?: boolean;
}

/**
 * An in-memory `ReaderLock`, for a test that needs the port's behaviour
 * without a filesystem.
 *
 * MIRRORS `reader-lock-file.ts`'S GENERATION DISCIPLINE. A takeover publishes
 * the generation past the highest one; a renewal replaces the holder's own
 * generation; a release replaces it with a released claim, which `holder`
 * reads as no holder; an election prunes every generation below `n - 1`. No
 * generation number is ever published twice.
 *
 * @param options - canned answers, for a test.
 * @returns a `ReaderLock` backed by a plain object.
 */
export const readerLockFixture = (options: ReaderLockFixtureOptions = {}): ReaderLock => {
  const alive = options.isAlive ?? (() => null);
  const locks = new Map<string, Map<number, ReaderClaim>>();
  const highestOf = (key: string): { generation: number; claim: ReaderClaim } | null => {
    const generations = locks.get(key);
    if (generations === undefined || generations.size === 0) return null;
    const generation = Math.max(...generations.keys());
    const claim = generations.get(generation);
    return claim === undefined ? null : { generation, claim };
  };
  const put = (key: string, generation: number, claim: ReaderClaim): void => {
    const generations = locks.get(key) ?? new Map<number, ReaderClaim>();
    generations.set(generation, { ...claim, generation });
    locks.set(key, generations);
  };
  const readerStates = new Map<string, ReaderState>();
  const heartbeatsByKey = new Map<string, Map<string, number>>();

  return {
    holder: async (key: string): Promise<PortResult<ReaderClaim | null>> => {
      if (options.broken === true) return failed<ReaderClaim | null>();
      const held = highestOf(key);
      return answered(held === null || held.claim.released === true ? null : held.claim);
    },

    elect: async (key: string, claim: ReaderClaim): Promise<PortResult<'elected' | 'held'>> => {
      if (options.broken === true) return failed<'elected' | 'held'>();
      const held = highestOf(key);
      const fresh: ReaderClaim = { generation: 0, pid: claim.pid, startedAt: claim.startedAt, at: claim.at };
      if (held !== null && held.claim.pid === claim.pid && held.claim.released !== true) {
        put(key, held.generation, fresh);
        return answered<'elected' | 'held'>('elected');
      }
      if (held !== null && held.claim.pid !== claim.pid) {
        if (!readerIsStale(held.claim, alive(held.claim.pid), null, claim.at)) {
          return answered<'elected' | 'held'>('held');
        }
      }
      const generation = (held?.generation ?? 0) + 1;
      put(key, generation, fresh);
      const generations = locks.get(key);
      for (const old of Array.from(generations?.keys() ?? [])) {
        if (old < generation - 1) generations?.delete(old);
      }
      return answered<'elected' | 'held'>('elected');
    },

    release: async (key: string, pid: number): Promise<PortResult<void>> => {
      if (options.broken === true) return failed<void>();
      const held = highestOf(key);
      if (held !== null && held.claim.pid === pid && held.claim.released !== true) {
        put(key, held.generation, { ...held.claim, released: true });
      }
      return answered(undefined);
    },

    readerState: async (key: string): Promise<PortResult<ReaderState | null>> => {
      if (options.broken === true) return failed<ReaderState | null>();
      return answered(readerStates.get(key) ?? null);
    },

    writeReaderState: async (key: string, state: ReaderState): Promise<PortResult<void>> => {
      if (options.broken === true) return failed<void>();
      readerStates.set(key, state);
      return answered(undefined);
    },

    heartbeat: async (key: string, name: string, at: number): Promise<PortResult<void>> => {
      if (options.broken === true) return failed<void>();
      const beats = heartbeatsByKey.get(key) ?? new Map<string, number>();
      beats.set(name, at);
      heartbeatsByKey.set(key, beats);
      return answered(undefined);
    },

    heartbeats: async (key: string): Promise<PortResult<readonly { name: string; at: number }[]>> => {
      if (options.broken === true) return failed<readonly { name: string; at: number }[]>();
      const beats = heartbeatsByKey.get(key);
      if (beats === undefined) return answered<readonly { name: string; at: number }[]>([]);
      return answered<readonly { name: string; at: number }[]>(
        Array.from(beats, ([name, at]) => ({ name, at })),
      );
    },
  };
};
