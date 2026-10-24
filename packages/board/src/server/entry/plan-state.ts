import { hostShell, scriptsShell, trackerForIssues, type ShellContext } from '@plot-pm/domain/adapters';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import {
  isPlanStatePhase,
  planStateWrites,
  trackerWriteSummary,
  type PlanStateReading,
  type TrackerWriteOutcome,
} from '@plot-pm/domain/rules/issue-status';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * A plan's phase, reflected on the issues it answers, through the tracker port.
 *
 * ```
 * plot-plan-state.mjs docs/plans/x.md --phase approved --plan-link docs/plans/x.md
 * 7	written	approved
 * summary: tracker=written
 * ```
 *
 * **ITS OWN ARTIFACT**, for the reason `plot-issue-status.mjs`'s is: it spawns
 * `plot-host.sh` through the tracker connector.
 *
 * **IT READS THE PLAN ITSELF**, through the `Scripts` port's `planMeta` — the
 * one parser of the plan format — for the plan's issues. `plot-plan-state.sh`
 * is a launcher and reads nothing. This write reads no configuration key: the
 * label is the phase name, so no status word is configured.
 * **THE CALLER RESOLVES THE LINK AND PHASE**, as flags: the plan's address
 * differs by phase (the idea-branch PR link at `draft`, the plan file on the
 * default branch otherwise) and the phase a plan file alone cannot always
 * name (a spike approval, an in-flight release version) — only the
 * calling command knows either at the moment it calls.
 *
 * **`--skip-issue <id>` (repeatable)** leaves that issue open: it is reported
 * `skipped` on its own line and never reaches the tracker. The caller decides
 * which issues to skip — this entry only honours the list.
 *
 * **Tab-separated out**, one line per owed write:
 * `<issue>\t<written|no-target|unaskable|failed|skipped>\t<reason>`, then
 * `summary: tracker=<none|written|no-target|unaskable|failed>` — `skipped`
 * never appears there, so an existing reader's vocabulary is unchanged.
 */

/** The exit codes the caller reads. */
export const EXIT = {
  /** Every owed write was attempted — whatever each one answered. */
  ok: 0,
  /** The input was unreadable — a broken call, not a tracker's state. */
  usage: 2,
} as const;

/** The reason printed where the connector left no sentence of its own. */
const FALLBACK: Record<Exclude<TrackerWriteOutcome, 'written' | 'already' | 'unreachable'>, string> = {
  'no-target': 'the tracker holds nowhere to put this write',
  unaskable: 'no tracker declared',
  failed: 'the write failed',
};

/**
 * Reads the plan's issues out of `plot-plan-meta.sh`'s JSON line.
 *
 * @param text - the parser's output.
 * @returns the issues as strings.
 * @throws where the text is not the parser's JSON.
 */
export const issuesFrom = (text: string): readonly string[] => {
  const meta = JSON.parse(text) as { issues?: unknown };
  if (!Array.isArray(meta.issues)) throw new Error('stdin is not plot-plan-meta.sh output: no issues[]');
  return meta.issues.map(String);
};

/**
 * Reads `--phase <phase>`, `--plan-link <link>`, an optional `--version <v>`,
 * and zero or more `--skip-issue <id>`.
 *
 * @param argv - the arguments after the script name.
 * @returns the phase, link and version the caller declared, and the issues to skip.
 * @throws on an unknown flag, a flag with no value, a `--phase` outside the
 *   four, or a missing `--phase`/`--plan-link`.
 */
export const flagsFrom = (
  argv: readonly string[],
): Pick<PlanStateReading, 'phase' | 'planLink' | 'version'> & { skipIssues: readonly string[] } => {
  let phase: string | undefined;
  let planLink: string | undefined;
  let version: string | undefined;
  const skipIssues: string[] = [];
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--phase') phase = value;
    else if (flag === '--plan-link') planLink = value;
    else if (flag === '--version') version = value;
    else if (flag === '--skip-issue') skipIssues.push(value);
    else throw new Error(`unknown argument '${flag}'`);
  }
  if (phase === undefined) throw new Error('--phase is required');
  if (!isPlanStatePhase(phase)) throw new Error(`unknown --phase '${phase}'`);
  if (planLink === undefined) throw new Error('--plan-link is required');
  return { phase, planLink, skipIssues, ...(version === undefined ? {} : { version }) };
};

/**
 * Resolves the connector a plan-state write goes through, as the board's
 * issue readers do: a declared `Tracker` through its own connector, and a
 * repository that declares none through its git host's issues
 * (`trackerGitHost`), whose `planStateWrite` is the label and the comment.
 *
 * @param context - where the scripts and the repository are.
 * @returns the connector for the declared `Tracker` key and the git host's backend.
 */
