import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import {
  decodeDefaultBranch,
  encodeDefaultBranch,
  type DefaultBranchReading,
} from '../../entities/default-branch.js';
import type { StateHome } from '../../entities/state-home.js';
import type { DefaultBranchStore } from '../../ports/default-branch.js';

/** Where the reading lives under a state home. */
export const defaultBranchPath = (home: StateHome): string =>
  join(home, '.plot', 'state', 'default-branch.json');

/**
 * Keeps the default-branch reading in `.plot/state/default-branch.json`.
 *
 * @param home - the state home the file lives under.
 * @returns a `DefaultBranchStore` over that one file.
 */
export const defaultBranchFile = (home: StateHome): DefaultBranchStore => {
  const path = defaultBranchPath(home);
  return {
    read: async (): Promise<PortResult<DefaultBranchReading | null>> => {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        // No file is no reading, which is an answer; any other error is a failure.
        if ((error as { code?: string }).code === 'ENOENT') return answered(null);
        return failed<DefaultBranchReading | null>();
      }
      return answered(decodeDefaultBranch(text));
    },

    write: async (reading: DefaultBranchReading): Promise<PortResult<void>> => {
      // Whole or not at all: the rename is atomic within a directory.
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, encodeDefaultBranch(reading), { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};

/** The suffix of a base's repair record file; a base whose last segment ends in it would share a reading path with another base's record. */
export const BASE_REPAIR_SUFFIX = '.repair';

/**
 * Whether a base branch name is safe to use as a file name segment path.
 *
 * Refuses an empty, `.` or `..` segment, and a last segment ending in
 * {@link BASE_REPAIR_SUFFIX}.
 */
export const validBase = (base: string): boolean =>
  base !== '' &&
  base.split('/').every((part) => part !== '' && part !== '..' && part !== '.') &&
  !(base.split('/').pop() as string).endsWith(BASE_REPAIR_SUFFIX);

/** Where the repair record for a base branch lives under a state home. */
export const baseRepairPath = (home: StateHome, base: string): string =>
  join(home, '.plot', 'state', 'base-branches', `${base}${BASE_REPAIR_SUFFIX}.json`);

/** Where the reading for a base branch lives under a state home. */
export const baseBranchPath = (home: StateHome, base: string): string =>
  join(home, '.plot', 'state', 'base-branches', `${base}.json`);

/**
 * Keeps the reading of a PR base branch in `.plot/state/base-branches/<base>.json`.
 *
 * A base with an empty, `.` or `..` segment has no file: it reads as no reading
 * and refuses a write. A file whose `branch` is not `base` reads as no reading.
 *
 * @param home - the state home the file lives under.
 * @param base - the base branch the reading is kept for.
 * @returns a `DefaultBranchStore` over that one file.
 */
export const baseBranchFile = (home: StateHome, base: string): DefaultBranchStore => {
  if (!validBase(base)) {
    return {
      read: async () => answered<DefaultBranchReading | null>(null),
      write: async () => failed<void>(),
    };
  }
  const path = baseBranchPath(home, base);
  return {
    read: async (): Promise<PortResult<DefaultBranchReading | null>> => {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return answered(null);
        return failed<DefaultBranchReading | null>();
      }
      const reading = decodeDefaultBranch(text);
      return answered(reading !== null && reading.branch === base ? reading : null);
    },
    write: async (reading: DefaultBranchReading): Promise<PortResult<void>> => {
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, encodeDefaultBranch(reading), { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};

/**
 * Names the base branches that hold a reading file.
 *
 * Walks `.plot/state/base-branches/` and returns each `<base>.json` path
 * relative to it, without the extension: `sprint/x` for `sprint/x.json`.
 * Temporary `.tmp` files and `<base>.repair.json` repair records are not names.
 *
 * @param home - the state home the files live under.
 * @returns the names, or `failed` where the directory could not be read; a
 *   missing directory answers an empty list.
 */
export const baseBranchNames = async (home: StateHome): Promise<PortResult<readonly string[]>> => {
  const root = join(home, '.plot', 'state', 'base-branches');
  const walk = async (dir: string, prefix: string): Promise<string[]> => {
    const names: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) names.push(...(await walk(join(dir, entry.name), `${prefix}${entry.name}/`)));
      else if (entry.name.endsWith('.json') && !entry.name.endsWith(`${BASE_REPAIR_SUFFIX}.json`)) names.push(`${prefix}${entry.name.slice(0, -'.json'.length)}`);
    }
    return names;
  };
  try {
    return answered(await walk(root, ''));
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return answered<readonly string[]>([]);
    return failed<readonly string[]>();
  }
};

/**
 * Deletes the reading file of one base branch, and only that file.
 *
 * The directory that held it stays. A base with an empty, `.` or `..` segment
 * has no file and is refused.
 *
 * @param home - the state home the file lives under.
 * @param base - the base branch whose reading is removed.
 * @returns `answered` where the file is gone or never existed, `failed` otherwise.
 */
export const removeBaseBranch = async (home: StateHome, base: string): Promise<PortResult<void>> => {
  if (!validBase(base)) return failed<void>();
  try {
    await rm(baseBranchPath(home, base), { force: true });
    return answered(undefined);
  } catch {
    return failed<void>();
  }
};

/**
 * Deletes the repair record of one base branch, and only that file.
 *
 * @param home - the state home the file lives under.
 * @param base - the base branch whose record is removed.
 * @returns `answered` where the file is gone or never existed, `failed` for an invalid base or an error.
 */
export const removeBaseRepair = async (home: StateHome, base: string): Promise<PortResult<void>> => {
  if (!validBase(base)) return failed<void>();
  try {
    await rm(baseRepairPath(home, base), { force: true });
    return answered(undefined);
  } catch {
    return failed<void>();
  }
};
