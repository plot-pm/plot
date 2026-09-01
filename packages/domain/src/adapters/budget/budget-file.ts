import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import {
  encodeEntry,
  withinLineCap,
  type BudgetEntry,
} from '../../entities/budget.js';
import type { BudgetRecord } from '../../ports/budget.js';

/**
 * The environment variable that names the record's directory.
 *
 * ONE OVERRIDE, AND DELIBERATELY NOT THE XDG PAIR. `XDG_STATE_HOME` looks like
 * the right convention and is the wrong one here: it is set in some shells and
 * not others, so two checkouts on one computer could resolve two different
 * files — which is precisely the split this slice exists to close, reintroduced
 * by a standard. A single variable is either set for everything on the computer
 * or set for nothing.
 *
 * Its real job is tests. A suite that wrote to the operator's own record would
 * be measuring their GitHub budget.
 */
export const BUDGET_HOME_ENV = 'PLOT_BUDGET_HOME';

/** The record's directory under the home directory, mirroring per-checkout `.plot/state/`. */
const HOME_SUBDIR = join('.plot', 'state');

/**
 * The record's filename.
 *
 * ONE FILE FOR EVERY BUDGET, not one per key. The key is in each line, and a
 * file per `(connector, account, bucket)` would make the read that derives a
 * rate a directory scan whose cost grows with the number of buckets ever seen —
 * including the dead ones, which is the growth the window exists to bound.
 */
const FILE = 'budget.tsv';

/** The seams the adapter needs so a test never touches the operator's own record. */
export interface BudgetFileOptions {
  /** Where the record's directory is; defaults to `$PLOT_BUDGET_HOME` or `~/.plot/state`. */
  home?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/**
 * Resolves the record's directory, without touching the disk.
 *
 * THE ANSWER MUST NOT DEPEND ON WHICH CHECKOUT ASKS. Nothing here reads a
 * repository root, a git directory or a working directory — that absence is the
 * fix. Measured 2026-09-01: two GitHub checkouts on this computer share the
 * account `jwloka`, and a per-checkout path let each read a full 5000 while the
 * other spent it.
 *
 * @param options - an explicit home, or the environment to read one from.
 * @returns the directory, or null where no home directory can be resolved.
 */
const homeFor = (options: BudgetFileOptions): string | null => {
  if (options.home !== undefined && options.home !== '') return options.home;
  const env = options.env ?? process.env;
  const override = env[BUDGET_HOME_ENV];
  if (override !== undefined && override !== '') return override;
  const home = homedir();
  return home === '' ? null : join(home, HOME_SUBDIR);
};

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/**
 * Reads and appends the budget record in a file outside every checkout.
 *
 * APPEND-ONLY, LOCK-FREE, AND THAT RESTS ON A MEASUREMENT. `appendFile` opens
 * with `O_APPEND`, whose concurrency guarantee holds only below `PIPE_BUF` —
 * **512 bytes** as `getconf PIPE_BUF /` reports on this fleet's macOS machines,
 * not the 4096 the plan and the design spec both stated. So every line is
 * checked against `withinLineCap` before it is written, and an over-long line is
 * refused rather than torn: a torn line loses the concurrent writer's line too.
 *
 * @param options - an explicit home or environment, for tests.
 * @returns a `BudgetRecord` backed by one file per computer.
 */
export const budgetFile = (options: BudgetFileOptions = {}): BudgetRecord => {
  const pathOf = (): string | null => {
    const home = homeFor(options);
    return home === null ? null : join(home, FILE);
  };

  return {
    location: (): PortResult<string> => {
      const path = pathOf();
      return path === null ? failed<string>() : answered(path);
    },

    append: async (entry: BudgetEntry): Promise<PortResult<void>> => {
      const path = pathOf();
      if (path === null) return failed<void>();
      const line = encodeEntry(entry);
      // REFUSED, NOT TRUNCATED. Shortening the line would write a spend against
      // a key nobody can read back, which is worse than not recording it.
      if (!withinLineCap(line)) return failed<void>();
      try {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, line, { encoding: 'utf8' });
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },

    lines: async (): Promise<PortResult<readonly string[]>> => {
      const path = pathOf();
      if (path === null) return failed<readonly string[]>();
      try {
        const text = await readFile(path, 'utf8');
        return answered(text.split('\n').filter((line) => line !== ''));
      } catch (error) {
        // A MISSING FILE IS AN EMPTY RECORD. The first spender creates it, so
        // absence is the state of every computer that has not spent yet — and
        // reporting that as `failed` would make a fresh checkout look broken.
        // Every other error stays `failed`: a caller must not read an
        // unreadable file as an empty window.
        if (isMissing(error)) return answered([]);
        return failed<readonly string[]>();
      }
    },

    truncate: async (keep: readonly BudgetEntry[]): Promise<PortResult<void>> => {
      const path = pathOf();
      if (path === null) return failed<void>();
      const text = keep.map(encodeEntry).join('');
      // WRITTEN ASIDE AND RENAMED, so a reader never sees a half-written record.
      // `rename` is atomic within a filesystem, which is why the temporary file
      // sits beside the record rather than in a temp directory.
      //
      // A CONCURRENT APPEND CAN STILL BE LOST HERE, and that is accepted rather
      // than overlooked: the lost line is one spend out of the ~1,160 an hour
      // measured 2026-09-01, the window filter is what makes the answer right,
      // and the alternative is the lock the append-only design exists to avoid.
      const scratch = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(scratch, text, { encoding: 'utf8' });
        await rename(scratch, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};
