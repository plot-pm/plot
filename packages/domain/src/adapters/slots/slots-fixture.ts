import { answered, failed, type PortResult } from '../../port-result.js';
import { slotIsStale, type SlotClaim } from '../../rules/concurrency.js';
import type { HeldSlot, Slots } from '../../ports/slots.js';

/** What a fixture's slots start out holding. */
export interface SlotsFixture {
  /** The claims already held, by account and then by slot index. */
  held?: Readonly<Record<string, ReadonlyMap<number, SlotClaim>>>;
  /** This process's id; defaults to 1. */
  pid?: number;
  /** Reads the clock; defaults to a fixed moment. */
  now?: () => number;
  /** Whether a pid is alive; defaults to every pid being alive. */
  isAlive?: (pid: number) => boolean | null;
  /** Accounts whose claims cannot be read at all — the `failed` arm. */
  unreadable?: readonly string[];
}

/** The fixture's default moment, so a test that states no clock still has one. */
const FIXED_NOW = 1_756_700_000_000;

/**
 * A `Slots` held in memory, reaching no disk.
 *
 * THE ONE PROPERTY IT KEEPS FROM THE REAL ADAPTER IS EXCLUSIVITY. A fixture
 * that handed the same slot to two callers would let a test prove a cap that
 * the disk does not enforce, so `acquire` here takes the first index no LIVE
 * claim holds and reclaims the stale ones — the same rule `slotsFile` obtains
 * from `O_EXCL`, obtained here from a single-threaded map.
 *
 * WHAT IT DELIBERATELY DOES NOT REPRODUCE is the race: two `acquire` calls
 * cannot interleave in one JavaScript turn, so a fixture cannot demonstrate the
 * contention `wx` exists for. That is what `slots-file.test.ts` is for, and the
 * split is the one `budgetFixture` and `budgetFile` already draw.
 *
 * @param fixture - the claims to start with, and the process to claim as.
 * @returns a `Slots` backed by a map.
 */
export const slotsFixture = (fixture: SlotsFixture = {}): Slots => {
  const now = fixture.now ?? ((): number => FIXED_NOW);
  const alive = fixture.isAlive ?? ((): boolean => true);
  const pid = fixture.pid ?? 1;
  const unreadable = new Set(fixture.unreadable ?? []);
  const accounts = new Map<string, Map<number, SlotClaim>>();
  for (const [account, slots] of Object.entries(fixture.held ?? {})) {
    accounts.set(account, new Map(slots));
  }

  const slotsFor = (account: string): Map<number, SlotClaim> => {
    const existing = accounts.get(account);
    if (existing !== undefined) return existing;
    const created = new Map<number, SlotClaim>();
    accounts.set(account, created);
    return created;
  };

  return {
    acquire: async (account: string, bound: number): Promise<PortResult<number | null>> => {
      if (unreadable.has(account)) return failed<number | null>();
      const slots = slotsFor(account);
      const wanted = Math.max(1, Math.trunc(bound));
      for (let index = 0; index < wanted; index += 1) {
        const held = slots.get(index);
        if (held !== undefined && !slotIsStale(held, alive(held.pid), null, now())) continue;
        slots.set(index, { pid, startedAt: null, at: now() });
        return answered<number | null>(index);
      }
      return answered<number | null>(null);
    },

    release: async (account: string, index: number): Promise<PortResult<void>> => {
      if (unreadable.has(account)) return failed<void>();
      const slots = slotsFor(account);
      const held = slots.get(Math.trunc(index));
      // ONLY THIS PROCESS'S OWN CLAIM, the rule `slotsFile` states: a slot
      // reclaimed while its owner still ran belongs to somebody else now.
      if (held !== undefined && held.pid !== pid) return answered(undefined);
      slots.delete(Math.trunc(index));
      return answered(undefined);
    },

    held: async (account: string): Promise<PortResult<readonly HeldSlot[]>> => {
      if (unreadable.has(account)) return failed<readonly HeldSlot[]>();
      const slots = slotsFor(account);
      return answered<readonly HeldSlot[]>(
        [...slots.entries()]
          .map(([index, claim]) => ({ index, claim }))
          .sort((left, right) => left.index - right.index),
      );
    },
  };
};
