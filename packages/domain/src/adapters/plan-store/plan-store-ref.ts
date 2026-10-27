import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { PlanRecord, PlanStore } from '../../ports/plan-store.js';
import type { Refs } from '../../ports/refs.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import { asJsonLines, runProcess, resultOf } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { planOf, planStoreShell, statusField, type RawPlan } from './plan-store-shell.js';

/**
 * Reads plan files from a ref rather than from a checkout's working tree.
 *
 * `fleetd`'s queue, supervisor and index monitor used to read plans through
 * {@link planStoreShell}, which walks `docs/plans` on whatever checkout the
 * daemon's own process happens to have open. Nothing else moves that
 * checkout, so a plan approved on the host stayed invisible until an operator
 * fast-forwarded it by hand — measured 2026-10-26, a 17-minute gap. This
 * adapter reads `origin/<default>` instead, the way the board's Kanban view
 * already does (`board.ts`'s `readPlansFromRef`/`collectPlanSources`).
 *
 * An unreadable ref answers an EMPTY LIST from both `listPlans` and
 * `readPlans`, never a fallback to the working tree: the queue's own
 * `claimedBranches` reasons that an unreadable answer must never be read as
 * *nothing is claimed*, because that would put every branch into the queue at
 * once. The same substitution here would reintroduce the bug this adapter
 * exists to fix, under the one condition — a stale or detached checkout —
 * where it would matter most.
 *
 * Every other `PlanStore` operation (`config`, `listDir`, `readText`,
 * `writeText`) is read from the WORKING TREE via `planStoreShell`: those back
 * a lifecycle write reading or writing the checkout it is about to act on,
 * which is a different question from "what plans does the queue see" and is
 * explicitly out of this adapter's scope.
 *
 * @param refs - the ref reader, already constructed by the caller.
 * @param context - where the scripts live and which repository to parse in.
 * @param ref - the ref to read plans from, such as `origin/main`.
 * @param planDir - the plan directory, relative to the repository root.
 * @returns a `PlanStore` whose `listPlans`/`readPlans` read `ref`, and whose
 *   other operations fall through to {@link planStoreShell}.
 */
export const planStoreRef = (
  refs: Refs,
  context: ShellContext,
  ref: string,
  planDir: string = 'docs/plans',
): PlanStore => {
  const meta = scriptPath(context, 'plot-plan-meta.sh');

  /**
   * Every regular-file plan blob the ref's tree holds under `planDir`.
   *
   * Mode-filtered to `100644`/`100755` so a symlink's own tree entry — the
   * target PATH as its content, not a plan — never becomes a listing result.
   * A tree listing holds no second copy of a symlink's target the way a
   * filesystem walk does, so no de-duplication is needed here.
   */
  const planBlobs = async (): Promise<readonly { sha: string; path: string }[]> => {
    const listing = await refs.listBlobs(ref, planDir);
    if (!listing.ok) return [];
    return listing.value.filter(
      (blob) => (blob.mode === '100644' || blob.mode === '100755') && blob.path.endsWith('.md'),
    );
  };

  const listPlans = async (): Promise<PortResult<readonly string[]>> =>
    answered((await planBlobs()).map((blob) => blob.path));

  const readPlans = async (
    files: readonly string[],
  ): Promise<PortResult<readonly PlanRecord[]>> => {
    if (files.length === 0) return answered([]);
    const blobs = await planBlobs();
    const shaByPath = new Map(blobs.map((blob) => [blob.path, blob.sha] as const));
    const wanted = files.flatMap((file) => {
      const sha = shaByPath.get(file);
      return sha === undefined ? [] : [{ file, sha }];
    });
    if (wanted.length === 0) return answered([]);

    // ONE BATCHED `readBlobs` CALL for every file this round, never one per
    // file: the port's own contract measures ~55 ms of process spawn per git
    // call, 136x apart on this repository for a per-file loop.
    const read = await refs.readBlobs(wanted.map((w) => w.sha));
    if (!read.ok) return failed<readonly PlanRecord[]>();

    // Staged to a scratch directory, numbered so two plans sharing a basename
    // (one under `active/`, one under `delivered/`) cannot collide, the way
    // `board.ts` stages ref-read plans before its own one parser spawn.
    const stageDir = mkdtempSync(join(tmpdir(), 'plot-plan-store-ref-'));
    try {
      const staged: { stagedPath: string; file: string }[] = [];
      const rejectedByStagedPath = new Map<string, string>();
      let n = 0;
      for (const { file, sha } of wanted) {
        const content = read.value.get(sha);
        if (content === undefined) continue; // a missing object is a reading, not a failure
        const dir = join(stageDir, String(n++));
        mkdirSync(dir, { recursive: true });
        const stagedPath = join(dir, basename(file));
        writeFileSync(stagedPath, content, 'utf8');
        staged.push({ stagedPath, file });
        rejectedByStagedPath.set(stagedPath, statusField(content, 'Rejected'));
      }
      if (staged.length === 0) return answered([]);

      // ONE SPAWN of the parser over every staged path, never one per file —
      // the same batching `plot-plan-meta.sh` already gives `planStoreShell`.
      const run = await runProcess('bash', [meta, ...staged.map((s) => s.stagedPath)], {
        cwd: context.repoRoot,
      });
      const canonicalPath = new Map(staged.map((s) => [s.stagedPath, s.file]));
      return resultOf(run, (stdout) =>
        asJsonLines<RawPlan>(stdout)
          .filter((raw) => raw.error === undefined)
          .map((raw) => {
            const rejectedRaw = raw.file === undefined ? '' : rejectedByStagedPath.get(raw.file) ?? '';
            const record = planOf(raw, rejectedRaw);
            const canonical = raw.file === undefined ? undefined : canonicalPath.get(raw.file);
            return canonical === undefined ? record : { ...record, file: canonical };
          }),
      );
    } finally {
      rmSync(stageDir, { recursive: true, force: true });
    }
  };

  // `config`, `listDir`, `readText` and `writeText` are the WORKING TREE's,
  // unchanged: they back a lifecycle write reading or writing the checkout it
  // is about to act on, which this adapter does not touch and the plan's
  // Decisions section says to leave alone.
  const shell = planStoreShell(context);

  return {
    readPlan: async (file) => {
      const many = await readPlans([file]);
      if (!many.ok) return many;
      const [first] = many.value;
      return first === undefined ? failed<PlanRecord>() : answered(first);
    },
    readPlans,
    listPlans,
    config: shell.config,
    listDir: shell.listDir,
    readText: shell.readText,
    writeText: shell.writeText,
  };
};
