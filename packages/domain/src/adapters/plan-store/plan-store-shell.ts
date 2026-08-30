import type {
  PlanRecord,
  PlanRecordBranch,
  PlanRecordSlice,
  PlanStore,
} from '../../ports/plan-store.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import { asJsonLines, asText, runProcess, runScript, resultOf } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';

/** One line of `plot-plan-meta.sh` output, before it is renamed to the port's shape. */
interface RawPlan {
  file?: string;
  format?: string;
  phase?: string;
  phase_raw?: string;
  type?: string;
  title?: string;
  sprint?: string;
  story?: string;
  assignee?: string;
  branches?: string[];
  prs?: number[];
  waves?: RawSlice[];
  slices?: RawSlice[];
  review?: string;
  impl?: string;
  approved_raw?: string;
  delivered_raw?: string;
  released_raw?: string;
  started_raw?: string[];
  error?: string;
}

interface RawSlice {
  name?: string;
  branches?: RawBranch[];
}

interface RawBranch {
  branch?: string;
  deferred?: boolean;
  deferred_reason?: string;
  claimed?: string;
}

const branchOf = (raw: RawBranch): PlanRecordBranch => ({
  branch: raw.branch ?? '',
  deferred: raw.deferred ?? false,
  deferredReason: raw.deferred_reason ?? '',
  claimed: raw.claimed ?? '',
});

const sliceOf = (raw: RawSlice): PlanRecordSlice => ({
  name: raw.name ?? '',
  branches: (raw.branches ?? []).map(branchOf),
});

/**
 * Renames one parser line into the port's shape.
 *
 * Reads `slices` or the older `waves`, since the parser still emits the latter
 * and a reader that took only one spelling would silently see no branches.
 *
 * @param raw - one JSON line from the parser.
 * @returns the record, with every absent field at its empty value.
 */
const planOf = (raw: RawPlan): PlanRecord => ({
  file: raw.file ?? '',
  format: raw.format ?? 'none',
  phase: raw.phase ?? '',
  phaseRaw: raw.phase_raw ?? '',
  type: raw.type ?? '',
  title: raw.title ?? '',
  sprint: raw.sprint ?? '',
  story: raw.story ?? '',
  assignee: raw.assignee ?? '',
  branches: raw.branches ?? [],
  prs: raw.prs ?? [],
  slices: (raw.slices ?? raw.waves ?? []).map(sliceOf),
  review: raw.review ?? '',
  impl: raw.impl ?? '',
  approvedRaw: raw.approved_raw ?? '',
  deliveredRaw: raw.delivered_raw ?? '',
  releasedRaw: raw.released_raw ?? '',
  startedRaw: raw.started_raw ?? [],
});

/**
 * Reads plan files through `plot-plan-meta.sh`, which is the format contract.
 *
 * The parser is not reimplemented here. It already knows the three spellings a
 * plan's implementation section may take and reports parse problems inside its
 * JSON rather than as a crash, so this adapter renames fields and does nothing
 * else.
 *
 * @param context - where the scripts and the repository are.
 * @returns a `PlanStore` backed by the shell parser.
 */
export const planStoreShell = (context: ShellContext): PlanStore => {
  const meta = scriptPath(context, 'plot-plan-meta.sh');
  const config = scriptPath(context, 'plot-config.sh');

  const readPlans = async (
    files: readonly string[],
  ): Promise<PortResult<readonly PlanRecord[]>> => {
    if (files.length === 0) return answered([]);
    const run = await runProcess('bash', [meta, ...files], { cwd: context.repoRoot });
    return resultOf(run, (stdout) =>
      asJsonLines<RawPlan>(stdout)
        .filter((raw) => raw.error === undefined)
        .map(planOf),
    );
  };

  return {
    readPlans,

    readPlan: async (file) => {
      const many = await readPlans([file]);
      if (!many.ok) return many;
      const [first] = many.value;
      return first === undefined ? failed<PlanRecord>() : answered(first);
    },

    listPlans: () =>
      runScript(
        'bash',
        [
          '-c',
          'find docs/plans -maxdepth 1 -name "*.md" -type f | LC_ALL=C sort',
        ],
        (stdout) =>
          stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        { cwd: context.repoRoot },
      ),

    config: (key, fallback) =>
      runScript('bash', [config, 'get', key, fallback], asText, {
        cwd: context.repoRoot,
      }),
  };
};
