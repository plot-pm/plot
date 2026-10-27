import { link, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { decodeReaderState, encodeReaderState, type ReaderState } from '../../entities/reader-state.js';
import { readerIsStale, type ReaderClaim } from '../../rules/reader-election.js';
import type { ReaderLock } from '../../ports/reader-lock.js';
import { connectorFile } from '../pr-index/pr-index-file.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable that names the lock's directory, for tests.
 *
 * A suite that elected into the operator's own lock would hold the real
 * reader's slot, or read its claim as a stale one and take over mid-refresh.
 */
export const READER_LOCK_HOME_ENV = 'PLOT_PR_INDEX_HOME';

/** The store's subdirectory under the common git dir's `.plot/state/`. */
const SUBDIR = 'index';

/**
 * Names the lock directory for one repository's one connector.
 *
 * BESIDE THE INDEX FILE, under the same `.plot/state/index/` the PR store
 * itself lives in — the file this lock exists to protect, read by the process
 * {@link electReader} elects. `<connector>.json` is the index; `<connector>.lock/`
 * is this lock.
 *
 * @param indexDir - the resolved `.plot/state/index/` directory.
 * @param connector - the connector's name as configured.
 * @returns the lock's own directory.
 */
const lockDirFor = (indexDir: string, connector: string): string =>
  join(indexDir, `${connectorFile(connector).replace(/\.json$/, '')}.lock`);

/**
 * Names the reader state file for one repository's one connector.
 *
 * Beside the lock and the index, and separate from both: the lock's owner
 * claims stay minimal so the atomic-publish discipline they need stays cheap,
 * and the state file is a separate codec a follower reads without electing.
 *
 * @param indexDir - the resolved `.plot/state/index/` directory.
 * @param connector - the connector's name as configured.
 * @returns the reader state file's path.
 */
const readerStateFileFor = (indexDir: string, connector: string): string =>
  join(indexDir, `${connectorFile(connector).replace(/\.json$/, '')}.reader.json`);

/** The seams a test needs so a suite never touches the operator's own lock. */
export interface ReaderLockFileOptions {
  /** The repository to resolve the lock for; the process's cwd when omitted. */
  cwd?: string;
  /** An explicit index directory, bypassing the git lookup. */
  home?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/**
 * Where one repository's lock lives, and the directory that must already exist
 * before anything under it is created.
 */
interface IndexDirs {
  /** The resolved `.plot/state/index/` directory, or the caller's own. */
  indexDir: string;
  /**
   * The directory a write creates levels below and never creates itself: the
   * common git dir, or the parent of an explicit or environment home.
   */
  base: string;
}

/**
 * Resolves the index directory the way every `readerLockFile` does: an
 * explicit `home`, then {@link READER_LOCK_HOME_ENV}, then the COMMON git dir,
 * `realpath`d, joined with `.plot/state/index`.
 *
 * @param options - the same options `readerLockFile` takes.
 * @returns the directories, or `null` where `cwd` is not a git repository or
 *   its common dir cannot be resolved.
 */
const resolveIndexDirs = async (options: ReaderLockFileOptions): Promise<IndexDirs | null> => {
  const env = options.env ?? process.env;
  if (options.home !== undefined && options.home !== '') return { indexDir: options.home, base: dirname(options.home) };
  const override = env[READER_LOCK_HOME_ENV];
  if (override !== undefined && override !== '') return { indexDir: override, base: dirname(override) };
  const run = await runProcess('git', ['rev-parse', '--git-common-dir'], { cwd: options.cwd });
  const out = run.stdout.trim();
  if (run.code !== 0 || out === '') return null;
  try {
    const canonical = await realpath(resolve(options.cwd ?? process.cwd(), out));
    return { indexDir: join(canonical, '.plot', 'state', SUBDIR), base: canonical };
  } catch {
    return null;
  }
};

/**
 * The index directory a `readerLockFile` built with these options reads and
 * writes. A process that hands the directory to another process passes this
 * string, so both open the same lock.
 *
 * @param options - the same options `readerLockFile` takes.
 * @returns the absolute index directory, or `null` where it cannot be resolved.
 */
export const readerLockIndexDir = async (options: ReaderLockFileOptions = {}): Promise<string | null> =>
  (await resolveIndexDirs(options))?.indexDir ?? null;

/**
 * Creates `dir` one level at a time below `base`, and never creates `base`.
 *
 * A write that lands after its repository was removed fails with `ENOENT`
 * here, where a recursive `mkdir` would recreate the removed repository's git
 * dir around the lock.
 *
 * @param base - a directory that must already exist.
 * @param dir - the directory to create, at or below `base`.
 * @throws the `mkdir` error where `base` or a level above `dir` is missing.
 */
const ensureBelow = async (base: string, dir: string): Promise<void> => {
  const rel = relative(base, dir);
  if (rel === '') return;
  let at = base;
  for (const segment of rel.split(sep)) {
    at = join(at, segment);
    try {
      await mkdir(at);
    } catch (error) {
      if (!isTaken(error)) throw error;
    }
  }
};

/** The same claim without a `released` marker. */
const liveClaim = (claim: ReaderClaim): ReaderClaim => ({
  generation: claim.generation,
  pid: claim.pid,
  startedAt: claim.startedAt,
  at: claim.at,
});

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/** Whether a failure was the name already existing — the contended-generation case. */
const isTaken = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EEXIST';

/**
 * How a claim is written: one tab-separated line holding the generation, pid,
 * start time and `at`, and a fifth field `released` on a released claim.
 */
const encodeClaim = (claim: ReaderClaim): string =>
  `${Math.trunc(claim.generation)}\t${Math.trunc(claim.pid)}\t${claim.startedAt === null ? '-' : Math.trunc(claim.startedAt)}\t${Math.trunc(claim.at)}${claim.released === true ? '\treleased' : ''}\n`;

/**
 * Reads a claim back, or null where the text is not one this wrote.
 *
 * A null is the normal case for a file read mid-write, or one a sweep has
 * already removed: both describe no readable claim, which is reclaimable
 * exactly like a missing file.
 */
const decodeClaim = (text: string): ReaderClaim | null => {
  const [generation, pid, startedAt, at, marker] = text.trim().split('\t');
  const parsedGeneration = Number(generation);
  const parsedPid = Number(pid);
  const parsedAt = Number(at);
  if (!Number.isFinite(parsedGeneration) || !Number.isFinite(parsedPid) || !Number.isFinite(parsedAt)) {
    return null;
  }
  if (marker !== undefined && marker !== 'released') return null;
  const parsedStart = startedAt === '-' ? null : Number(startedAt);
  return {
    generation: parsedGeneration,
    pid: parsedPid,
    startedAt: parsedStart !== null && Number.isFinite(parsedStart) ? parsedStart : null,
    at: parsedAt,
    ...(marker === 'released' ? { released: true } : {}),
  };
};

/**
 * Whether a pid is alive, asked without a subprocess.
 *
 * The same syscall `slots-file.ts` uses for the identical reason: this
 * question is asked once per election, not once per refresh, so spawning `ps`
 * here would cost more than the election saves.
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
 * Keeps one repository's reader lock, one generation-numbered claim file per
 * election, one directory per connector.
 *
 * **`link`, NOT `mkdir` OR `open(path, 'wx')`, PUBLISHES EACH GENERATION.**
 * `slots-file.ts` measured why: an exclusive create publishes the NAME before
 * the CONTENT, so a second reader can open the empty file mid-write and
 * misread it as no holder. Writing a scratch file whole and `link`-ing it into
 * `owner.<n>` makes the name and the claim arrive together, and the decision
 * ("do I now hold the lock") and the action ("publish my claim") become one
 * atomic call. Nothing is ever unlinked on a decision path — a stale or
 * contended election leaves the old generation file in place and links past
 * it, so a holder reading `holder()` mid-takeover never sees an absent claim.
 *
 * **RENEWAL AND RELEASE RENAME ONTO THE HOLDER'S OWN `owner.<n>`.** Renewal
 * writes a fresh claim to a scratch file and renames it onto `owner.<n>`;
 * release does the same with a `released` claim. Neither creates a generation
 * nor removes one, so a generation number is never free again once linked.
 * After an election the holder prunes every `owner.<m>` with `m < n - 1`;
 * `owner.<n-1>` stays, so a process that read `n - 1` as the highest and links
 * `owner.<n>` gets `EEXIST`.
 *
 * **THE KEY IS `realpath`D**, closing the symlink-collision bug the old
 * single-segment key carried: `/tmp` and `/private/tmp` name one physical
 * directory on macOS, and a board and a fleetd that each resolved
 * `--git-common-dir` through a different one of the two computed two lock
 * directories for one index file. `realpath` on the resolved common git dir
 * answers with the one canonical path either process reaches.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a `ReaderLock` backed by one directory per connector per repository.
 */
export const readerLockFile = (options: ReaderLockFileOptions = {}): ReaderLock => {
  /**
   * The index directory and its base, from {@link resolveIndexDirs}.
   *
   * Cached per adapter instance, exactly as `pr-index-file.ts` caches it: the
   * answer cannot change while a process runs.
   */
  let cached: IndexDirs | null | undefined;
  const dirsOf = async (): Promise<IndexDirs | null> => {
    if (cached === undefined) cached = await resolveIndexDirs(options);
    return cached;
  };
  const indexDirOf = async (): Promise<string | null> => (await dirsOf())?.indexDir ?? null;

  /** Creates `dir` below the resolved base; see {@link ensureBelow}. */
  const ensureDir = async (dir: string): Promise<void> => {
    const dirs = await dirsOf();
    if (dirs === null) throw new Error('reader lock: no index directory');
    await ensureBelow(dirs.base, dir);
  };

  const lockDirOf = async (connector: string): Promise<string | null> => {
    const dir = await indexDirOf();
    return dir === null ? null : lockDirFor(dir, connector);
  };

  /**
   * Reads every generation file in the lock directory and returns the
   * highest-numbered one that decodes.
   *
   * THE HIGHEST GENERATION, NOT THE LAST READDIR ENTRY. A takeover links the
   * next generation without removing the one it supersedes, so more than one
   * may exist at once; the highest is the only one that is current.
   */
  const highestClaim = async (dir: string): Promise<{ generation: number; claim: ReaderClaim } | null> =>
    (await readClaims(dir)).highest;

  /**
   * Reads the lock directory: the highest generation that decodes, and the
   * number of every `owner.<n>` file present, decoded or not.
   */
  const readClaims = async (
    dir: string,
  ): Promise<{ highest: { generation: number; claim: ReaderClaim } | null; generations: number[] }> => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (isMissing(error)) return { highest: null, generations: [] };
      throw error;
    }
    let best: { generation: number; claim: ReaderClaim } | null = null;
    const generations: number[] = [];
    for (const name of names) {
      const match = /^owner\.(\d+)$/.exec(name);
      if (match === null) continue;
      const generation = Number(match[1]);
      if (!Number.isInteger(generation)) continue;
      generations.push(generation);
      let text: string;
      try {
        text = await readFile(join(dir, name), 'utf8');
      } catch {
        continue;
      }
      const claim = decodeClaim(text);
      if (claim === null) continue;
      if (best === null || generation > best.generation) best = { generation, claim };
    }
    return { highest: best, generations };
  };

  /**
   * Replaces the holder's own `owner.<n>` with `claim`, through a scratch file
   * and `rename`, so a reader sees the old claim or the new one and never an
   * empty file.
   *
   * @returns `true` where the rename landed, `false` where it failed.
   */
  const replaceOwn = async (dir: string, generation: number, claim: ReaderClaim): Promise<boolean> => {
    const scratch = join(dir, `.${claim.pid}.${Math.trunc(claim.at)}.${generation}.renew.tmp`);
    try {
      await writeFile(scratch, encodeClaim({ ...claim, generation }), { encoding: 'utf8' });
      await rename(scratch, join(dir, `owner.${generation}`));
      return true;
    } catch {
      try {
        await unlink(scratch);
      } catch {
        // Already gone, which is the state this wanted.
      }
      return false;
    }
  };

  /**
   * Removes every `owner.<m>` with `m < held - 1`. Decides nothing: a failed
   * removal leaves a file the next prune retries.
   */
  const prune = async (dir: string, held: number): Promise<void> => {
    const { generations } = await readClaims(dir).catch(() => ({ generations: [] as number[] }));
    for (const generation of generations) {
      if (generation >= held - 1) continue;
      try {
        await unlink(join(dir, `owner.${generation}`));
      } catch {
        // Gone already, or left for the next prune.
      }
    }
  };

  /**
   * Publishes a claim as the next generation after `after`, atomically.
   *
   * @returns the generation now held, or `null` where a concurrent publish
   *   beat this one to the same number — the caller re-reads and retries.
   */
  const publish = async (
    dir: string,
    after: number,
    claim: ReaderClaim,
  ): Promise<number | null | 'failed'> => {
    const generation = after + 1;
    const scratch = join(dir, `.${claim.pid}.${Math.trunc(claim.at)}.${generation}.tmp`);
    try {
      await ensureDir(dir);
      await writeFile(scratch, encodeClaim({ ...claim, generation }), { encoding: 'utf8' });
    } catch {
      return 'failed';
    }
    try {
      await link(scratch, join(dir, `owner.${generation}`));
      return generation;
    } catch (error) {
      if (!isTaken(error)) return 'failed';
      return null;
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
      const dir = await lockDirOf(key);
      if (dir === null) return failed<ReaderClaim | null>();
      try {
        const highest = await highestClaim(dir);
        return answered(highest === null || highest.claim.released === true ? null : highest.claim);
      } catch {
        return failed<ReaderClaim | null>();
      }
    },

    elect: async (key: string, claim: ReaderClaim): Promise<PortResult<'elected' | 'held'>> => {
      const dir = await lockDirOf(key);
      if (dir === null) return failed<'elected' | 'held'>();
      // A BOUNDED RETRY, NOT A LOOP WITHOUT END. Each attempt reads the current
      // highest generation and publishes one past it; a concurrent publisher
      // landing the same number is the only way `publish` answers null, and a
      // handful of attempts is enough for that race to resolve on a single
      // filesystem.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        let highest: { generation: number; claim: ReaderClaim } | null;
        try {
          highest = await highestClaim(dir);
        } catch {
          return failed<'elected' | 'held'>();
        }
        if (highest !== null && highest.claim.pid === claim.pid && highest.claim.released !== true) {
          // RENEWAL: rename onto this holder's own generation, then confirm no
          // takeover linked past it between the read and the rename.
          if (!(await replaceOwn(dir, highest.generation, liveClaim(claim)))) {
            return failed<'elected' | 'held'>();
          }
          let after: { generation: number; claim: ReaderClaim } | null;
          try {
            after = await highestClaim(dir);
          } catch {
            return failed<'elected' | 'held'>();
          }
          const still = after !== null && after.generation === highest.generation;
          return answered<'elected' | 'held'>(still ? 'elected' : 'held');
        }
        if (highest !== null && highest.claim.pid !== claim.pid) {
          const alive = pidAlive(highest.claim.pid);
          // NO `ps` READ HERE, SO THE HELD CLAIM'S LIVE START TIME IS `null`.
          // `pidAlive` answers only alive/dead over `process.kill(pid, 0)`; it
          // cannot say WHEN the pid it found started, so the skew check in
          // `readerIsStale` is skipped and staleness falls through to the age
          // bound alone — the same "unreadable keeps the claim" reading
          // `readerIsStale` already gives a `null` start time.
          if (!readerIsStale(highest.claim, alive, null, claim.at)) {
            return answered<'elected' | 'held'>('held');
          }
        }
        const after = highest === null ? 0 : highest.generation;
        const published = await publish(dir, after, liveClaim(claim));
        if (published === 'failed') return failed<'elected' | 'held'>();
        if (published !== null) {
          await prune(dir, published);
          return answered<'elected' | 'held'>('elected');
        }
        // Lost the race for this generation number; re-read and retry.
      }
      return failed<'elected' | 'held'>();
    },

    release: async (key: string, pid: number): Promise<PortResult<void>> => {
      const dir = await lockDirOf(key);
      if (dir === null) return failed<void>();
      let highest: { generation: number; claim: ReaderClaim } | null;
      try {
        highest = await highestClaim(dir);
      } catch {
        return failed<void>();
      }
      // ONLY THE CURRENT GENERATION, AND ONLY IF IT IS STILL THIS PROCESS'S.
      // A lock already taken over by a new generation is left to its new
      // holder. A claim already released is left as it is.
      if (highest === null || highest.claim.pid !== pid || highest.claim.released === true) {
        return answered(undefined);
      }
      const released: ReaderClaim = { ...highest.claim, released: true };
      return (await replaceOwn(dir, highest.generation, released)) ? answered(undefined) : failed<void>();
    },

    readerState: async (key: string): Promise<PortResult<ReaderState | null>> => {
      const indexDir = await indexDirOf();
      if (indexDir === null) return failed<ReaderState | null>();
      const path = readerStateFileFor(indexDir, key);
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        if (isMissing(error)) return answered(null);
        return failed<ReaderState | null>();
      }
      return answered(decodeReaderState(text));
    },

    writeReaderState: async (key: string, state: ReaderState): Promise<PortResult<void>> => {
      const indexDir = await indexDirOf();
      if (indexDir === null) return failed<void>();
      const path = readerStateFileFor(indexDir, key);
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await ensureDir(indexDir);
        await writeFile(temp, encodeReaderState(state), { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },

    heartbeat: async (key: string, name: string, at: number): Promise<PortResult<void>> => {
      const dir = await lockDirOf(key);
      if (dir === null) return failed<void>();
      const path = join(dir, name);
      const temp = join(dir, `.${name}.${process.pid}.tmp`);
      try {
        await ensureDir(dir);
        await writeFile(temp, `${Math.trunc(at)}\n`, { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },

    removeHeartbeat: async (key: string, name: string): Promise<PortResult<void>> => {
      const dir = await lockDirOf(key);
      if (dir === null) return failed<void>();
      try {
        await unlink(join(dir, name));
        return answered(undefined);
      } catch (error) {
        return isMissing(error) ? answered(undefined) : failed<void>();
      }
    },

    heartbeats: async (key: string): Promise<PortResult<readonly { name: string; at: number }[]>> => {
      const dir = await lockDirOf(key);
      if (dir === null) return failed<readonly { name: string; at: number }[]>();
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if (isMissing(error)) return answered<readonly { name: string; at: number }[]>([]);
        return failed<readonly { name: string; at: number }[]>();
      }
      const beats: { name: string; at: number }[] = [];
      for (const name of names) {
        if (name === 'fleetd' || /^(board|reader)\.\d+$/.test(name)) {
          let text: string;
          try {
            text = await readFile(join(dir, name), 'utf8');
          } catch {
            continue;
          }
          const at = Number(text.trim());
          if (Number.isFinite(at)) beats.push({ name, at });
        }
      }
      return answered<readonly { name: string; at: number }[]>(beats);
    },
  };
};
