import { sliceSpendFile } from '@plot-pm/domain/adapters';
import { spendSummary } from '@plot-pm/domain/rules/slice-spend-record';
import { readSliceSpend, recordSliceSpend } from '@plot-pm/domain/workflows/slice-spend';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The `node` entry point `plot-worker-loop.sh` runs, once per finished slice.
 *
 * ```
 * node plot-slice-spend.mjs record <worktree> <branch>
 * {"outcome":"recorded","branch":"feature/…","turns":31,"models":["claude-opus-5"]}
 *
 * node plot-slice-spend.mjs read <branch>
 * {"outcome":"measured","summary":"in 2, out 169, …","latest":{…},"runs":1}
 * ```
 *
 * **IT READS THE DISK, WHICH EVERY OTHER ENTRY HERE DELIBERATELY DOES NOT.** The
 * bundles beside it take their readings on stdin from the shell that measured
 * them, and that is right where a reading is a handful of git answers. A
 * transcript is not: the median worker transcript is 6.9 KiB and the largest
 * 7.7 MiB, and handing those to a shell would mean bash parsing JSONL — the one
 * thing `seal_declaration`'s own `node -e` block exists to avoid. So the
 * readings are taken by `sliceSpendFile`, which is the ADAPTER, and the layering
 * rule puts exactly this there: an adapter is the only place that may reach the
 * world.
 *
 * **WRITTEN AT `seal_declaration`, AND THE REASON IS THE SUBJECT RATHER THAN THE
 * COST.** A worker does not exit between slices — it seals, clears the manifest
 * branch, blocks in `wait_for_work`, resets the desk and loops — so a sum taken
 * at worker exit charges every slice the worker ever held to whichever branch it
 * held last; of the 12 largest worker transcripts, 3 already span two branches.
 * `seal_declaration` runs before `--next` is asked and before any hop moves
 * `$PLOT_BRANCH`, so it is the only moment that knows which branch just
 * finished. A full four-counter sum over the largest worker transcript on the
 * estate takes 90–250 ms, so cost is not the argument and this does not make it.
 *
 * **THE BOUND PATH REACHES THIS NOWHERE, AND THAT IS A STATED GAP.**
 * `seal_declaration` runs on one path only — `run_bounded` returned 0 — so a
 * worker killed by the `Worker bound` or ended by the WorkerMonitor never gets
 * here. For a declaration that absence is load-bearing; for a spend it inverts,
 * because a worker that burned the full bound is the most expensive run there
 * is. A rollup over these records is therefore biased LOW in a direction nobody
 * can see from the records alone.
 *
 * **EVERY REFUSAL RECORDS NOTHING RATHER THAN A ZERO.** A recorded zero is
 * indistinguishable from a free run, and a sum over one is wrong in the
 * direction nobody checks.
 */

/** What a `record` run did, as the shell reads it. */
export interface RecordAnswer {
  /** `recorded`, or the refusal's own word. */
  readonly outcome: string;
  /** The branch the record is about. */
  readonly branch: string;
  /** How many turns the sum covered; absent where nothing was recorded. */
  readonly turns?: number;
  /** Every model the branch ran on; absent where nothing was recorded. */
  readonly models?: readonly string[];
}

/** What a `read` run found. */
export interface ReadAnswer {
  /** `measured`, `absent` or `unreadable`. */
  readonly outcome: string;
  /** The branch asked about. */
  readonly branch: string;
  /** The sentence a person reads — *not measured here* where nothing was. */
  readonly summary: string;
  /** How many runs of this branch the record holds. */
  readonly runs: number;
}

/**
 * Sums a desk's transcripts for one branch and appends the record.
 *
 * @param worktree - the desk that finished.
 * @param branch - the branch it held, which the loop knows and the agent may not.
 * @param now - the time to stamp the record with.
 * @returns the answer and the process exit code.
 */
export const record = async (
  worktree: string,
  branch: string,
  now: string,
): Promise<{ answer: RecordAnswer; code: number }> => {
  const written = await recordSliceSpend(sliceSpendFile({ cwd: worktree }), {
    worktree,
    branch,
    at: now,
  });
  if (!written.ok) {
    // EXIT 0 ON EVERY REFUSAL. This runs inside `seal_declaration`, whose own
    // contract is that a declaration it cannot write is left alone rather than
    // failing the seal — and a spend is strictly less load-bearing than the
    // declaration it rides beside. A worker must never end differently because
    // a measurement was unavailable.
    return { answer: { outcome: written.refusal, branch }, code: 0 };
  }
  return {
    answer: {
      outcome: 'recorded',
      branch: written.record.branch,
      turns: written.record.turns,
      models: written.record.models,
    },
    code: 0,
  };
};

/**
 * Reads back what one branch spent, without re-deriving it.
 *
 * **THIS PATH OPENS NO `.jsonl`.** The board re-deriving per refresh would pass
 * every correctness test and reintroduce the cost the record exists to remove.
 *
 * @param branch - the branch to ask about.
 * @param cwd - the checkout to resolve the record for.
 * @returns the answer and the process exit code.
 */
export const read = async (
  branch: string,
  cwd: string,
): Promise<{ answer: ReadAnswer; code: number }> => {
  const found = await readSliceSpend(sliceSpendFile({ cwd }), branch);
  return {
    answer: {
      outcome: found.state,
      branch,
      summary: spendSummary(found),
      runs: found.history.length,
    },
    // 0 MEASURED, 1 NOT MEASURED HERE, 2 THE RECORD ITSELF UNREADABLE — three
    // codes because a caller repairs them differently, and because `absent` and
    // `unreadable` are the distinction this whole reading exists to keep.
    code: found.state === 'measured' ? 0 : found.state === 'absent' ? 1 : 2,
  };
};

/**
 * Run one command.
 *
 * @param argv - the arguments after the script name.
 * @param write - where the answer goes.
 * @param now - the time to stamp a record with.
 * @returns the process exit code; 2 where the arguments were unreadable.
 */
export const run = async (
  argv: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
  now: string = new Date().toISOString(),
): Promise<number> => {
  const [verb, ...rest] = argv;
  if (verb === 'record') {
    const [worktree, branch] = rest;
    if (!worktree || !branch) {
      process.stderr.write('plot-slice-spend: usage: record <worktree> <branch>\n');
      return 2;
    }
    const { answer, code } = await record(worktree, branch, now);
    write(`${JSON.stringify(answer)}\n`);
    return code;
  }
  if (verb === 'read') {
    const [branch, cwd] = rest;
    if (!branch) {
      process.stderr.write('plot-slice-spend: usage: read <branch> [cwd]\n');
      return 2;
    }
    const { answer, code } = await read(branch, cwd || process.cwd());
    write(`${JSON.stringify(answer)}\n`);
    return code;
  }
  process.stderr.write("plot-slice-spend: expected 'record' or 'read'\n");
  return 2;
};

// Only when RUN, never when imported.
//
// `pathToFileURL` rather than a template, for the reason `verdicts.ts` records:
// `import.meta.url` is realpath-resolved and percent-encoded and
// `process.argv[1]` is neither, so on macOS — where `/tmp` is a symlink — a
// bundle invoked from a sandbox compared two spellings of one path, the block
// never ran, and the process exited 0 having written nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exit(await run(process.argv.slice(2)));
}
