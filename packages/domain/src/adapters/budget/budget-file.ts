import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { encodeEntry, withinLineCap, type BudgetEntry } from '../../entities/budget.js';
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

/**
 * The previous generation, and the generation counter.
 *
 * TWO GENERATIONS, BOUNDED BY RENAME. A rotation renames `budget.tsv` over
 * `budget.tsv.1`; a reader reads both, so an append that races the rename lands
 * in one of them and is never missed. `budget.gen` is the counter a reader
 * checks before and after its read — the writer's half lives in
 * `plot-budget.sh`, which is what rotates.
 */
const PREVIOUS_FILE = `${FILE}.1`;

/** The generation counter's filename. */
const GEN_FILE = 'budget.gen';

/**
 * How many times a read may be taken again before it answers from its last pass.
 *
 * Matches `BUDGET_READ_RETRIES` in `plot-budget.sh`. An answer taken across a
 * rotation reads the live generation twice, so it can only OVER-count — which
 * makes a caller more cautious and never less.
 */
const READ_RETRIES = 3;

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
 * One generation's lines, or null where it could not be read.
 *
 * A MISSING GENERATION IS AN EMPTY ONE, not a failure: `budget.tsv.1` is absent
 * until the first rotation and `budget.tsv` is absent between a rotation and the
 * next append, so both are normal states on a working machine. Every other error
 * is null, and the caller answers `failed` — a reader must not take an
 * unreadable file for an empty window.
 *
 * @param path - the generation's file.
 * @returns its non-empty lines, or null where the file exists and cannot be read.
 */
const generationLines = async (path: string): Promise<readonly string[] | null> => {
  try {
    const text = await readFile(path, 'utf8');
    return text.split('\n').filter((line) => line !== '');
  } catch (error) {
    if (isMissing(error)) return [];
    return null;
  }
};

/**
 * The generation counter.
 *
 * A MISSING OR UNREADABLE COUNTER READS AS 0, which is even, so a machine that
 * has never rotated reads its record in one pass. Reporting absence as a failure
 * would make an unrotated ledger look broken.
 *
 * @param path - the counter's file.
 * @returns the counter, or 0.
 */
const generation = async (path: string): Promise<number> => {
  try {
    const text = (await readFile(path, 'utf8')).trim();
    if (!/^\d+$/.test(text)) return 0;
    return Number(text);
  } catch {
    return 0;
  }
};

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
 * BOUNDED BY ROTATION, WHICH THIS DOES NOT PERFORM. `plot-budget.sh` rotates,
 * because it is what every appender already runs; this reads both generations
 * under the counter the rotator publishes. The adapter once carried a
 * `truncate()` that rewrote the record from a reader's live set, and it lost 59
 * of 600 concurrent appends when measured.
 *
 * @param options - an explicit home or environment, for tests.
 * @returns a `BudgetRecord` backed by two generations per computer.
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
      const home = homeFor(options);
      if (home === null) return failed<readonly string[]>();
      const current = join(home, FILE);
      const previous = join(home, PREVIOUS_FILE);
      const gen = join(home, GEN_FILE);

      // CURRENT FIRST, THEN PREVIOUS, and the order is the correctness argument
      // rather than a convention. A rotation between the two reads makes the
      // reader see the old current generation twice: it counts that generation
      // twice and never misses it, and the counter check below discards the
      // answer. The reverse order skips the whole live generation — measured,
      // the shell reader read `spent` 0 for it.
      let last: readonly string[] | null = null;
      for (let attempt = 0; attempt <= READ_RETRIES; attempt += 1) {
        const before = await generation(gen);
        // AN ODD COUNTER MEANS A ROTATION IS IN PROGRESS, or a rotator died.
        // Recovery is the shell's, which owns the lock; a reader takes the read
        // again and, once out of attempts, answers from its last pass.
        if (before % 2 === 1 && attempt < READ_RETRIES) continue;

        const head = await generationLines(current);
        const tail = await generationLines(previous);
        if (head === null || tail === null) return failed<readonly string[]>();
        last = [...head, ...tail];

        const after = await generation(gen);
        if (after === before && after % 2 === 0) return answered(last);
      }
      // THE LAST READ, which can only over-count. A read that never settled is
      // still an answer, and refusing here would report an unreadable record on
      // a machine whose record is merely busy.
      return answered(last ?? []);
    },

  };
};
