import {
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * A log the WRITING process owns, rotated by size.
 *
 * **THE WRITER ROTATES BECAUSE ONLY THE OPENER CAN.** launchd opens
 * `registryd.log` and `registryd.err` through the unit's `StandardOutPath` and
 * `StandardErrorPath`; `plot-boardctl.sh` opens `board.log` with `>>` before it
 * `exec`s the board; and a hand-started `nohup … >> registryd.log` loop exists
 * too. A writer that inherited its descriptor FOLLOWS THE INODE across a rename
 * and never creates the new name, so external rotation — `newsyslog`,
 * `logrotate`, a person's `mv` — cannot work: measured 2026-09-30,
 * `registryd.log` reached 131 MB in 13 days and a person rotated it by hand,
 * after which the daemon kept writing into the renamed file.
 *
 * So the process opens the file itself, by path. It then holds both the
 * descriptor and the name, which is what lets it close, rename and reopen.
 *
 * **THE BOUND IS ON BYTES, NOT TICKS OR DAYS.** Tick size ranged from 290 bytes
 * to 10 KB with the estate: 13,342 ticks filled 131 MB when a tick listed every
 * held branch, and 5,944 ticks filled 1.7 MB once it printed counts. A bound in
 * ticks describes neither.
 */

/** The default size bound: 10 MB. */
export const LOG_MAX_BYTES = 10 * 1024 * 1024;

/**
 * How many rotated generations are kept: `.1`, `.2`, `.3`.
 *
 * The fourth is deleted. Three generations at the bound is 40 MB including the
 * live file, against the 131 MB one unrotated file reached.
 */
export const LOG_KEPT_GENERATIONS = 3;

/** The seams a test needs, and a caller never sets. */
export interface ProcessLogOptions {
  /** The size at which the live file rotates; defaults to {@link LOG_MAX_BYTES}. */
  maxBytes?: number;
  /** How many rotated files to keep; defaults to {@link LOG_KEPT_GENERATIONS}. */
  kept?: number;
}

/** A log this process writes and rotates. */
export interface ProcessLog {
  /** Appends one string, rotating first where the file has reached the bound. */
  write: (text: string) => void;
  /** Closes the descriptor. A closed log reopens on the next write. */
  close: () => void;
}

/**
 * Shifts the rotated generations up and deletes the one that falls off the end.
 *
 * FROM THE OLDEST DOWN, so no rename overwrites a file still needed: `.3` goes,
 * then `.2` becomes `.3`, then `.1` becomes `.2`.
 *
 * @param path - the live file's path.
 * @param kept - how many rotated generations to keep.
 */
const shift = (path: string, kept: number): void => {
  for (let index = kept; index >= 1; index -= 1) {
    const from = `${path}.${index}`;
    if (!existsSync(from)) continue;
    if (index === kept) {
      // THE FOURTH IS DELETED BY NAME, never by a glob: this is the one path
      // this function holds, and a pattern over the directory could match a log
      // belonging to something else.
      rmSync(from, { force: true });
      continue;
    }
    renameSync(from, `${path}.${index + 1}`);
  }
};

/**
 * Truncates an inherited descriptor that has passed the bound.
 *
 * **SAFE ONLY BECAUSE EVERY OPENER USES `O_APPEND`**, measured with `lsof +fg`
 * on all four live descriptors: launchd's two, `plot-boardctl.sh`'s redirect and
 * a hand-started loop's. An `O_APPEND` writer re-seeks to the end on every
 * write, so a truncated file is simply short. Under a plain `>` writer the
 * offset survives the truncate and the next write leaves a hole of NUL bytes —
 * measured at 415 bytes in round 2.
 *
 * It runs AT START and nowhere else. After the writer below opens its own file,
 * the inherited descriptor carries only what was printed before that and crash
 * traces, which is why the unit keeps `StandardOutPath` and `StandardErrorPath`.
 *
 * @param fd - the inherited descriptor, normally 1 or 2.
 * @param maxBytes - the size above which it is truncated.
 */
export const truncateInherited = (fd: number, maxBytes: number = LOG_MAX_BYTES): void => {
  try {
    const stat = fstatSync(fd);
    // A PIPE OR A TERMINAL IS NOT A FILE AND IS LEFT ALONE. Only a regular file
    // has a size this bound describes, and truncating a pipe is meaningless.
    if (!stat.isFile()) return;
    if (stat.size <= maxBytes) return;
    ftruncateSync(fd, 0);
  } catch {
    // NEVER FAILS ITS CALLER. This runs beside a process starting up, and a
    // descriptor that cannot be measured must not stop the daemon.
  }
};

/**
 * Opens a log this process owns, and rotates it at a size bound.
 *
 * The file is opened with `O_APPEND` (`'a'`), so this writer is safe beside any
 * other holding the same inode — and the rotation is what makes it the only one
 * that matters.
 *
 * ROTATION IS CHECKED BEFORE EACH WRITE, from the descriptor's own `fstat`
 * rather than from a counter. A counter loses whatever the file already held
 * when the process started, which on a restart after a crash is the whole file.
 *
 * @param path - the log's path; its directory is created.
 * @param options - the size bound and how many generations to keep, for tests.
 * @returns a writer that rotates, and closes on request.
 */
export const processLog = (path: string, options: ProcessLogOptions = {}): ProcessLog => {
  const maxBytes = options.maxBytes ?? LOG_MAX_BYTES;
  const kept = options.kept ?? LOG_KEPT_GENERATIONS;
  let fd: number | null = null;

  const open = (): number | null => {
    if (fd !== null) return fd;
    try {
      mkdirSync(dirname(path), { recursive: true });
      fd = openSync(path, 'a');
      return fd;
    } catch {
      return null;
    }
  };

  const rotate = (): void => {
    try {
      if (fd !== null) {
        closeSync(fd);
        fd = null;
      }
      shift(path, kept);
      renameSync(path, `${path}.1`);
    } catch {
      // A ROTATION THAT FAILS COSTS DISK, NEVER A LINE. The reopen below writes
      // to whatever name is there, so a log that could not be renamed keeps
      // growing and keeps its content.
    }
  };

  return {
    write: (text: string): void => {
      const handle = open();
      if (handle === null) {
        // NO LOG IS NOT NO OUTPUT. A file that cannot be opened falls back to
        // the inherited descriptor, which is where this output went before the
        // writer existed.
        process.stdout.write(text);
        return;
      }
      try {
        const size = fstatSync(handle).size;
        if (size >= maxBytes) {
          rotate();
          const reopened = open();
          if (reopened === null) {
            process.stdout.write(text);
            return;
          }
          writeSync(reopened, text);
          return;
        }
        writeSync(handle, text);
      } catch {
        // A WRITE THAT THROWS IS REPORTED NOWHERE, because the thing that would
        // report it is this function. Losing a log line must not end a tick.
      }
    },

    close: (): void => {
      if (fd === null) return;
      try {
        closeSync(fd);
      } catch {
        // Nothing to do: the descriptor is going away with the process.
      }
      fd = null;
    },
  };
};

/**
 * The size of a file, or 0 where it is not there.
 *
 * ABSENT IS NOT AN ERROR: a log that has never been written has no size, which
 * is the state of every fresh checkout.
 *
 * @param path - the file to measure.
 * @returns its size in bytes, or 0.
 */
export const sizeOf = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

/** Where a repository's logs live. */
export const logDir = (repoRoot: string): string => join(repoRoot, '.plot', 'logs');
