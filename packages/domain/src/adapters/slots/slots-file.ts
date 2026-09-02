import { link, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { slotIsStale, type SlotClaim } from '../../rules/concurrency.js';
import type { HeldSlot, Slots } from '../../ports/slots.js';

/**
 * The environment variable that names the claims' directory.
 *
 * THE SAME ONE THE RECORD USES, and deliberately not a second variable. The
 * claims sit beside the record because they are about the same account's spend
 * against the same connector, and a separate override would let a test move one
 * and not the other — two halves of one budget resolving to two places, which
 * is the split `budget-file.ts` documents at length and closes.
 */
export const SLOTS_HOME_ENV = 'PLOT_BUDGET_HOME';

/** The claims' directory under the home directory, beside the record. */
const HOME_SUBDIR = join('.plot', 'state');

/**
 * The subdirectory the claim files live in.
 *
 * A DIRECTORY RATHER THAN A FILE, because releasing a slot is an unlink and
 * claiming one is an exclusive create — the two operations a filesystem makes
 * atomic without a lock. The budget record next door is a single append-only
 * file for the opposite reason: it never deletes.
 */
const SLOTS_DIR = 'slots';

/** The seams a test needs so a suite never touches the operator's own claims. */
export interface SlotsFileOptions {
  /** Where the claims' directory is; defaults to `$PLOT_BUDGET_HOME` or `~/.plot/state`. */
  home?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** This process's id; defaults to `process.pid`. */
  pid?: number;
  /** When this process started, epoch ms; defaults to the runtime's uptime. */
  startedAt?: number;
  /** Reads the clock; defaults to `Date.now`. */
  now?: () => number;
  /** Whether a pid is alive; defaults to `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean | null;
}

/**
 * Resolves the claims' directory, without touching the disk.
 *
 * THE ANSWER MUST NOT DEPEND ON WHICH CHECKOUT ASKS — the property
 * `budget-file.ts` establishes and the reason this reads no repository root, no
 * git directory and no working directory. Two checkouts sharing one GitHub
 * account share one cap, or the cap counts half the callers.
 */
const homeFor = (options: SlotsFileOptions): string | null => {
  if (options.home !== undefined && options.home !== '') return options.home;
  const env = options.env ?? process.env;
  const override = env[SLOTS_HOME_ENV];
  if (override !== undefined && override !== '') return override;
  const home = homedir();
  return home === '' ? null : join(home, HOME_SUBDIR);
};

/**
 * Whether a pid is alive, asked without a subprocess.
 *
 * `process.kill(pid, 0)` IS THE SAME SYSCALL `kill -0` MAKES, and this asks it
 * directly because the question is asked once per slot per call. `Processes`
 * shells out, which is right for a reading taken once per refresh and wrong for
 * one taken inside the gate every host call passes through — a cap that spawned
 * five shells to decide whether to make one call would cost more than it saves.
 *
 * `EPERM` IS ALIVE. A process this user may not signal is still a process, and
 * reading it as dead would free a slot somebody holds.
 *
 * @param pid - the process id to test.
 * @returns true where a process holds the pid, false where none does, and null
 *   where the question could not be put at all.
 */
const pidAlive = (pid: number): boolean | null => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    return null;
  }
};

/**
 * Strips what a filename cannot carry from an account name.
 *
 * The account is a string the record does not validate — the rule `BudgetKey`
 * states — so it can hold a slash or a dot segment, and a claim path built from
 * it unchecked is a path traversal. Every character outside a conservative set
 * becomes an underscore, which collides two accounts that differ only in
 * punctuation onto one cap. That is the safe direction: a shared cap is
 * conservative, and a claim written outside the state directory is not.
 */
const clean = (account: string): string => {
  const safe = account.replace(/[^A-Za-z0-9._-]/g, '_');
  // EVERY DOT RUN OF TWO OR MORE, wherever it sits, not only a leading one.
  // `join` would normalise `..` away, so this is belt and braces rather than
  // the only guard — but a path segment that still SPELLS a parent directory is
  // one a later reader has to reason about, and the reasoning is what fails.
  return safe.replace(/\.{2,}/g, '_') || '_';
};

/** How a claim is written — one line, three fields, no parser needed. */
const encodeClaim = (claim: SlotClaim): string =>
  `${Math.trunc(claim.pid)}\t${claim.startedAt === null ? '-' : Math.trunc(claim.startedAt)}\t${Math.trunc(claim.at)}\n`;

