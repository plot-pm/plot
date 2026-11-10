import { gitVersionRefusal } from '../../rules/git-version.js';
import { processAnswers, type FixedAnswers } from '../git-dirs/git-dirs.js';
import { runProcess } from '../run-script.js';
import { objectsBatch, type ObjectsBatch } from './objects-batch.js';

/** The object readers one process holds, keyed by the common git directory they read. */
export interface ObjectReaders {
  /**
   * Holds `reader` for `commonDir`, closing the reader held before it.
   *
   * @param commonDir - the absolute common git directory, as `rev-parse --path-format=absolute --git-common-dir` prints it.
   * @param reader - the reader to answer that repository's object reads.
   */
  install: (commonDir: string, reader: ObjectsBatch) => void;
  /**
   * @param commonDir - as for {@link ObjectReaders.install}.
   * @returns the reader held for `commonDir`, or undefined where none is.
   */
  readerFor: (commonDir: string) => ObjectsBatch | undefined;
  /** @returns true where no reader is held, so a caller asks for no git directory. */
  empty: () => boolean;
  /**
   * Closes and forgets the reader held for `commonDir`; a directory with none is no error.
   *
   * @param commonDir - as for {@link ObjectReaders.install}.
   */
  remove: (commonDir: string) => void;
}

/**
 * Builds an empty holder of object readers.
 *
 * @returns the holder.
 */
export const objectReaders = (): ObjectReaders => {
  const held = new Map<string, ObjectsBatch>();
  const remove = (commonDir: string): void => {
    held.get(commonDir)?.close();
    held.delete(commonDir);
  };
  return {
    install: (commonDir, reader) => {
      if (held.get(commonDir) !== reader) remove(commonDir);
      held.set(commonDir, reader);
    },
    readerFor: (commonDir) => held.get(commonDir),
    empty: () => held.size === 0,
    remove,
  };
};

/**
 * The object readers this process holds. `refsGit` reads through it unless a
 * caller hands it another holder. Only fleetd and the board server install a
 * reader; every other process holds none and starts one `git` per read.
 */
export const processObjects: ObjectReaders = objectReaders();

/** What {@link installObjectsReader} did. */
export type ObjectsInstall =
  | { installed: true; commonDir: string; reader: ObjectsBatch }
  | {
      installed: false;
      /** `git-version` for a git older than 2.42 or one that did not answer; `no-git-directory` where git named none. */
      why: 'git-version' | 'no-git-directory';
      refusal: string;
    };

/** Where {@link installObjectsReader} reads and what it installs into. */
export interface InstallObjectsOptions {
  /** The held git-directory answers; this process's own by default. */
  answers?: FixedAnswers;
  /** The holder to install into; {@link processObjects} by default. */
  readers?: ObjectReaders;
  /** The per-request bound handed to the reader; its default when absent. */
  timeoutMs?: number;
}

/**
 * Reads `git --version`, and on git 2.42 or later installs one object reader
 * for the repository at `repoRoot`. The reader starts its process on the first
 * read, not here.
 *
 * @param repoRoot - the checkout whose objects the reader reads.
 * @param options - where to read and what to install into.
 * @returns the installed reader and its key, or the refusal line: for a git
 *   older than 2.42, a git that did not answer, or a checkout whose git
 *   directories git did not name.
 */
export const installObjectsReader = async (
  repoRoot: string,
  options: InstallObjectsOptions = {},
): Promise<ObjectsInstall> => {
  const version = await runProcess('git', ['--version'], { cwd: repoRoot });
  const refusal = gitVersionRefusal(version.code === 0 ? version.stdout : '');
  if (refusal !== null) return { installed: false, why: 'git-version', refusal };
  const dirs = await (options.answers ?? processAnswers).gitDirs(repoRoot);
  const commonDir = dirs.code === 0 ? dirs.stdout.split('\n')[1]?.trim() ?? '' : '';
  if (commonDir === '') return { installed: false, why: 'no-git-directory', refusal: `plot found no git directory for ${repoRoot}` };
  const reader = objectsBatch({ repoRoot, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
  (options.readers ?? processObjects).install(commonDir, reader);
  return { installed: true, commonDir, reader };
};
