import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import type { PlanStore, Scripts } from '@plot-pm/domain';
import {
  parsePlanSiblingLine,
  releaseIssueDecisions,
  releaseIssueSummary,
  trackerReportOf,
  unfinishedIssuesOf,
  type ReleaseSkipReason,
} from '@plot-pm/domain/rules/issue-status';
import os from 'node:os';
import path from 'node:path';
import { type Printer, Refused, unlinkSyncSafe } from './ladder.js';

/** One plan this release booked, as the tracker step needs it. */
export interface BookedPlan {
  /** The plan's slug, used only to name its temp copy. */
  readonly slug: string;
  /** The plan's file, relative to the tree the tracker step reads. */
  readonly file: string;
}

/** The aggregated outcome of telling the tracker about every plan a release booked. */
export interface TrackerSummary {
  /** The last `plot-issue-status.sh` outcome read, one per plan, in booking order. */
  readonly perPlan: readonly string[];
  /** How many issues closed, how many stayed open, and why — across every booked plan. */
  readonly issues: ReturnType<typeof releaseIssueSummary>;
}

/**
 * Tells the tracker about every plan a release booked, one after another.
 *
 * `scripts` and `planStore` are the CALLER's ports — `ctx.scripts` rooted at
 * the main checkout — and are never constructed here, so a test's fake
 * `scripts.awaited` reaches the tracker calls this step makes. Only the
 * sibling read is scoped to `tree`, the post-push worktree, read before its
 * caller removes it, never the main checkout ({@link
 * https://github.com/plot-pm/plot `shared-issue-reads-the-post-push-tree`}:
 * the main checkout holds whatever was last fetched, unrelated to release
 * ordering) — ONCE for the whole run, not once per plan: every OTHER plan
 * this call booked already reads `State: Released` in that same tree,
 * because the push that landed before this step ran wrote it, so
 * `unfinishedIssuesOf` already treats every booked plan as finished
 * alongside every other `released` sibling. A plan left Delivered outside
 * the booking still reads unreleased, and still keeps a shared issue open.
 *
 * A failure writing one plan's issues — including a `Refused` from a failed
 * temp copy — counts as that plan's failure, prints a `tracker: failed` line,
 * and never stops the plans after it. The caller's exit code never reflects a
 * tracker outcome.
 *
 * @param tree - the worktree to read sibling plans from; never the plan text root.
 * @param tag - the version just released, for `plot-plan-state.sh --version`.
 * @param booked - the plans this release booked, in the order to write them.
 * @param ports - the caller's `Scripts`/`PlanStore`, plus `scriptDir` for the
 *   sibling read's own `tree`-rooted shells.
 * @param write - where progress lines go.
 * @returns one outcome per plan, and the counts aggregated across all of them.
 */
