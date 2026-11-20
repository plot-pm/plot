import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, readdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  bbBudgetCount,
  bbGuard,
  bbHourStamps,
  bbKeyInput,
  bbPauseAfter429,
  bbPauseFileName,
  bbPauseLine,
  bbPauseMerge,
  bbPauseParse,
  bbPrunes,
  bbRequestFileName,
  bbRequestLine,
  bbShownWait,
  bbStatePath,
  type BbLimitFields,
  type BbPause,
} from '../../rules/bb-ledger.js';

/** What the ledger answers before one request. */
export type BbLedgerAnswer =
  | {
      readonly verdict: 'send';
      /** The ledger after this request, or null where the count is not kept. */
      readonly fields: BbLimitFields | null;
    }
  | { readonly verdict: 'paused' | 'ceiling'; readonly waitSeconds: number; readonly said: string };

/** `bb`'s per-account request ledger, as one more `bb` caller sees it. */
export interface BbLedger {
  /**
   * Guards one request: refuses it during a pause or at the ceiling, and
   * otherwise records it and prunes. Never rejects; state that cannot be kept
   * lets the request go out.
   *
   * @param email - the account's email.
   * @param ceiling - the ceiling, or null for none.
   */
  guard(email: string, ceiling: number | null): Promise<BbLedgerAnswer>;
  /**
   * Starts or extends the pause after a 429 and answers the pause that stayed
   * in place. Never rejects; a pause that cannot be stored is answered all the
   * same.
   *
   * @param email - the account's email.
   * @param retryAfter - the `Retry-After` header as sent, or null.
   */
  pauseAfter429(email: string, retryAfter: string | null): Promise<BbPause>;
}

/** The seams of the file ledger. */
export interface BbLedgerFileOptions {
  /** Reads `BB_STATE_DIR`, `XDG_STATE_HOME` and `HOME`; never `process.env`. */
  env: Record<string, string | undefined>;
  /** The clock, epoch milliseconds; defaults to `Date.now`. */
  now?: () => number;
  /** Receives the one warning and the one account line; defaults to stderr. */
  log?: (line: string) => void;
}

/**
 * The account key of an email: the first 12 hex characters of the SHA-256 of
 * the email with ASCII letters lowercased (`bb_account_key`).
 *
 * @param email - the account's email.
 * @returns the key.
 */
export const bbAccountKey = (email: string): string =>
  createHash('sha256').update(bbKeyInput(email), 'utf8').digest('hex').slice(0, 12);

/** Reads a request file: `''` where it is missing, null where it exists and cannot be read. */
const readRequests = async (path: string): Promise<string | null> => {
  try {
    if (!(await stat(path)).isFile()) return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : null;
  }
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
};

