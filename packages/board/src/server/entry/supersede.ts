import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { supersedePlan, supersessionContext, type SupersedeArgs } from './supersession.js';
import type { Printer } from './ladder.js';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * The `node` entry point that marks a plan Superseded by another plan.
 *
 * ```
 * plot-supersede.mjs [--who <name>] --by <successor-slug> <slug>
 * ```
 *
 * Runs `supersedePlan` (`supersession.ts`), which asks the domain's `supersede`
 * transition and books the result on the default branch through a booking
 * worktree on `plot/supersede-<slug>`: it writes `State: Superseded` and the
 * dated `Superseded:` record, moves the index link from the active index to
 * the delivered index, leaves the state receipt `plot-state-gate.sh` reads,
 * commits and pushes.
 *
 * A person makes this move. The entry refuses under `PLOT_UNATTENDED=1` before
 * it reads anything, and no flag lifts that refusal.
 *
 * Exit 0 when the plan is Superseded, whether this run wrote it or not. Exit 1
 * on a refusal or a failure, with the reason on stderr.
 */

/** The usage block `-h` prints. */
const USAGE = [
  '# Plot helper: mark a plan Superseded by the plan that replaces it.',
  '# Usage: plot-supersede.mjs [--who <name>] --by <successor-slug> <slug>',
  '#   --who   the name the booking commit carries (default: git user.name)',
  '#   --by    the slug of the plan that replaces this one; it must name a plan file',
  '#   <slug>  the plan to supersede',
  '# Output: one `step:` line per step, then a machine-countable summary:',
  '#             summary: phase=flipped record=written index=moved push=clean',
  '#         Exit 0 when the plan is Superseded; 1 on a refusal or a failure,',
  '#         with the reason on stderr.',
  '#',
].join('\n');

/** Parses argv; returns the message to refuse with, or `__help__`. */
export const parseArgs = (argv: readonly string[]): SupersedeArgs | string => {
  let who = '';
  let by = '';
  let slug = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--who') {
      who = argv[++i] ?? '';
      if (who === '' || who.startsWith('-')) return `--who takes a name, not '${who}'`;
    } else if (arg === '--by') {
      by = argv[++i] ?? '';
      if (by === '' || by.startsWith('-')) return `--by takes the successor's slug, not '${by}'`;
    } else if (arg === '-h' || arg === '--help') return '__help__';
    else if (arg.startsWith('-')) return `unknown flag '${arg}'`;
    else slug = arg;
  }
  if (slug === '' || by === '') return 'need a plan slug and its successor (usage: plot-supersede.mjs [--who <name>] --by <successor-slug> <slug>)';
  return { who, by, slug };
};

/**
 * Parses argv, reads the plan and its successor, and marks the plan Superseded.
 *
 * @param argv - the arguments after the script name.
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where step and summary lines go.
 * @param warn - where refusals go.
 * @param env - the process environment; only `PLOT_UNATTENDED` is read.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  cwd: string,
  scriptDir: string,
  write: Printer = (s) => process.stdout.write(s),
  warn: Printer = (s) => process.stderr.write(s),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> => {
  // A person makes this move, so the refusal comes before any argument or file is read.
  if (env.PLOT_UNATTENDED === '1') {
    warn('plot-supersede: a person marks a plan Superseded, and this process runs under PLOT_UNATTENDED=1.\n  Refusing: the fleet never decides this. Run it from a session.\n');
    return 1;
  }
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    if (parsed === '__help__') {
      write(`${USAGE}\n`);
      return 0;
    }
    warn(`plot-supersede: ${parsed}\n`);
    return 1;
  }

  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn("plot-supersede: not a git repository — run this from inside the checkout, or 'git init' one here\n");
    return 1;
  }
  const outcome = await supersedePlan(supersessionContext(probe.value, scriptDir), parsed, write, env);
  if (outcome.outcome === 'superseded') return 0;
  warn(`plot-supersede: ${outcome.detail}\n`);
  return 1;
};

// Runs only when launched as a program; a test imports `run` without starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
