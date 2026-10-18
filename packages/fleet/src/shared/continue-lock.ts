import fs from 'node:fs';
import path from 'node:path';
import {
  continueLockHeld,
  decodeContinueHolder,
  encodeContinueHolder,
  type ContinueHolder,
  type ProcessProbe,
  type ProcessSighting,
} from '@plot-pm/domain';
import { processProbeSystem } from '@plot-pm/domain/adapters/process-probe/process-probe-system';

/**
 * Serialising `continueOnDesk`'s start sequence against itself, one lock per
 * desk — the race #1357 names: two callers racing `POST /api/continue` for
 * the same worktree can both pass the live-loop check before either has
 * spawned.
 *
 * Built in the same shape `implement-run.ts` settled for the implement lock —
 * {@link takeContinueLock}/`publishLock`/`takeGuard`/a `*Held` predicate
 * reading pid and start time — keyed here by worktree rather than by slug,
 * because a desk only ever has one worktree and nothing here needs the main
 * checkout to agree on a path.
 */

/**
 * How long a continue lock may hold its desk, in milliseconds: generous
 * enough to cover a slow spawn and pid-file write, short enough that a board
 * crash mid-continue does not strand the desk for long. `continueOnDesk`
 * itself holds the lock only across one `await`-chain inside one request, so
 * this is a ceiling on a hang, not an expected duration.
 */
export const CONTINUE_LOCK_BOUND_MS = 60_000;

/** How old a take's guard file must be before another take removes it, in milliseconds. */
const GUARD_STALE_MS = 10_000;

/** Where the continue lock for a desk is: beside the desk's own worker records. */
export const continueLockPath = (worktree: string): string => path.join(worktree, '.plot-worker.continue.lock');

/** The seams a test replaces in the continue lock. */
export interface ContinueLockDeps {
  /** The process table; {@link processProbeSystem} where absent. */
  probe?: ProcessProbe;
  /** The clock the lock's age is read against; `Date.now` where absent. */
  now?: () => number;
  /**
   * Called inside a take that found a stale lock: `stale-read` after the lock
   * read stale and before the guard is taken, `guarded` after the guard is
   * taken and the lock read stale again, before it is replaced.
   */
  onStep?: (step: 'stale-read' | 'guarded') => void;
}

/** The lock file's text; `null` where there is none. */
const readLock = (lock: string): string | null => {
  try {
    return fs.readFileSync(lock, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
};

/** The record the lock text names where that call still holds the desk; `null` where it holds nothing. */
const holdingRecord = (text: string, probe: ProcessProbe, now: number): ContinueHolder | null => {
  const holder = decodeContinueHolder(text);
  if (holder === null) return null;
  const alive = probe.alive(holder.pid);
  const sight: ProcessSighting = { alive, startedAt: alive === true ? probe.startedAt(holder.pid) : null };
  return continueLockHeld(holder, { holder: sight }, now, CONTINUE_LOCK_BOUND_MS) ? holder : null;
};

/** Whether the lock text names a call that still holds the desk. A text that is no record holds nothing. */
const lockHolds = (text: string, probe: ProcessProbe, now: number): boolean => holdingRecord(text, probe, now) !== null;

/**
 * Publishes `text` under `lock` where no file has the name: written whole to a
 * scratch file, then linked into place, so a reader never sees a partial record.
 *
 * @returns `true` where the lock is now `text`, `false` where a file had the name.
 */
const publishLock = (lock: string, text: string): boolean => {
  const scratch = `${lock}.${process.pid}.tmp`;
  fs.writeFileSync(scratch, text, 'utf8');
  try {
    fs.linkSync(scratch, lock);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  } finally {
    fs.rmSync(scratch, { force: true });
  }
};

/**
 * Takes the guard that serialises replacing a stale lock: `guard` created with
 * `O_EXCL`. A guard older than {@link GUARD_STALE_MS} is moved aside and the
 * create tried once more; a guard moved aside that turns out fresh is linked
 * back.
 *
 * @returns `true` where this take holds the guard, `false` where another does.
 */
const takeGuard = (guard: string): boolean => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(guard, '', { flag: 'wx' });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const aside = `${guard}.${process.pid}.stale`;
    try {
      if (Date.now() - fs.statSync(guard).mtimeMs < GUARD_STALE_MS) return false;
      fs.renameSync(guard, aside);
      if (Date.now() - fs.statSync(aside).mtimeMs < GUARD_STALE_MS) {
        fs.linkSync(aside, guard);
        return false;
      }
    } catch {
      /* another take moved or replaced the guard; the create is tried again */
    } finally {
      fs.rmSync(aside, { force: true });
    }
  }
  return false;
};

/**
 * Takes the continue lock for `worktree` for this process.
 *
 * A free desk is taken by publishing the record. Where a lock exists and
 * {@link continueLockHeld} reads it as holding, the take answers `null`. A
 * stale lock is replaced only under the guard file, after reading it stale a
 * second time, so two takes that both read it stale cannot both replace it —
 * the same two-reads-one-guard shape `takeImplementLock` uses.
 *
 * @param worktree - the desk, absolute.
 * @param deps - test seams.
 * @returns this process's record, or `null` where another call holds the desk.
 * @throws where the lock's directory cannot be read or written.
 */
export const takeContinueLock = (worktree: string, deps: ContinueLockDeps = {}): ContinueHolder | null => {
  const probe = deps.probe ?? processProbeSystem();
  const now = deps.now ?? Date.now;
  const lock = continueLockPath(worktree);
  const self = probe.self();
  const mine: ContinueHolder = { pid: self.pid, startedAt: self.startedAt, at: now() };
  const text = encodeContinueHolder(mine);
  if (publishLock(lock, text)) return mine;
  const seen = readLock(lock);
  if (seen !== null && lockHolds(seen, probe, now())) return null;
  deps.onStep?.('stale-read');
  const guard = `${lock}.guard`;
  if (!takeGuard(guard)) return null;
  try {
    const current = readLock(lock);
    if (current !== null && lockHolds(current, probe, now())) return null;
    deps.onStep?.('guarded');
    fs.rmSync(lock, { force: true });
    return publishLock(lock, text) ? mine : null;
  } finally {
    fs.rmSync(guard, { force: true });
  }
};

/** Whether the lock text is the record `mine` took. */
const isMine = (text: string | null, mine: ContinueHolder): boolean => {
  const holder = text === null ? null : decodeContinueHolder(text);
  return holder !== null && holder.pid === mine.pid && holder.at === mine.at && holder.startedAt === mine.startedAt;
};

/**
 * Removes the continue lock `mine` took. A lock that is no longer `mine` is
 * left alone.
 *
 * @param worktree - the desk, absolute.
 * @param mine - the record {@link takeContinueLock} returned.
 */
export const releaseContinueLock = (worktree: string, mine: ContinueHolder): void => {
  const lock = continueLockPath(worktree);
  try {
    if (isMine(readLock(lock), mine)) fs.rmSync(lock, { force: true });
  } catch (err) {
    // A lock left behind frees on its own age bound, so this is visible rather
    // than silent, not a strand with no recovery.
    console.error(`could not release the continue lock for ${worktree}: ${err instanceof Error ? err.message : String(err)}`);
  }
};