export const tellTrackerAbout = async (
  tree: string,
  tag: string,
  booked: readonly BookedPlan[],
  ports: { scripts: Scripts; planStore: PlanStore; scriptDir: string },
  write: Printer,
): Promise<TrackerSummary> => {
  const { scripts, planStore } = ports;
  const treePlanStore = planStoreShell({ repoRoot: tree, scriptDir: ports.scriptDir });
  const treeScripts = scriptsShell({ repoRoot: tree, scriptDir: ports.scriptDir });

  const planDirCfg = await scripts.config('Plan directory', 'docs/plans/');
  const planDir = planDirCfg.ok ? planDirCfg.value.trim() : 'docs/plans/';

  // Read every sibling ONCE for the whole run, excluding none of the booked
  // plans by name: each already reads `released` in `tree`, so the one read
  // settles every booked plan's skip decision without a per-plan re-read.
  const siblingLines = await siblingLinesOf(treePlanStore, treeScripts, planDir, '');
  const unfinishedIssues = siblingLines === null ? 'unreadable' : unfinishedIssuesOf(siblingLines);

  const perPlan: string[] = [];
  const outcomes: ('closed' | ReleaseSkipReason)[] = [];

  for (const plan of booked) {
    const bookedPlanFile = path.join(os.tmpdir(), `plot-release-plan-${process.pid}-${plan.slug}.md`);
    try {
      const target = path.join(tree, plan.file);
      const bookedText = await planStore.readText(target);
      if (!bookedText.ok || bookedText.value === null || !(await planStore.writeText(bookedPlanFile, bookedText.value)).ok) {
        throw new Refused(`could not keep a copy of the released plan at ${bookedPlanFile} for the tracker.`);
      }

      const releasedMeta = await scripts.planMeta([bookedPlanFile]);
      const releasedLine = releasedMeta.ok ? releasedMeta.value.split('\n').map((l) => l.trim()).find(Boolean) : undefined;
      const releasedRecord = releasedLine === undefined ? null : parsePlanSiblingLine(releasedLine);
      const releasedIssues: readonly string[] = releasedRecord?.issues ?? [];
      const decisions = releaseIssueDecisions(releasedIssues, releasedRecord === null ? 'unreadable' : unfinishedIssues);
      const skipIssues = decisions.filter((d) => d.skip !== null).map((d) => d.issue);
      const skipFlags = skipIssues.flatMap((issue) => ['--skip-issue', issue]);

      if (unfinishedIssues === 'unreadable') {
        write(`  tracker: sibling read unreadable — could not parse a plot-plan-meta.sh line for a plan under ${planDir}; every issue this release names stays open.\n`);
      }
      if (releasedRecord === null) {
        write(`  tracker: could not parse the released plan's own plot-plan-meta.sh line (${bookedPlanFile}); every issue this release names stays open.\n`);
      }

      const statusTracker = await scripts.awaited('plot-issue-status.sh', [bookedPlanFile, ...skipFlags]);
      for (const line of statusTracker.stdout.split('\n')) {
        if (line.length > 0 && !line.startsWith('summary: ')) write(`  tracker: ${line}\n`);
      }
      let trackerReport = 'failed';
      for (const line of statusTracker.stdout.split('\n')) {
        const match = line.match(/^summary: tracker=([a-z-]*)/);
        if (match) trackerReport = match[1];
      }
      perPlan.push(trackerReport);

      const planState = trackerReportOf(
        await scripts.awaited('plot-plan-state.sh', [
          bookedPlanFile,
          '--phase',
          'released',
          '--plan-link',
          plan.file,
          '--version',
          tag,
          ...skipFlags,
        ]),
      );
      for (const line of planState.lines) write(`  plan-state: ${line}\n`);

      const writtenOutcomes = new Map(
        planState.lines
          .map((line) => line.split('\t'))
          .filter((cols): cols is [string, string, ...string[]] => cols.length >= 2)
          .map(([issue, outcome]) => [issue, outcome] as const),
      );
      for (const decision of decisions) {
        if (decision.skip !== null) {
          outcomes.push(decision.skip);
          continue;
        }
        const outcome = writtenOutcomes.get(decision.issue);
        outcomes.push(outcome === 'written' ? 'closed' : ((outcome as ReleaseSkipReason | undefined) ?? 'failed'));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      write(`  tracker: failed — ${message}\n`);
      perPlan.push('failed');
    } finally {
      unlinkSyncSafe(bookedPlanFile);
    }
  }

  return { perPlan, issues: releaseIssueSummary(outcomes) };
};

/**
 * Reads every sibling plan's `plot-plan-meta.sh` line, for
 * {@link unfinishedIssuesOf} to decide which issues stay open.
 *
 * Lists the flat `Plan directory` rather than the `Active index` — the index
 * is a symlink view holding only not-yet-released plans, so a sibling already
 * Delivered but not yet Released, which still owes its issue, would be
 * invisible there. The flat directory holds every plan regardless of phase,
 * and the pure rule is what excludes `released` ones.
 *
 * @param planStore - where the plan directory and its files live.
 * @param scripts - the `plot-plan-meta.sh` port, for a batched phase+issues read.
 * @param planDir - the configured plan directory.
 * @param excludeFile - the plan being released, repository-relative; skipped
 *   so it never reads itself as its own sibling.
 * @returns one `plot-plan-meta.sh` line per sibling, or `null` where the
 *   directory listing or the batched read itself could not be trusted.
 */
const siblingLinesOf = async (
  planStore: PlanStore,
  scripts: Scripts,
  planDir: string,
  excludeFile: string,
): Promise<readonly string[] | null> => {
  const listed = await planStore.listDir(planDir);
  if (!listed.ok) return null;
  const files = listed.value
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(planDir, name))
    .filter((file) => path.normalize(file) !== path.normalize(excludeFile));
  if (files.length === 0) return [];
  const meta = await scripts.planMeta(files);
  return meta.ok ? meta.value.split('\n') : null;
};
