import { trackerShell, type ShellContext } from '@plot-pm/domain/adapters';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import {
  issueStatusWrites,
  type IssueStatusReading,
  type IssueStatusWords,
} from '@plot-pm/domain/rules/issue-status';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * A finished plan's issue status, written through the tracker port.
 *
 * ```
 * plot-plan-meta.sh plan.md | plot-issue-status.mjs --delivered '' --released Done
 * PROJ-7	written	Done
 * ```
 *
 * **ITS OWN ARTIFACT.** `plot-transition.mjs` spawns nothing, and this spawns
 * `plot-host.sh` through the connector. `plot-ask.mjs` answers by running the
 * fleet scan, 18.3 s, to reach a rule that needs one plan's phase.
 *
 * **THE PLAN ARRIVES ON STDIN** as `plot-plan-meta.sh`'s JSON, and the two
 * status words as flags: the shell that owns the plan file and the config reads
 * both, so this entry opens no file.
 *
 * **Tab-separated out**, one line per owed write:
 * `<issue>\t<written|no-target|unaskable|failed>\t<reason>`. No line means no
 * write was owed.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** Every owed write was attempted — whatever each one answered. */
  ok: 0,
  /** The input was unreadable — a broken installation, not a tracker's state. */
  usage: 2,
} as const;

/** What one owed write came to. */
export type WriteOutcome = 'written' | 'no-target' | 'unaskable' | 'failed';

/** The reason printed where the connector left no sentence of its own. */
const FALLBACK: Record<Exclude<WriteOutcome, 'written'>, string> = {
  'no-target': 'the tracker holds nowhere to put this status',
  unaskable: 'no tracker declared',
  failed: 'the write failed',
};

/**
 * Reads the plan's phase and issues out of `plot-plan-meta.sh`'s JSON.
 *
 * @param text - the parser's output.
 * @returns the phase, lowercased, and the issues as strings.
 * @throws where the text is not the parser's JSON.
 */
export const planFrom = (text: string): Pick<IssueStatusReading, 'phase' | 'issues'> => {
  const meta = JSON.parse(text) as { phase?: unknown; issues?: unknown };
  if (typeof meta.phase !== 'string' || !Array.isArray(meta.issues)) {
    throw new Error('stdin is not plot-plan-meta.sh output: no phase or no issues[]');
  }
  return { phase: meta.phase.toLowerCase(), issues: meta.issues.map(String) };
};

/**
 * Reads `--delivered <word>` and `--released <word>`; an absent flag is `''`.
 *
 * @param argv - the arguments after the script name.
 * @returns the configured words.
 * @throws on an unknown flag or a flag with no value.
 */
export const wordsFrom = (argv: readonly string[]): IssueStatusWords => {
  const words = { delivered: '', released: '' };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--delivered') words.delivered = value;
    else if (flag === '--released') words.released = value;
    else throw new Error(`unknown argument '${flag}'`);
  }
  return words;
};

/**
 * Performs every write the rule decides a plan owes.
 *
 * @param reading - the plan and the configured words.
 * @param tracker - the connector the repository declared.
 * @returns one `<issue>\t<outcome>\t<reason>` line per owed write.
 */
export const writeStatuses = async (reading: IssueStatusReading, tracker: Tracker): Promise<string[]> => {
  const lines: string[] = [];
  for (const { issue, status } of issueStatusWrites(reading)) {
    const result = await tracker.statusWrite({ prUrl: '', issue, status });
    const outcome: WriteOutcome = result.ok ? result.value : result.why;
    const reason = (outcome === 'written' ? status : (tracker.lastRefusal() ?? FALLBACK[outcome]))
      .replace(/\s+/g, ' ')
      .trim();
    lines.push(`${issue}\t${outcome}\t${reason}\n`);
  }
  return lines;
};

/**
 * Reads the input, writes the statuses, prints the answer.
 *
 * @param argv - the flags.
 * @param stdin - the plan's JSON.
 * @param context - where the scripts and the repository are.
 * @param write - where the answer goes.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  stdin: string,
  context: ShellContext,
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> => {
  let reading: IssueStatusReading;
  try {
    reading = { ...planFrom(stdin), words: wordsFrom(argv) };
  } catch (err) {
    process.stderr.write(`plot-issue-status: ${(err as Error).message}\n`);
    process.stderr.write(
      'plot-issue-status: usage: plot-plan-meta.sh <plan> | plot-issue-status.mjs [--delivered <word>] [--released <word>]\n',
    );
    return EXIT.usage;
  }
  // NOTHING OWED ASKS NO TRACKER. Resolving one reads config through a script,
  // and the 90% of plans naming no issue have no reason to pay for it.
  if (issueStatusWrites(reading).length === 0) return EXIT.ok;
  const tracker = await trackerShell(context);
  for (const line of await writeStatuses(reading, tracker)) write(line);
  return EXIT.ok;
};

// Only when RUN, never when imported. `pathToFileURL` rather than a template,
// for the reason `panel.ts` records: `import.meta.url` is realpath-resolved.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const context: ShellContext = {
    repoRoot: process.env.PLOT_REPO_ROOT ?? process.cwd(),
    scriptDir: process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..'),
  };
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  process.exit(await run(process.argv.slice(2), Buffer.concat(chunks).toString('utf8'), context));
}