/**
 * Reads a claim back, or null where the file is not one this wrote.
 *
 * A NULL IS THE NORMAL CASE, exactly as it is for the budget record's lines. A
 * claim file can be read while it is being written, and a torn one describes
 * nothing — so it is skipped rather than thrown on. It is then reclaimable by
 * the caller reading it, which is right: a file nobody can read names no
 * process holding the slot.
 */
const decodeClaim = (text: string): SlotClaim | null => {
  const [pid, startedAt, at] = text.trim().split('\t');
  const parsedPid = Number(pid);
  const parsedAt = Number(at);
  if (!Number.isFinite(parsedPid) || !Number.isFinite(parsedAt)) return null;
  const parsedStart = startedAt === '-' ? null : Number(startedAt);
  return {
    pid: parsedPid,
    startedAt: parsedStart !== null && Number.isFinite(parsedStart) ? parsedStart : null,
    at: parsedAt,
  };
};

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/** Whether a failure was the name already existing — the contended-claim case. */
const isTaken = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EEXIST';

/**
 * Bounds simultaneous host calls with one claim file per slot, beside the
 * budget record.
 *
 * **`link` IS WHAT MAKES THE COUNT CORRECT.** It creates a name for a file that
 * already exists whole, and fails where the name is taken — one syscall the
 * kernel serialises, so two processes asking for the last slot at the same
 * moment cannot both be given it.
 *
 * **AND `O_CREAT | O_EXCL` IS NOT ENOUGH, MEASURED RATHER THAN ARGUED.** `wx`
 * is exclusive too, but it publishes the NAME before the CONTENT: a second
 * process opens the empty file, reads no claim in it, and reclaims a slot the
 * first is about to write into. Six processes against a bound of three took
 * five slots that way, two of them the same one. `link` publishes a complete
 * file, so the name and the claim arrive together.
 *
 * **A DEAD CLAIMANT FREES ITS SLOT, MEASURED RATHER THAN TIMED.** The idle rule
 * ended twelve desks over two days in this estate; a cap that counted their
 * abandoned claims forever would read the account as permanently full and stop
 * the board — worse than the 403 it prevents. So a claim is tested against the
 * process table on every acquisition, and a timer is only the last resort for
 * the case liveness cannot decide.
 *
 * @param options - an explicit home, pid or clock, for tests.
 * @returns a `Slots` backed by one directory per account.
 */