export const planStateTracker = async (context: ShellContext): Promise<Tracker> => {
  const [declared, backend] = await Promise.all([scriptsShell(context).config('Tracker', ''), hostShell(context).backend()]);
  return trackerForIssues(declared.ok ? declared.value.trim() : '', backend.ok ? backend.value : '', context);
};

/**
 * Performs every plan-state write the rule decides a plan owes, skipping an
 * issue another unfinished plan also names — that issue is reported
 * `skipped`, never asked of the tracker.
 *
 * @param reading - the plan's phase, issues, link and (at release) version.
 * @param tracker - the connector the repository declared.
 * @param skipIssues - issues to leave open, each reported `skipped` rather than written.
 * @returns one `<issue>\t<outcome>\t<reason>` line per owed write.
 */
export const writePlanStates = async (
  reading: PlanStateReading,
  tracker: Tracker,
  skipIssues: ReadonlySet<string> = new Set(),
): Promise<{ lines: string[]; outcomes: (TrackerWriteOutcome | 'skipped')[] }> => {
  const lines: string[] = [];
  const outcomes: (TrackerWriteOutcome | 'skipped')[] = [];
  for (const write of planStateWrites(reading)) {
    if (skipIssues.has(write.issue)) {
      lines.push(`${write.issue}\tskipped\tanother plan unfinished\n`);
      outcomes.push('skipped');
      continue;
    }
    const result = await tracker.planStateWrite(write);
    const outcome: Exclude<TrackerWriteOutcome, 'already' | 'unreachable'> = result.ok ? result.value : result.why;
    const reason = (outcome === 'written' ? write.phase : (tracker.lastRefusal() ?? FALLBACK[outcome])).replace(/\s+/g, ' ').trim();
    lines.push(`${write.issue}\t${outcome}\t${reason}\n`);
    outcomes.push(outcome);
  }
  return { lines, outcomes };
};

/**
 * Reads the plan, writes the plan states, prints the answer.
 *
 * @param argv - the plan file, then the flags.
 * @param context - where the scripts and the repository are.
 * @param write - where the answer goes.
 * @param warn - where the reason for a usage error goes.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  context: ShellContext,
  write: (s: string) => void = (s) => process.stdout.write(s),
  warn: (s: string) => void = (s) => process.stderr.write(s),
): Promise<number> => {
  const [planFile = '', ...flags] = argv;
  let reading: PlanStateReading;
  let skipIssues: readonly string[];
  try {
    if (planFile === '' || !existsSync(planFile)) throw new Error(`'${planFile}' is not a plan file`);
    const meta = await scriptsShell(context).planMeta([path.resolve(planFile)]);
    if (!meta.ok) throw new Error(`cannot parse '${planFile}'`);
    const line = meta.value.split('\n').map((l) => l.trim()).find(Boolean);
    if (line === undefined) throw new Error(`cannot parse '${planFile}'`);
    const { skipIssues: skip, ...flags2 } = flagsFrom(flags);
    skipIssues = skip;
    reading = { issues: issuesFrom(line), ...flags2 };
  } catch (err) {
    warn(`plot-plan-state: ${(err as Error).message}\n`);
    warn(
      'plot-plan-state: usage: plot-plan-state.sh <plan file> --phase <draft|approved|delivered|released> --plan-link <link> [--version <v>] [--skip-issue <id> ...]\n',
    );
    write('summary: tracker=failed\n');
    return EXIT.usage;
  }
  // NOTHING OWED ASKS NO TRACKER, for the reason `issue-status.ts` gives.
  if (planStateWrites(reading).length === 0) {
    write('summary: tracker=none\n');
    return EXIT.ok;
  }
  const tracker = await planStateTracker(context);
  const { lines, outcomes } = await writePlanStates(reading, tracker, new Set(skipIssues));
  for (const line of lines) write(line);
  // SKIPPED IS TRANSPARENT TO THIS LINE'S VOCABULARY, which existing readers
  // parse (`trackerWriteSummary`, the `summary: tracker=` regex in
  // `issue-status.ts`): a release that skips a shared issue and writes every
  // other one cleanly still reports `written`, not a fifth word they do not expect.
  const written = outcomes.filter((outcome): outcome is TrackerWriteOutcome => outcome !== 'skipped');
  write(`summary: tracker=${written.length > 0 ? trackerWriteSummary(written) : 'none'}\n`);
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
  process.exit(await run(process.argv.slice(2), context));
}
