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
 * MIRRORS `reader-lock-file.ts`'S GENERATION DISCIPLINE: `elect` only ever
 * publishes a generation past the one it read, and a stale or absent holder
 * is reclaimed by publishing past it rather than by removing it — there is
 * nothing to unlink in memory either, and keeping that shape here is what
 * makes this fixture a faithful stand-in rather than a simpler reimplementation
 * that could drift from what the file adapter actually does.
 *
 * @param options - canned answers, for a test.
 * @returns a `ReaderLock` backed by a plain object.
 */
export const readerLockFixture = (options: ReaderLockFixtureOptions = {}): ReaderLock => {
  const alive = options.isAlive ?? (() => null);
  const locks = new Map<string, { generation: number; claim: ReaderClaim }>();
  const readerStates = new Map<string, ReaderState>();
  const heartbeatsByKey = new Map<string, Map<string, number>>();

  return {
    holder: async (key: string): Promise<PortResult<ReaderClaim | null>> => {
      if (options.broken === true) return failed<ReaderClaim | null>();
      const held = locks.get(key);
      return answered(held === undefined ? null : held.claim);
    },

    elect: async (key: string, claim: ReaderClaim): Promise<PortResult<'elected' | 'held'>> => {
      if (options.broken === true) return failed<'elected' | 'held'>();
      const held = locks.get(key);
      if (held !== undefined && held.claim.pid !== claim.pid) {
        if (!readerIsStale(held.claim, alive(held.claim.pid), null, claim.at)) {
          return answered<'elected' | 'held'>('held');
        }
      }
      const generation = (held?.generation ?? 0) + 1;
      locks.set(key, { generation, claim: { ...claim, generation } });
      return answered<'elected' | 'held'>('elected');
    },

    release: async (key: string, pid: number): Promise<PortResult<void>> => {
      if (options.broken === true) return failed<void>();
      const held = locks.get(key);
      if (held !== undefined && held.claim.pid === pid) locks.delete(key);
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
