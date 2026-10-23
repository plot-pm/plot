import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { readerIsStale, type ReaderClaim } from '../../rules/reader-election.js';
import type { ReaderLock } from '../../ports/reader-lock.js';

/**
 * The environment variable that names the lock's directory.
 *
 * **THE SAME ONE THE BUDGET RECORD AND THE SLOTS USE, and deliberately not a
 * third variable.** The reader lock is about the same account's calls against
 * the same connector `slots-file.ts` already bounds — `SLOTS_HOME_ENV` makes
 * this same argument for reusing `BUDGET_HOME_ENV` rather than adding its own,
 * and a third override here would let a test move one of three places a
 * machine-wide concern lives and not the other two.
 */
export const READER_LOCK_HOME_ENV = 'PLOT_BUDGET_HOME';

/** The lock directories' parent, under the home directory, beside `slots/` and `budget.tsv`. */
const HOME_SUBDIR = join('.plot', 'state');

/** The subdirectory the per-key lock directories live in. */
const LOCKS_DIR = 'pr-reader';

/** The owner file's name inside one key's lock directory. */
const OWNER_FILE = 'owner';

/** Reduces a `(connector, account, repo)` key to a safe path segment. */
const clean = (segment: string): string => {
  const safe = segment.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/\.{2,}/g, '-');
  return safe === '' || /^[.-]+$/.test(safe) ? 'unknown' : safe;
};

/**
 * Builds the key a `ReaderLock` is scoped by, from its three parts.
 *
 * **EVERY PART SANITIZED INDEPENDENTLY, THEN JOINED.** A connector, account or
 * repo name carrying a path separator or a leading dot could otherwise walk
 * the key outside its own lock directory or collide two distinct keys onto
 * one lock — the same hazard `connectorFile` sanitizes against in the PR
 * index adapter, applied to three segments instead of one.
 *
 * @param connector - which connector this reader asks, e.g. `bitbucket`.
 * @param account - the host account, as `Host.account()` answered it.
 * @param repo - the repository identity, as the caller resolved it (e.g. from
 *   the origin remote).
 * @returns a single path segment safe to use as a directory name.
 */
export const readerLockKey = (connector: string, account: string, repo: string): string =>
  `${clean(connector)}--${clean(account)}--${clean(repo)}`;

/** The seams a test needs so a suite never touches the operator's own lock. */
export interface ReaderLockFileOptions {
  /** Where the lock directories live; defaults to `$PLOT_BUDGET_HOME` or `~/.plot/state`. */
  home?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Whether a pid is alive; defaults to asking the real process table. */
  isAlive?: (pid: number) => boolean | null;
  /** Reads the clock; defaults to `Date.now`. */
  now?: () => number;
}

/** Resolves the locks' parent directory, without touching the disk. */
const homeFor = (options: ReaderLockFileOptions): string | null => {
  if (options.home !== undefined && options.home !== '') return join(options.home, LOCKS_DIR);
  const env = options.env ?? process.env;
  const override = env[READER_LOCK_HOME_ENV];
  if (override !== undefined && override !== '') return join(override, LOCKS_DIR);
  const home = homedir();
  return home === '' ? null : join(home, HOME_SUBDIR, LOCKS_DIR);
};

/** Whether a failure was the file or directory simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/** Whether a failure was the name already existing. */
const isTaken = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EEXIST';

/** Encodes a claim as the owner file's one line: `pid<TAB>startedAt<TAB>at`. */
const encodeClaim = (claim: ReaderClaim): string =>
  `${Math.trunc(claim.pid)}\t${claim.startedAt === null ? '-' : Math.trunc(claim.startedAt)}\t${Math.trunc(claim.at)}\n`;

