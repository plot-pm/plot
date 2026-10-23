import { answered, failed, type PortResult } from '../../port-result.js';
import { readerIsStale, type ReaderClaim } from '../../rules/reader-election.js';
import type { ReaderLock } from '../../ports/reader-lock.js';

/** What a fixture's lock starts out holding. */
export interface ReaderLockFixture {
  /** The claims already held, by key. */
  held?: Readonly<Record<string, ReaderClaim>>;
  /** Reads the clock; defaults to a fixed moment. */
  now?: () => number;
  /** Whether a pid is alive; defaults to every pid being alive. */
  isAlive?: (pid: number) => boolean | null;
  /** Keys whose lock cannot be read at all — the `failed` arm. */
  unreadable?: readonly string[];
}

/** The fixture's default moment, so a test that states no clock still has one. */
const FIXED_NOW = 1_756_700_000_000;

/**
 * A `ReaderLock` held in memory, reaching no disk.
 *
 * Same split as {@link "../slots/slots-fixture.js".slotsFixture}: this keeps
 * the one property a test needs — a key has at most one live holder — and
 * does not reproduce the cross-process race, which is `reader-lock-file.test.ts`'s
 * job.
 *
 * @param fixture - the claims to start with, and the process to claim as.
 * @returns a `ReaderLock` backed by a map.
 */
export const readerLockFixture = (fixture: ReaderLockFixture = {}): ReaderLock => {
  const now = fixture.now ?? ((): number => FIXED_NOW);
  const alive = fixture.isAlive ?? ((): boolean => true);
  const unreadable = new Set(fixture.unreadable ?? []);
  const locks = new Map<string, ReaderClaim>(Object.entries(fixture.held ?? {}));

  return {
    holder: async (key: string): Promise<PortResult<ReaderClaim | null>> => {
      if (unreadable.has(key)) return failed<ReaderClaim | null>();
      return answered<ReaderClaim | null>(locks.get(key) ?? null);
    },

    elect: async (key: string, claim: ReaderClaim): Promise<PortResult<'elected' | 'held'>> => {
      if (unreadable.has(key)) return failed<'elected' | 'held'>();
      const held = locks.get(key) ?? null;
      // RENEWAL IS THIS CLAIM'S OWN PID MATCHING THE HOLDER'S, not the
      // fixture's constructor-configured pid — a fixture has no fixed "self"
      // the way a real process does, since one instance may elect on behalf
      // of several claims across a test.
      if (
        held === null ||
        held.pid === claim.pid ||
        readerIsStale(held, alive(held.pid), null, now())
      ) {
        locks.set(key, claim);
        return answered('elected');
      }
      return answered('held');
    },

    release: async (key: string, releasingPid: number): Promise<PortResult<void>> => {
      if (unreadable.has(key)) return failed<void>();
      const held = locks.get(key);
      if (held !== undefined && held.pid !== releasingPid) return answered(undefined);
      locks.delete(key);
      return answered(undefined);
    },
  };
};
