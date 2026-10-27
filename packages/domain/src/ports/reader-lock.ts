import type { PortResult } from '../port-result.js';
import type { ReaderClaim } from '../rules/reader-election.js';
import type { ReaderState } from '../entities/reader-state.js';

/**
 * Elects one process per repository's PR index file as the machine's PR
 * reader — the lock behind `electReader` — and carries the elected reader's
 * last-known cadence and failure state for a following process to render.
 *
 * A PORT, NOT A FIELD ON `Host`. `Host` is a connector: it has an account, a
 * token, a rate limit and a transport choice, and every operation spends a
 * remote budget. This reaches no remote service — it reads and writes files
 * local to the machine, keyed by the same `(realpath(common git dir),
 * connector)` the PR index file itself is keyed by.
 *
 * NOTHING HERE DECIDES WHO WINS. The port reads and writes; `electReader` says
 * what the read means.
 *
 * ELECTION, NOT A WAIT. `elect` answers immediately: a caller told `held`
 * reads the cache and returns rather than blocking for the lock to free.
 */
export interface ReaderLock {
  /**
   * Reads the current holder's claim, without electing.
   *
   * @param key - the lock's key: a connector's name, scoped to one repository
   *   by the adapter that resolves it.
   * @returns the highest-generation claim, `null` where the lock names no
   *   holder or its highest claim is released, or `failed` where it could not
   *   be read at all.
   */
  holder(key: string): Promise<PortResult<ReaderClaim | null>>;

  /**
   * Takes the lock for this process, or confirms this process already holds
   * it.
   *
   * RENEWS ON EVERY CALL A HOLDER MAKES. A reader that elected once and never
   * renewed would go stale under `READER_STALE_MS` while still refreshing.
   * A renewal replaces the holder's own claim under the same generation; a
   * takeover publishes the next generation.
   *
   * @param key - the lock to take.
   * @param claim - this process's claim, stamped by the caller; its
   *   `generation` is advisory — the adapter publishes the next one after
   *   whatever it currently reads as the holder.
   * @returns `'elected'` where this process now holds the lock (new or
   *   renewed), `'held'` where a live other process holds it, and `failed`
   *   where the lock could not be written at all.
   */
  elect(key: string, claim: ReaderClaim): Promise<PortResult<'elected' | 'held'>>;

  /**
   * Gives the lock back.
   *
   * IDEMPOTENT. Only a claim naming this pid as the still-current generation
   * is released — a lock already taken over by a new generation while this
   * process still ran is left untouched, for its new holder. A release
   * replaces the claim with a released one under the same generation and
   * removes no generation, so a generation number is never reused.
   *
   * @param key - the lock to release.
   * @param pid - this process's id, checked against the held claim before
   *   releasing it.
   * @returns nothing on success.
   */
  release(key: string, pid: number): Promise<PortResult<void>>;

  /**
   * Reads the elected reader's last published cadence and failure state.
   *
   * @param key - the lock's key.
   * @returns the state, `null` where none has been published, or `failed`.
   */
  readerState(key: string): Promise<PortResult<ReaderState | null>>;

  /**
   * Publishes the elected reader's cadence and failure state, for a following
   * process to render without asking the host.
   *
   * @param key - the lock's key.
   * @param state - the state to publish, replacing whatever was there.
   * @returns nothing on success; `failed` where the write did not land.
   */
  writeReaderState(key: string, state: ReaderState): Promise<PortResult<void>>;

  /**
   * Writes this holder's (or a following board's/fleetd's) presence file —
   * the heartbeat primitive. A later caller reads whether a heartbeat younger
   * than its own bound exists, to decide whether anyone still follows this
   * lock; this port only publishes and reads the file, and decides nothing.
   *
   * @param key - the lock's key.
   * @param name - the heartbeat's own name, `board.<pid>`, `reader.<pid>` or `fleetd` —
   *   distinct names so more than one follower may heartbeat at once.
   * @param at - epoch milliseconds to stamp the heartbeat with.
   * @returns nothing on success; `failed` where the write did not land.
   */
  heartbeat(key: string, name: string, at: number): Promise<PortResult<void>>;

  /**
   * Removes one heartbeat, for a process that stops following or reading the
   * lock. A heartbeat already absent is a success.
   *
   * @param key - the lock's key.
   * @param name - the heartbeat's own name, as {@link heartbeat} wrote it.
   * @returns nothing on success; `failed` where the file exists and could not
   *   be removed.
   */
  removeHeartbeat(key: string, name: string): Promise<PortResult<void>>;

  /**
   * Reads every heartbeat currently published under the lock.
   *
   * @param key - the lock's key.
   * @returns each heartbeat's name and when it was last stamped; `failed`
   *   where the lock's directory could not be read at all.
   */
  heartbeats(key: string): Promise<PortResult<readonly { name: string; at: number }[]>>;
}
