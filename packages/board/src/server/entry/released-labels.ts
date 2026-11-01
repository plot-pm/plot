import { scriptsShell, trackerForIssues, hostShell, type ShellContext } from '@plot-pm/domain/adapters';
import type { Tracker } from '@plot-pm/domain/ports/tracker';
import {
  RELEASED_LABEL,
  releasedLabelTargets,
  type LabelIssue,
  type LabelPlan,
} from '@plot-pm/domain/rules/released-labels';
import { planStateLabelsToRemove } from '@plot-pm/domain/adapters/tracker/tracker-plan-state';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';
import { planMetasAtDefault } from '../fleet.js';

/**
 * Gives a closed issue named by a Released plan the `plan:released` label it
 * lacks. A one-off backfill, not a standing writer.
 *
 * ```
 * plot-released-labels.mjs          # dry run: both sets, with reasons, and the call count
 * plot-released-labels.mjs --yes    # write
 * plot-released-labels.mjs --section <1|0>   # the reconcile sweep's report section
 * ```
 *
 * Dry-run output, tab-separated: `write\t<issue>` and `skip\t<issue>\t<reason>`
 * lines, then `summary: write=<n> skip=<n> calls=<n>`. The `--yes` run makes one
 * `issueLabel` call per `write` issue and nothing else: no comment, no close.
 *
 * `--yes` refuses under `PLOT_UNATTENDED=1` (exit 2) before it reads anything.
 * The dry run only reads, so it runs unattended; the reconcile sweep relies on it.
 *
 * Each write costs 3 host requests (`view`, `label create`, `edit`). The run
 * stops, naming the unwritten issues, when the connector reports fewer than
 * {@link MIN_REMAINING} requests left.
 */

/** The exit codes the caller reads. */
export const EXIT = { ok: 0, failed: 1, usage: 2 } as const;

/** Host requests one label write spends. */
export const CALLS_PER_WRITE = 3;

/** The run stops below this many requests left on the connector. */
export const MIN_REMAINING = 1000;

/** How many writes pass between two limit readings. */
const LIMIT_EVERY = 25;

/** Everything the entry reads from outside itself. */
export interface Deps {
  tracker: Tracker;
  /** Every plan's phase and issues, or null where the plans cannot be read. */
  plans: () => Promise<readonly LabelPlan[] | null>;
  env: Record<string, string | undefined>;
  /** The command the `--section` report prints for the write run. */
  self?: string;
  write: (s: string) => void;
  warn: (s: string) => void;
}

const USAGE = 'usage: plot-released-labels.mjs [--yes | --section <1|0>]';

const SECTION_HEADING = '== Closed issues of Released plans without plan:released ==';

/**
 * Runs the backfill.
 *
 * @param argv - the arguments after the script name.
 * @param deps - the tracker, the plan reader, the environment and the outputs.
 * @returns the process exit code.
 */
export const run = async (argv: readonly string[], deps: Deps): Promise<number> => {
  const sectionAt = argv.indexOf('--section');
  const section = sectionAt === 0 && argv.length === 2 && (argv[1] === '1' || argv[1] === '0');
  const unknown = section ? undefined : argv.find((arg) => arg !== '--yes');
  if (unknown !== undefined || (sectionAt >= 0 && !section)) {
    deps.warn(`plot-released-labels: unknown argument '${unknown ?? argv.join(' ')}'\n${USAGE}\n`);
    return EXIT.usage;
  }
  if (section && argv[1] === '0') {
    deps.write(`\n${SECTION_HEADING}\n  (not checked: offline)\n\n`);
    return EXIT.ok;
  }
  const yes = argv.includes('--yes');
  if (yes && deps.env.PLOT_UNATTENDED === '1') {
    deps.warn('plot-released-labels: --yes writes to the tracker and needs a person; refused under PLOT_UNATTENDED=1\n');
    return EXIT.usage;
  }
  const plans = await deps.plans();
  if (plans === null) {
    deps.warn('plot-released-labels: the plans could not be read; nothing was changed\n');
    return EXIT.failed;
  }
  const closed = await deps.tracker.issueListClosed('1970-01-01T00:00:00Z', 10000);
  if (!closed.ok) {
    deps.warn(`plot-released-labels: the closed issues could not be read (${closed.why}); nothing was changed\n`);
    return EXIT.failed;
  }
  if (!closed.value.complete) deps.warn('plot-released-labels: note: the closed-issue read stopped at its limit\n');
  const rows: LabelIssue[] = closed.value.issues.map((issue) => ({
    id: issue.id,
    status: issue.status === '' ? 'closed' : issue.status,
    labels: issue.labels ?? [],
  }));
  const { write, skip } = releasedLabelTargets(plans, rows);
  if (section) {
    const line = write.length > 0 ? `  ${write.length} issue(s) — run: node ${deps.self ?? 'plot-released-labels.mjs'} --yes` : '  (none)';
    deps.write(`\n${SECTION_HEADING}\n${line}\n\n`);
    return EXIT.ok;
  }
  for (const issue of write) deps.write(`write\t${issue}\n`);
  for (const { issue, reason } of skip) deps.write(`skip\t${issue}\t${reason}\n`);
  deps.write(`summary: write=${write.length} skip=${skip.length} calls=${write.length * CALLS_PER_WRITE}\n`);
  if (!yes) {
    if (write.length > 0) deps.write('dry run: nothing was written; re-run with --yes to write\n');
    return EXIT.ok;
  }
  const remove = planStateLabelsToRemove('released').split(',');
  for (const [index, issue] of write.entries()) {
    if (index % LIMIT_EVERY === 0) {
      const limits = await deps.tracker.limit();
      const left = limits.ok
        ? Math.min(...limits.value.map((r) => r.remaining).filter((n): n is number => n !== null))
        : Infinity;
      if (left < MIN_REMAINING) {
        deps.write(`stopped: the connector has ${left} requests left (floor ${MIN_REMAINING})\n`);
        deps.write(`unwritten: ${write.slice(index).join(' ')}\n`);
        return EXIT.failed;
      }
    }
    const result = await deps.tracker.issueLabel(issue, RELEASED_LABEL, remove);
    const outcome = result.ok ? result.value : result.why;
    deps.write(`${issue}\t${outcome}\n`);
    if (!result.ok) {
      deps.write(`stopped: ${deps.tracker.lastRefusal() ?? 'the write failed'}\n`);
      deps.write(`unwritten: ${write.slice(index).join(' ')}\n`);
      return EXIT.failed;
    }
  }
  return EXIT.ok;
};

// Only when RUN, never when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = process.env.PLOT_REPO_ROOT ?? process.cwd();
  const scriptDir = process.env.PLOT_SCRIPTS_DIR ?? path.resolve(here, '..');
  const context: ShellContext = { repoRoot, scriptDir };
  const [declared, backend] = await Promise.all([scriptsShell(context).config('Tracker', ''), hostShell(context).backend()]);
  const tracker = trackerForIssues(declared.ok ? declared.value.trim() : '', backend.ok ? backend.value : '', context);
  const plans = async (): Promise<LabelPlan[] | null> => {
    const metas = await planMetasAtDefault({ repoRoot, scriptsDir: scriptDir });
    return metas === null ? null : metas.map((meta) => ({ phase: meta.phase, issues: meta.issues ?? [] }));
  };
  void endEntry(
    await run(process.argv.slice(2), {
      tracker,
      plans,
      env: process.env,
      self: fileURLToPath(import.meta.url),
      write: (s) => process.stdout.write(s),
      warn: (s) => process.stderr.write(s),
    }),
  );
}
