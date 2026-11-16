import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { setStoryStatusAt, storyStatusContext, type StoryStatusArgs } from './story-status-move.js';
import type { Printer } from './ladder.js';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * The `node` entry point that moves a story to a status.
 *
 * ```
 * plot-story-status.mjs [--who <name>] <slug> <status>
 * ```
 *
 * Runs `setStoryStatusAt` (`story-status-move.ts`), which asks the domain's
 * `setStoryStatus` transition and books the result on the default branch
 * through a booking worktree on `plot/story-status-<slug>`: it writes the
 * story's front-matter `status:` line, and `archived:` on a move to `done`,
 * commits and pushes. It moves no directory and leaves no state receipt.
 *
 * A person makes this move. The entry refuses under `PLOT_UNATTENDED=1` before
 * it reads anything, and no flag lifts that refusal.
 *
 * Exit 0 when the story holds the status this run wrote. Exit 1 on a refusal
 * or a failure, with the refusal's name and reason on stderr.
 */

/** The usage block `-h` prints. */
const USAGE = [
  "# Plot helper: move a story's front-matter status.",
  '# Usage: plot-story-status.mjs [--who <name>] <slug> <status>',
  '#   --who     the name the booking commit carries (default: git user.name)',
  '#   <slug>    the story, its directory name under the Story directory',
  '#   <status>  draft, ready, active, in-review, paused or done',
  '# Output: one `step:` line per step, then a machine-countable summary:',
  '#             summary: status=active archived=untouched push=clean',
  '#         Exit 0 when the story holds the status; 1 on a refusal or a',
  '#         failure, with `<reason>: <detail>` on stderr.',
  '#',
].join('\n');

/**
 * Parses argv.
 *
 * @param argv - the arguments after the script name.
 * @returns the arguments, the message to refuse with, or `__help__`.
 */
export const parseArgs = (argv: readonly string[]): StoryStatusArgs | string => {
  let who = '';
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--who') {
      who = argv[++i] ?? '';
      if (who === '' || who.startsWith('-')) return `--who takes a name, not '${who}'`;
    } else if (arg === '-h' || arg === '--help') return '__help__';
    else if (arg.startsWith('-')) return `unknown flag '${arg}'`;
    else positional.push(arg);
  }
  if (positional.length !== 2) return 'need a story slug and a status (usage: plot-story-status.mjs [--who <name>] <slug> <status>)';
  const [slug = '', status = ''] = positional;
  return { who, slug, status };
};

/**
 * Parses argv, builds the ports for the caller's repository, and moves the story.
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
    warn("plot-story-status: unattended: a person moves a story's status, and this process runs under PLOT_UNATTENDED=1.\n  Refusing: the fleet never decides this. Run it from a session.\n");
    return 1;
  }
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    if (parsed === '__help__') {
      write(`${USAGE}\n`);
      return 0;
    }
    warn(`plot-story-status: ${parsed}\n`);
    return 1;
  }

  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) {
    warn("plot-story-status: not a git repository — run this from inside the checkout, or 'git init' one here\n");
    return 1;
  }
  const outcome = await setStoryStatusAt(storyStatusContext(probe.value, scriptDir), parsed, write, env);
  if (outcome.outcome === 'moved') return 0;
  warn(`plot-story-status: ${outcome.reason}: ${outcome.detail}\n`);
  return 1;
};

// Runs only when launched as a program; a test imports `run` without starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  void endEntry(await run(process.argv.slice(2), process.cwd(), scriptDir));
}
