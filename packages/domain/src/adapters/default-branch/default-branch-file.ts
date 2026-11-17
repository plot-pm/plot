import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import {
  decodeDefaultBranch,
  encodeDefaultBranch,
  type DefaultBranchReading,
} from '../../entities/default-branch.js';
import type { DefaultBranchStore } from '../../ports/default-branch.js';

/** Where the reading lives under a repository root. */
export const defaultBranchPath = (repoRoot: string): string =>
  join(repoRoot, '.plot', 'state', 'default-branch.json');

/**
 * Keeps the default-branch reading in `.plot/state/default-branch.json`.
 *
 * @param repoRoot - the repository the file belongs to.
 * @returns a `DefaultBranchStore` over that one file.
 */
export const defaultBranchFile = (repoRoot: string): DefaultBranchStore => {
  const path = defaultBranchPath(repoRoot);
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

/** Whether a base branch name is safe to use as a file name segment path. */
const validBase = (base: string): boolean => base !== '' && base.split('/').every((part) => part !== '' && part !== '..' && part !== '.');

/** Where the reading for a base branch lives under a repository root. */
export const baseBranchPath = (repoRoot: string, base: string): string =>
  join(repoRoot, '.plot', 'state', 'base-branches', `${base}.json`);

/**
 * Keeps the reading of a PR base branch in `.plot/state/base-branches/<base>.json`.
 *
 * A base with an empty, `.` or `..` segment has no file: it reads as no reading
 * and refuses a write. A file whose `branch` is not `base` reads as no reading.
 *
 * @param repoRoot - the repository the file belongs to.
 * @param base - the base branch the reading is kept for.
 * @returns a `DefaultBranchStore` over that one file.
 */
export const baseBranchFile = (repoRoot: string, base: string): DefaultBranchStore => {
  if (!validBase(base)) {
    return {
      read: async () => answered<DefaultBranchReading | null>(null),
      write: async () => failed<void>(),
    };
  }
  const path = baseBranchPath(repoRoot, base);
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
