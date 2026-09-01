import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import type { BuildBoardOptions } from '../board.js';
import { estateFromEnv } from '../estate.js';
import { askOnce, askOncePerEstate, newMemory, type Question } from './ask.js';

/**
 * The `node` entry point a skill runs.
 *
 * ```
 * node skills/plot/scripts/board/plot-ask.mjs board
 * node skills/plot/scripts/board/plot-ask.mjs fleet
 * node skills/plot/scripts/board/plot-ask.mjs deliverable <slug> <plan-file>
 * ```
 *
 * **A SECOND artifact rather than a flag on the board's.** `index.ts` binds a
 * port the moment it is imported, so a `--json` flag on it would mean a skill
 * that asks a question also starts a server and has to be told to stop. The two
 * entry points share every line below the controller and differ only in who
 * calls it — which is exactly the seam this plan built.
 *
 * The answer goes to stdout as JSON and nothing else does. Diagnostics go to
 * stderr, so a caller can pipe stdout into a parser the way
 * `plot-sprint-candidates.sh` does — the precedent the plan cites, and the same
 * reason it gives: node is already required to run the board and every test
 * suite.
 */

/** Where the plot helper scripts sit, relative to this artifact. */
const scriptsDirFor = (here: string): string =>
  process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..');

/**
 * The configured plan directory, read the way every other helper reads config.
 *
 * Through `plot-config.sh` rather than a second parser: the key has a default
 * and an override, and a duplicate reader is how the two drift. A repo that
 * cannot be asked falls back to the same default the script does.
 */
const planDirFor = (opts: BuildBoardOptions): string => {
  try {
    const out = execFileSync(
      'bash',
      [path.join(opts.scriptsDir, 'plot-config.sh'), 'get', 'Plan directory', 'docs/plans/'],
      { cwd: opts.repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return (out || 'docs/plans/').replace(/\/$/, '');
  } catch {
    return 'docs/plans';
  }
};

/** Everything the entry point needs, assembled from the environment. */
export interface EntryContext {
  opts: BuildBoardOptions;
  planDir: string;
}

/**
 * Assemble the context this process runs in.
 *
 * The same two environment variables the board reads, so a caller that can
 * point the board at a repo can point this at the same one.
 *
 * @param here the directory this artifact sits in
 * @returns the estate options and the configured plan directory
 */
export const contextFrom = (here: string): EntryContext => {
  const opts: BuildBoardOptions = {
    repoRoot: process.env.PLOT_REPO_ROOT ?? process.cwd(),
    scriptsDir: scriptsDirFor(here),
  };
  return { opts, planDir: planDirFor(opts) };
};

/**
 * Parse the one argument this entry point takes.
 *
 * @param argv the process arguments after the script name
 * @returns the question asked, or null when it is not one this answers
 */
export const questionFrom = (argv: string[]): Question | null => {
  const asked = argv[0];
  return asked === 'board' || asked === 'fleet' || asked === 'deliverable' ? asked : null;
};

/**
 * Answer one question and print it.
 *
 * **`askOnce`, not `askOncePerEstate`, and the difference is the point.** One
 * process asking one question has no previous answer to re-use; the memory that
 * makes the gate cheap belongs to the CALLER that asks twice, which is why it
 * is a parameter there rather than a global here. A per-process cache would
 * save nothing and would need a lifetime nobody could state.
 *
 * @param argv the process arguments after the script name
 * @param here the directory this artifact sits in
 * @param write where the answer goes
 * @returns the process exit code
 */
export const run = async (
  argv: string[],
  here: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> => {
  const question = questionFrom(argv);
  if (!question) {
    process.stderr.write('usage: plot-ask.mjs <board|fleet> | deliverable <slug> <plan-file>\n');
    return 2;
  }
  // The plan is named by the CALLER rather than resolved here. `plot-deliver.sh`
  // has already found the file — across three configured directories, with its
  // own refusal when none matches — and re-deriving it would be a second
  // implementation of a lookup that has one, free to disagree about which plan
  // the gate is even about.
  if (question === 'deliverable' && (!argv[1] || !argv[2])) {
    process.stderr.write('usage: plot-ask.mjs deliverable <slug> <plan-file>\n');
    return 2;
  }
  const { opts, planDir } = contextFrom(here);
  // The SAME composition root the board uses, so `PLOT_BOARD_MOCK` works here
  // for the reason it works there: the variable chooses adapters once, and
  // nothing above them can tell which it got.
  // The WHOLE estate, not just its source: `deliverable` is answered by a
  // controller that asks ports, and those ports are chosen by the same
  // composition root — so `PLOT_BOARD_MOCK` reaches this question too.
  const estate = estateFromEnv(opts);
  const answer = await askOnce({
    ports: estate,
    question,
    opts,
    estate: estate.source,
    planDir,
    slug: argv[1],
    planFile: argv[2],
  });
  write(`${JSON.stringify(answer.value)}\n`);
  return 0;
};

// Only when RUN, never when imported — a test importing `run` must not have the
// process exit under it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  // `run` awaits ports now, so the exit code arrives as a promise. Awaiting it
  // at the entry keeps the contract a NUMBER for every other caller.
  void run(process.argv.slice(2), path.dirname(fileURLToPath(import.meta.url)))
    .then((code) => process.exit(code));
}

export { askOnce, askOncePerEstate, newMemory };
