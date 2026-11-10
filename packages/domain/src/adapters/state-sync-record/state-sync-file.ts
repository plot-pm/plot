import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { StateSyncRecord } from '../../ports/state-sync-record.js';
import type { ForwardRefusal, SyncPrRefresh } from '../../rules/state-sync.js';
import { processAnswers, type FixedAnswers } from '../git-dirs/git-dirs.js';

/** The environment variable naming the common git directory, for tests. */
export const STATE_SYNC_HOME_ENV = 'PLOT_STATE_SYNC_HOME';

/** The lock directory `plot-push-lock.mjs` creates under the common git directory. */
const LOCK = 'plot-push-main.lock';

/** The refusal's filename, under the common git directory's `.plot/state/`. */
const FILE = 'state-sync-refusal.json';

/** The last sync pull request refresh's filename, beside the refusal. */
const REFRESH_FILE = 'state-sync-refresh.json';

/** The seams the adapter needs so a test never touches the operator's own files. */
export interface StateSyncFileOptions {
  /** The checkout to resolve the common git directory for; the process's cwd when omitted. */
  cwd?: string;
  /** The held answers that place the directory; this process's own when omitted. */
  answers?: FixedAnswers;
  /** An explicit common git directory, bypassing the git lookup. */
  home?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** The stale bound in seconds; `PLOT_PUSH_LOCK_STALE_S` or 600 when omitted. */
  staleSeconds?: number;
  /** Tells a live process from a dead one; `process.kill(pid, 0)` when omitted. */
  alive?: (pid: number) => boolean;
}

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
};

/**
 * The OS pid a lock holder names: the whole id where it is a bare number, the part before the dot of a board
 * holder `<pid>.<seq>`. Any other holder has no pid and ages out only.
 */
const osPid = (holder: string): number | null => {
  const [head, tail] = holder.split('.');
  return /^\d+$/.test(head) && (tail === undefined || /^\d+$/.test(tail)) ? Number(head) : null;
};

/**
 * Reads the push lock and keeps the forward sync's refusal for ONE repository.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a {@link StateSyncRecord} backed by the common git directory.
 */
export const stateSyncFile = (options: StateSyncFileOptions = {}): StateSyncRecord => {
  const env = options.env ?? process.env;
  const alive = options.alive ?? processAlive;
  let cached: string | null | undefined;

  const commonOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[STATE_SYNC_HOME_ENV];
    if (override !== undefined && override !== '') return override;
    if (cached !== undefined) return cached;
    const run = await (options.answers ?? processAnswers).commonDir(options.cwd);
    const out = run.stdout.trim();
    cached = run.code !== 0 || out === '' ? null : resolve(options.cwd ?? process.cwd(), out);
    return cached;
  };

  return {
    lockHeld: async (now) => {
      const common = await commonOf();
      if (common === null) return 'unknown';
      try {
        await stat(join(common, LOCK));
      } catch (error) {
        return isMissing(error) ? false : 'unknown';
      }
      let owner: string;
      try {
        owner = await readFile(join(common, LOCK, 'owner'), 'utf8');
      } catch {
        return 'unknown';
      }
      const [holder = '', at = ''] = owner.replace(/\n$/, '').split('\t');
      const takenAt = Number(at);
      if (!Number.isFinite(takenAt)) return 'unknown';
      const staleMs = (options.staleSeconds ?? (Number(env['PLOT_PUSH_LOCK_STALE_S']) || 600)) * 1000;
      if (now - takenAt > staleMs) return false;
      const pid = osPid(holder);
      return pid === null ? true : alive(pid);
    },

    refusal: async (): Promise<PortResult<ForwardRefusal | null>> => {
      const common = await commonOf();
      if (common === null) return failed<ForwardRefusal | null>();
      try {
        const parsed: unknown = JSON.parse(await readFile(join(common, '.plot', 'state', FILE), 'utf8'));
        const r = parsed as Partial<ForwardRefusal>;
        const ok =
          typeof r.defaultTip === 'string' && typeof r.stateTip === 'string' && Array.isArray(r.files) && r.files.every((f) => typeof f === 'string');
        return ok ? answered<ForwardRefusal | null>({ defaultTip: r.defaultTip as string, stateTip: r.stateTip as string, files: r.files as string[] }) : failed<ForwardRefusal | null>();
      } catch (error) {
        return isMissing(error) ? answered<ForwardRefusal | null>(null) : failed<ForwardRefusal | null>();
      }
    },

    refuse: async (refusal): Promise<PortResult<void>> => {
      const common = await commonOf();
      if (common === null) return failed<void>();
      try {
        await mkdir(join(common, '.plot', 'state'), { recursive: true });
        await writeFile(join(common, '.plot', 'state', FILE), `${JSON.stringify(refusal)}\n`);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },

    clear: async (): Promise<PortResult<void>> => {
      const common = await commonOf();
      if (common === null) return failed<void>();
      try {
        await rm(join(common, '.plot', 'state', FILE), { force: true });
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },

    refreshed: async (): Promise<PortResult<SyncPrRefresh | null>> => {
      const common = await commonOf();
      if (common === null) return failed<SyncPrRefresh | null>();
      try {
        const r = JSON.parse(await readFile(join(common, '.plot', 'state', REFRESH_FILE), 'utf8')) as Partial<SyncPrRefresh>;
        const ok = Number.isInteger(r.pr) && Number.isInteger(r.ahead);
        return ok ? answered<SyncPrRefresh | null>({ pr: r.pr as number, ahead: r.ahead as number }) : failed<SyncPrRefresh | null>();
      } catch (error) {
        return isMissing(error) ? answered<SyncPrRefresh | null>(null) : failed<SyncPrRefresh | null>();
      }
    },

    noteRefresh: async (refresh): Promise<PortResult<void>> => {
      const common = await commonOf();
      if (common === null) return failed<void>();
      try {
        await mkdir(join(common, '.plot', 'state'), { recursive: true });
        await writeFile(join(common, '.plot', 'state', REFRESH_FILE), `${JSON.stringify({ pr: refresh.pr, ahead: refresh.ahead })}\n`);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};