export const slotsFile = (options: SlotsFileOptions = {}): Slots => {
  const now = options.now ?? Date.now;
  const alive = options.isAlive ?? pidAlive;
  const pid = options.pid ?? process.pid;
  // THE PROCESS'S OWN START TIME, DERIVED RATHER THAN ASKED. `process.uptime()`
  // is what this runtime already knows, so no `ps` is spawned to learn a fact
  // the process holds about itself. It is a reading of a live clock and drifts
  // by milliseconds between calls, which is why `slotIsStale` compares
  // truncated values rather than exact ones.
  const startedAt = options.startedAt ?? Math.trunc(now() - process.uptime() * 1000);

  const dirFor = (account: string): string | null => {
    const home = homeFor(options);
    return home === null ? null : join(home, SLOTS_DIR, clean(account));
  };

  /**
   * Publishes this process's claim under a slot's name, atomically.
   *
   * `link` RATHER THAN A RENAME, because a rename would OVERWRITE the slot a
   * live process holds — silently doubling the account's callers, which is the
   * one failure a cap must not have. `link` refuses an existing name, so the
   * only outcomes are *this process now holds it* and *somebody else does*.
   *
   * @param scratch - the complete claim file to publish.
   * @param path - the slot's name.
   * @returns `taken` where the slot is now this process's, `held` where another
   *   name was already there, and `failed` where the directory refused.
   */
  const claimBy = async (
    scratch: string,
    path: string,
  ): Promise<'taken' | 'held' | 'failed'> => {
    try {
      await link(scratch, path);
      return 'taken';
    } catch (error) {
      return isTaken(error) ? 'held' : 'failed';
    }
  };

  const readClaim = async (dir: string, index: number): Promise<SlotClaim | null> => {
    try {
      return decodeClaim(await readFile(join(dir, `${index}`), 'utf8'));
    } catch {
      // A MISSING SLOT IS A FREE SLOT, and an unreadable one is treated the
      // same: neither names a process holding it. The claim it would have held
      // is reclaimed by the exclusive create below, which is the only place a
      // slot is actually taken.
      return null;
    }
  };

  return {
    acquire: async (account: string, bound: number): Promise<PortResult<number | null>> => {
      const dir = dirFor(account);
      if (dir === null) return failed<number | null>();
      const wanted = Math.max(1, Math.trunc(bound));
      try {
        await mkdir(dir, { recursive: true });
      } catch {
        return failed<number | null>();
      }
      // WRITTEN WHOLE, THEN LINKED INTO PLACE. `open(path, 'wx')` is exclusive
      // but it creates the name BEFORE the content, so a second process can
      // open the empty file, read no claim in it, and reclaim a slot the first
      // is about to write into — measured here, five processes taking three
      // slots and two of them the same one. `link` publishes a file that is
      // already complete, and fails with `EEXIST` where the name is taken, so
      // the name and the claim arrive together.
      const scratch = join(dir, `.${pid}.${Math.trunc(now())}.tmp`);
      try {
        await writeFile(scratch, encodeClaim({ pid, startedAt, at: now() }), { encoding: 'utf8' });
      } catch {
        return failed<number | null>();
      }
      try {
        for (let index = 0; index < wanted; index += 1) {
          const path = join(dir, `${index}`);
          const taken = await claimBy(scratch, path);
          if (taken === 'taken') return answered<number | null>(index);
          if (taken === 'failed') return failed<number | null>();
          // HELD, SO ASK WHETHER IT IS STILL HELD BY ANYBODY. A claim whose
          // process is gone is reclaimed here rather than by a sweeper, because
          // this caller has already read the file and a sweeper would read
          // every one of them again to learn the same thing.
          const held = await readClaim(dir, index);
          if (held !== null && !slotIsStale(held, alive(held.pid), null, now())) continue;
          try {
            await unlink(path);
          } catch (error) {
            // SOMEBODY ELSE RECLAIMED IT FIRST, which is a race this loses
            // rather than fails: the slot is theirs and the next index is asked
            // about. Any other error is a directory this cannot manage.
            if (!isMissing(error)) return failed<number | null>();
            continue;
          }
          const retaken = await claimBy(scratch, path);
          if (retaken === 'taken') return answered<number | null>(index);
          if (retaken === 'failed') return failed<number | null>();
        }
        // EVERY SLOT HELD BY A LIVE PROCESS. `null`, never `failed` — the
        // account is busy, which is a different fact from the claims being
        // unreadable, and a caller must not read either as the other.
        return answered<number | null>(null);
      } finally {
        // THE SCRATCH FILE ALWAYS GOES, taken or not. A successful `link` leaves
        // two names for one inode and the slot keeps the one that matters; an
        // exhausted loop leaves only this one, and a directory accumulating them
        // would make `held` slower every time an account is busy.
        try {
          await unlink(scratch);
        } catch {
          // Already gone, which is the state this wanted.
        }
      }
    },

    release: async (account: string, index: number): Promise<PortResult<void>> => {
      const dir = dirFor(account);
      if (dir === null) return failed<void>();
      const path = join(dir, `${Math.trunc(index)}`);
      // ONLY THIS PROCESS'S OWN CLAIM IS REMOVED. A slot reclaimed as stale
      // while its owner still ran now belongs to somebody else, and unlinking
      // it on the way out would drop a live caller's claim and let the cap be
      // exceeded by one for as long as they hold it.
      const held = await readClaim(dir, Math.trunc(index));
      if (held !== null && held.pid !== pid) return answered(undefined);
      try {
        await unlink(path);
        return answered(undefined);
      } catch (error) {
        // A MISSING SLOT IS SUCCESS. Releasing twice, and releasing one a
        // reclaimer already removed, are both the state the caller wanted.
        if (isMissing(error)) return answered(undefined);
        return failed<void>();
      }
    },

    held: async (account: string): Promise<PortResult<readonly HeldSlot[]>> => {
      const dir = dirFor(account);
      if (dir === null) return failed<readonly HeldSlot[]>();
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        // AN ABSENT DIRECTORY IS AN EMPTY ANSWER, not a failure — the state of
        // every account that has not spent yet, and the same rule
        // `BudgetRecord.lines` keeps for a missing record.
        if (isMissing(error)) return answered<readonly HeldSlot[]>([]);
        return failed<readonly HeldSlot[]>();
      }
      const slots: HeldSlot[] = [];
      for (const name of names) {
        const index = Number(name);
        if (!Number.isInteger(index) || index < 0) continue;
        const claim = await readClaim(dir, index);
        if (claim !== null) slots.push({ index, claim });
      }
      return answered<readonly HeldSlot[]>(
        slots.sort((left, right) => left.index - right.index),
      );
    },
  };
};