/** Reads a pause file: null where it is missing or cannot be read. */
const readPause = async (path: string): Promise<BbPause | null> => {
  try {
    return bbPauseParse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Builds the file ledger over `bb`'s state directory.
 *
 * The directory is `BB_STATE_DIR`, else `$XDG_STATE_HOME/bb`, else
 * `$HOME/.local/state/bb`; a missing one is made with mode 700, and an existing
 * one is used where it is writable and searchable. A request appends one line
 * with one `O_APPEND` write; the pause file changes by rename only. There is no
 * lock. The first state failure logs one warning and every later one is
 * silent; the first recorded request logs the account key, the request file,
 * the count, the ceiling and the state directory.
 *
 * @param options - the seams.
 * @returns the ledger.
 */
export const bbLedgerFile = (options: BbLedgerFileOptions): BbLedger => {
  const env = options.env;
  const clock = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const seconds = (): number => Math.floor(clock() / 1000);
  const where = bbStatePath(env);
  let warned = false;
  let announced = false;

  const warn = (reason: string): void => {
    if (warned) return;
    warned = true;
    log(
      `warning: bb-ledger cannot keep its request count in ${where ?? '~/.local/state/bb'} (${reason}); the hourly budget is off for this call`,
    );
  };

  const stateDir = async (): Promise<string | null> => {
    if (where === null) return null;
    try {
      const info = await stat(where);
      if (!info.isDirectory()) return null;
      await access(where, constants.W_OK | constants.X_OK);
      return where;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
    try {
      await mkdir(where, { recursive: true, mode: 0o700 });
      return where;
    } catch {
      return null;
    }
  };

  const append = async (path: string, line: string): Promise<boolean> => {
    try {
      const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT, 0o666);
      try {
        await handle.write(line);
      } finally {
        await handle.close();
      }
      return true;
    } catch {
      return false;
    }
  };

  const prune = async (dir: string, prevStamp: string): Promise<void> => {
    try {
      const names = (await readdir(dir)).filter((name) => bbPrunes(name, prevStamp));
      await Promise.all(names.map((name) => unlink(join(dir, name)).catch(() => undefined)));
    } catch {
      // A file that stays does no harm.
    }
  };

  const guard = async (email: string, ceiling: number | null): Promise<BbLedgerAnswer> => {
    const dir = await stateDir();
    if (dir === null) {
      warn('the state directory cannot be used');
      return { verdict: 'send', fields: null };
    }
    const key = bbAccountKey(email);
    const now = seconds();
    const pause = await readPause(join(dir, bbPauseFileName(key)));
    const { stamp, prev } = bbHourStamps(now);
    const curFile = join(dir, bbRequestFileName(key, stamp));
    const texts =
      ceiling === null
        ? []
        : await Promise.all([readRequests(join(dir, bbRequestFileName(key, prev))), readRequests(curFile)]);
    const known = texts.every((text) => text !== null) ? (texts as string[]) : null;
    const verdict = bbGuard({ now, ceiling, pause, texts: known });
    if (verdict.verdict !== 'send') return verdict;
    if (known === null) {
      warn('a request file cannot be read');
      return { verdict: 'send', fields: null };
    }
    const line = bbRequestLine(now);
    if (!(await append(curFile, line))) {
      warn('the request file cannot be written');
      return { verdict: 'send', fields: null };
    }
    await prune(dir, prev);
    if (ceiling === null) {
      return { verdict: 'send', fields: { requests: null, ceiling: null, pausedUntil: null, waitSeconds: 0 } };
    }
    const after = bbBudgetCount(now, ceiling, [...known, line]);
    if (!announced) {
      announced = true;
      log(
        `bb-ledger: account key ${key}, request file ${curFile}, ${after.requests} requests in the last hour, ceiling ${ceiling}, state directory ${dir}`,
      );
    }
    return {
      verdict: 'send',
      fields: {
        requests: after.requests,
        ceiling,
        pausedUntil: null,
        waitSeconds: after.freeAt === null ? 0 : bbShownWait(Math.max(after.freeAt - now, 1)),
        nextFreeAt: after.freeAt,
      },
    };
  };

  const pauseAfter429 = async (email: string, retryAfter: string | null): Promise<BbPause> => {
    const now = seconds();
    const key = bbAccountKey(email);
    const dir = await stateDir();
    const file = dir === null ? null : join(dir, bbPauseFileName(key));
    const next = bbPauseAfter429(file === null ? null : await readPause(file), retryAfter, now);
    if (dir === null || file === null) {
      warn('the state directory cannot be used');
      return next;
    }
    const tmp = join(dir, `${bbPauseFileName(key)}.${randomBytes(6).toString('base64url').slice(0, 6)}`);
    try {
      const handle = await open(tmp, 'wx', 0o600);
      try {
        const merged = bbPauseMerge(next, await readPause(file), now);
        await handle.write(bbPauseLine(merged));
        await handle.close();
        await rename(tmp, file);
        return merged;
      } catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
      }
    } catch {
      await unlink(tmp).catch(() => undefined);
      warn('the pause file cannot be written');
      return next;
    }
  };

  return { guard, pauseAfter429 };
};