/** Decodes an owner file's line, or null where it is not one this wrote. */
const decodeClaim = (text: string): ReaderClaim | null => {
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

/** Whether a pid is alive, asked without a subprocess — same syscall `kill -0` makes. */
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
 * Elects one PR reader per `(connector, account, repo)` with one claim file
 * per key, under the computer's own state directory.
 *
 * **SAME SHAPE AS `slotsFile`, WITH ONE SLOT INSTEAD OF N.** `link` publishes a
 * complete file atomically — the name and the claim arrive together — where
 * `mkdir` alone, or `open(path, 'wx')` followed by a separate write, would
 * publish the name before the content: `slots-file.ts` measured that exact gap
 * letting two processes both read an empty claim and both take the slot. The
 * owner file holds `pid<TAB>startedAt<TAB>at`, mirroring both
 * `plot-push-lock.mjs`'s `pid<TAB>at-ms<TAB>action` and `slotsFile`'s own claim
 * shape.
 *
 * **A DEAD OR STALE HOLDER IS UNLINKED BEFORE THE RETRY**, the same two-step
 * `slotsFile.acquire` takes: read the claim, and only remove it where the rule
 * says it may be reclaimed, never on the strength of the name merely existing.
 *
 * @param options - an explicit home, clock or liveness check, for tests.
 * @returns a `ReaderLock` backed by one claim file per key.
 */
export const readerLockFile = (options: ReaderLockFileOptions = {}): ReaderLock => {
  const now = options.now ?? ((): number => Date.now());
  const alive = options.isAlive ?? pidAlive;

  const dirFor = (key: string): string | null => {
    const home = homeFor(options);
    return home === null ? null : join(home, key);
  };

  const readOwner = async (dir: string): Promise<PortResult<ReaderClaim | null>> => {
    try {
      const text = await readFile(join(dir, OWNER_FILE), 'utf8');
      return answered(decodeClaim(text));
    } catch (error) {
      if (isMissing(error)) return answered(null);
      return failed<ReaderClaim | null>();
    }
  };

  /** Publishes `claim` as the owner file, atomically, via a scratch-then-link. */
  const publish = async (dir: string, claim: ReaderClaim): Promise<'elected' | 'held' | 'failed'> => {
    const path = join(dir, OWNER_FILE);
    const scratch = join(dir, `.${claim.pid}.${Math.trunc(now())}.tmp`);
    try {
      await writeFile(scratch, encodeClaim(claim), { encoding: 'utf8' });
    } catch {
      return 'failed';
    }
    try {
      await link(scratch, path);
      return 'elected';
    } catch (error) {
      return isTaken(error) ? 'held' : 'failed';
    } finally {
      try {
        await unlink(scratch);
      } catch {
        // Already gone, which is the state this wanted.
      }
    }
  };

  return {
    holder: async (key: string): Promise<PortResult<ReaderClaim | null>> => {
      const dir = dirFor(key);
      if (dir === null) return failed<ReaderClaim | null>();
      return readOwner(dir);
    },

    elect: async (key: string, claim: ReaderClaim): Promise<PortResult<'elected' | 'held'>> => {
      const dir = dirFor(key);
      if (dir === null) return failed<'elected' | 'held'>();
      try {
        await mkdir(dir, { recursive: true });
      } catch {
        return failed<'elected' | 'held'>();
      }

      const first = await publish(dir, claim);
      if (first === 'elected') return answered('elected');
      if (first === 'failed') return failed<'elected' | 'held'>();

      // HELD. Read who holds it and ask the rule what that means — already
      // mine (a renewal), a live stranger's, or stale — rather than treating
      // `EEXIST` alone as "somebody else holds this".
      const held = await readOwner(dir);
      if (!held.ok) return failed<'elected' | 'held'>();
      const holder = held.value;
      if (holder !== null && holder.pid === claim.pid) {
        // RENEWAL: this process already holds the lock. Overwrite directly —
        // no other process may publish under this pid, so there is no name to
        // race against.
        try {
          await writeFile(join(dir, OWNER_FILE), encodeClaim(claim), { encoding: 'utf8' });
          return answered('elected');
        } catch {
          return failed<'elected' | 'held'>();
        }
      }
      const isAlive = holder === null ? null : alive(holder.pid);
      const stale = holder === null || readerIsStale(holder, isAlive, null, now());
      if (!stale) return answered('held');

      // STALE OR UNREADABLE: unlink it and retry once. A missing name here
      // means somebody else reclaimed it first, which is their win, not a
      // failure — read that outcome from the retry itself.
      try {
        await unlink(join(dir, OWNER_FILE));
      } catch (error) {
        if (!isMissing(error)) return failed<'elected' | 'held'>();
      }
      const retry = await publish(dir, claim);
      if (retry === 'failed') return failed<'elected' | 'held'>();
      return answered(retry);
    },

    release: async (key: string, pid: number): Promise<PortResult<void>> => {
      const dir = dirFor(key);
      if (dir === null) return failed<void>();
      const held = await readOwner(dir);
      // ONLY THIS PROCESS'S OWN CLAIM IS REMOVED. A lock reclaimed as stale
      // while its owner still ran belongs to somebody else now, and unlinking
      // it on the way out would drop a live holder's claim.
      if (held.ok && held.value !== null && held.value.pid !== pid) return answered(undefined);
      try {
        await unlink(join(dir, OWNER_FILE));
        return answered(undefined);
      } catch (error) {
        // A MISSING LOCK IS SUCCESS. Releasing twice, and releasing one a
        // reclaimer already removed, are both the state the caller wanted.
        if (isMissing(error)) return answered(undefined);
        return failed<void>();
      }
    },
  };
};
