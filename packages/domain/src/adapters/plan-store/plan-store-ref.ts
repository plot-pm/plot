import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { PlanBlobRef, PlanRecord, PlanStore } from '../../ports/plan-store.js';
import type { Refs } from '../../ports/refs.js';
import { answered, failed, type PortResult } from '../../port-result.js';
import { asJsonLines, runProcess, resultOf } from '../run-script.js';
import { scriptPath, type ShellContext } from '../scripts.js';
import { planOf, planStoreShell, prefixArgs, statusField, type RawPlan } from './plan-store-shell.js';

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
 * AN UNREADABLE REF FAILS, never answers an empty list. The queue's own
 * `claimedBranches` reasons that an unreadable answer must never be read as
 * *nothing is claimed*; an empty plan list on a failed `ls-tree` is the same
 * substitution, and the board would drop every plan the moment a fetch
 * glitched. A tree that lists and holds no plan is an empty ANSWER; a tree that
 * cannot be listed is a failure.
 *
 * Every parse passes the configured `Branch prefixes` to the parser as
 * `--prefixes`. Without the flag the parser falls back to
 * `idea|feature|bug|docs|infra` and reads a plan's branches wrongly in any
 * repository whose list differs.
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
  const planBlobs = async (): Promise<PortResult<readonly PlanBlobRef[]>> => {
    const listing = await refs.listBlobs(ref, planDir);
    if (!listing.ok) return failed<readonly PlanBlobRef[]>();
    return answered(
      listing.value.filter(
        (blob) => (blob.mode === '100644' || blob.mode === '100755') && blob.path.endsWith('.md'),
      ),
    );
  };

  const shell = planStoreShell(context);

  /**
   * The configured prefixes, as the parser's arguments.
   *
   * A config read that fails leaves the parser at its default list, which is
   * the shell scan's own fallback when the key is unset.
   */
  const parserPrefixArgs = async (): Promise<readonly string[]> => {
    const configured = await shell.config('Branch prefixes', '');
    return configured.ok ? prefixArgs(configured.value) : [];
  };

  const listPlans = async (): Promise<PortResult<readonly string[]>> => {
    const blobs = await planBlobs();
    return blobs.ok ? answered(blobs.value.map((blob) => blob.path)) : failed<readonly string[]>();
  };

  /**
   * Parses blobs by object name: one batched read, one parser spawn.
   *
   * Reads nothing by ref name. A missing object or a parser error fails the
   * call, because the caller's object names came from a snapshot it took.
   */
  const parseBlobs = async (
    blobs: readonly PlanBlobRef[],
    prefixArguments: readonly string[],
  ): Promise<PortResult<readonly PlanRecord[]>> => {
    if (blobs.length === 0) return answered([]);

    // ONE BATCHED `readBlobs` CALL for every blob this round, never one per
    // file: the port's own contract measures ~55 ms of process spawn per git
    // call, 136x apart on this repository for a per-file loop.
    const read = await refs.readBlobs(blobs.map((b) => b.sha));
    if (!read.ok) return failed<readonly PlanRecord[]>();

    // Staged to a scratch directory, numbered so two plans sharing a basename
    // (one under `active/`, one under `delivered/`) cannot collide, the way
    // `board.ts` stages ref-read plans before its own one parser spawn.
    const stageDir = mkdtempSync(join(tmpdir(), 'plot-plan-store-ref-'));
    try {
      const staged: { stagedPath: string; file: string }[] = [];
      const rejectedByStagedPath = new Map<string, string>();
      let n = 0;
      for (const { path, sha } of blobs) {
        const content = read.value.get(sha);
        if (content === undefined) return failed<readonly PlanRecord[]>();
        const dir = join(stageDir, String(n++));
        mkdirSync(dir, { recursive: true });
        const stagedPath = join(dir, basename(path));
        writeFileSync(stagedPath, content, 'utf8');
        staged.push({ stagedPath, file: path });
        rejectedByStagedPath.set(stagedPath, statusField(content, 'Rejected'));
      }

      // ONE SPAWN of the parser over every staged path, never one per file —
      // the same batching `plot-plan-meta.sh` already gives `planStoreShell`.
      const run = await runProcess(
        'bash',
        [meta, ...prefixArguments, ...staged.map((s) => s.stagedPath)],
        { cwd: context.repoRoot },
      );
      const canonicalPath = new Map(staged.map((s) => [s.stagedPath, s.file]));
      const parsed = resultOf(run, (stdout) => asJsonLines<RawPlan>(stdout));
      if (!parsed.ok) return failed<readonly PlanRecord[]>();
      // A line carrying `error` is a file the parser could not read; dropping
      // it would shrink the estate without saying so.
      if (parsed.value.some((raw) => raw.error !== undefined)) return failed<readonly PlanRecord[]>();
      const records = parsed.value.map((raw) => {
        const rejectedRaw = raw.file === undefined ? '' : rejectedByStagedPath.get(raw.file) ?? '';
        const record = planOf(raw, rejectedRaw);
        const canonical = raw.file === undefined ? undefined : canonicalPath.get(raw.file);
        return canonical === undefined ? record : { ...record, file: canonical };
      });
      return records.length === staged.length ? answered(records) : failed<readonly PlanRecord[]>();
    } finally {
      rmSync(stageDir, { recursive: true, force: true });
    }
  };

  const readPlansAt = async (
    blobs: readonly PlanBlobRef[],
    prefixes: readonly string[],
  ): Promise<PortResult<readonly PlanRecord[]>> =>
    parseBlobs(blobs, prefixes.length === 0 ? [] : ['--prefixes', prefixes.join('|')]);

  const readPlans = async (
    files: readonly string[],
  ): Promise<PortResult<readonly PlanRecord[]>> => {
    if (files.length === 0) return answered([]);
    const listed = await planBlobs();
    if (!listed.ok) return failed<readonly PlanRecord[]>();
    const shaByPath = new Map(listed.value.map((blob) => [blob.path, blob] as const));
    // A file the tree does not hold is not asked for: the tree listed fine, so
    // the plan is not there. A tree that could not be listed failed above.
    const wanted = files.flatMap((file) => {
      const blob = shaByPath.get(file);
      return blob === undefined ? [] : [blob];
    });
    return parseBlobs(wanted, await parserPrefixArgs());
  };

  // `config`, `listDir`, `readText` and `writeText` are the WORKING TREE's,
  // unchanged: they back a lifecycle write reading or writing the checkout it
  // is about to act on, which this adapter does not touch and the plan's
  // Decisions section says to leave alone.
  return {
    readPlan: async (file) => {
      const many = await readPlans([file]);
      if (!many.ok) return many;
      const [first] = many.value;
      return first === undefined ? failed<PlanRecord>() : answered(first);
    },
    readPlans,
    readPlansAt,
    listPlans,
    config: shell.config,
    listDir: shell.listDir,
    readText: shell.readText,
    writeText: shell.writeText,
  };
};
