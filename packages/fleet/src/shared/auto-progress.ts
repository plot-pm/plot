import path from 'node:path';
import { joinKey, sliceProgress, type FleetReading } from '@plot-pm/domain';
import { planDirectory } from './fleet-scan.js';
import { scriptsOf, type ActOptions } from './action-log.js';

/**
 * An approved plan's merged-slice count, written to its issue comment.
 *
 * Runs on the pulse a scan just wrote, beside `runAutoDeliverPass`. The write
 * is comment-only: it passes `--phase approved` and `--slice-progress`, so the
 * tracker sets no label. Only a plan the pulse reads `approved` is written. A
 * partial pulse renders no count (`sliceProgress` answers `undefined`), so the
 * pass writes nothing from it. A plan with no `Issue:` line owes no write, and
 * `plot-plan-state.sh` asks no tracker for it.
 *
 * The `pr merged` index finding marks the moment the count changes. The pass
 * reads the pulse each scan instead of consuming the finding, because the
 * finding lives only in memory in the channel and the count must come from the
 * pulse. It calls the script only when a plan's count differs from the last one
 * it sent, and the tracker connector compares the body hash before it writes.
 *
 * @param opts - where the repository and its scripts are.
 * @param pulse - the pulse the scan wrote, or `null`.
 * @param sent - the last count sent per plan file; the caller keeps it across scans.
 */
export const runAutoProgressPass = async (
  opts: ActOptions,
  pulse: FleetReading | null,
  sent: Map<string, string> = new Map(),
): Promise<void> => {
  if (pulse === null) return;
  const scripts = scriptsOf(opts);
  const planDir = await planDirectory(scripts);
  for (const plan of pulse.plans) {
    if (plan.phase.toLowerCase() !== 'approved') continue;
    const progress = sliceProgress(joinKey(plan.file), pulse, true);
    if (progress === undefined || sent.get(plan.file) === progress) continue;
    const rel = path.posix.join(planDir, plan.file);
    const run = await scripts.awaited('plot-plan-state.sh', [
      path.join(opts.repoRoot, rel),
      '--phase',
      'approved',
      '--plan-link',
      rel,
      '--slice-progress',
      progress,
    ]);
    if (run.code === 0 && !/tracker=failed/.test(run.stdout)) sent.set(plan.file, progress);
  }
};
