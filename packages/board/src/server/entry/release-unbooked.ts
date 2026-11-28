import { scriptsShell } from '@plot-pm/domain/adapters/scripts/scripts-shell';
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { planStoreRef } from '@plot-pm/domain/adapters/plan-store/plan-store-ref';
import { planSlug } from '@plot-pm/domain';
import type { PlanRecord, PlanStore } from '@plot-pm/domain/ports/plan-store';
import { releaseUnbooked, type ReleaseUnbookedAnswer } from '@plot-pm/domain/rules/release-unbooked';
import { releaseUnbookedReadingsFor } from '@plot-pm/fleet/shared/release-world';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { endEntry } from '@plot-pm/domain/adapters/entry-exit';

/**
 * Prints the `docs` and `infra` plans the newest release still owes, for
 * `plot-reconcile-scan.sh` section 6.
 *
 * ```
 * plot-release-unbooked.mjs <default-branch>
 * ```
 *
 * Asks `releaseUnbooked` over `origin/<default-branch>` and prints two lines
 * per owed plan whose Type is `docs` or `infra` and whose phase reads
 * Delivered: `  <file> — owed by <version> (Type: <type>), plan still Delivered`
 * and a `    consider:` line. A plan of any other type is section 6's loop's
 * finding and is not printed. `none` prints nothing. `unaskable` prints
 * `  (not evaluated — <reason>)`. The entry reads local git only and makes no
 * git-host call. Exit 0 on every answer; exit 2 on a usage error.
 */

/** The exit codes the caller reads. */
export const EXIT = { ok: 0, usage: 2 } as const;

/** The plan types section 6's loop skips and this entry reports. */
export const REPORTED_TYPES: readonly string[] = ['docs', 'infra'];

/** The answer of the rule and the plan records it was read from. */
export interface UnbookedReading {
  readonly answer: ReleaseUnbookedAnswer;
  /** The plan records the reading read; empty where the plan read failed. */
  readonly plans: readonly Pick<PlanRecord, 'file' | 'type' | 'phase'>[];
}

/**
 * The section 6 lines for one reading.
 *
 * @param reading - the rule's answer and the plan records.
 * @returns the lines, each ending in a newline; `''` where nothing is reported.
 */
export const unbookedLines = (reading: UnbookedReading): string => {
  const { answer, plans } = reading;
  if (answer === 'none') return '';
  if (answer === 'unaskable') {
    return '  (not evaluated — the newest release tag, the sprints, the plans or the removed changesets did not read)\n';
  }
  const bySlug = new Map(plans.map((p) => [planSlug(path.basename(p.file)), p]));
  return answer.plans
    .map((slug) => bySlug.get(slug))
    .filter((p) => p !== undefined && REPORTED_TYPES.includes(p.type) && p.phase.toLowerCase() === 'delivered')
    .map(
      (p) =>
        `  ${path.basename(p!.file)} — owed by ${answer.version} (Type: ${p!.type}), plan still Delivered\n` +
        '    consider: Book as Released on the Delivery tab, or /plot-release\n',
    )
    .join('');
};

/**
 * A plan store that keeps the records its last `readPlans` answered.
 *
 * @param store - the store to read through.
 * @returns the store and a reader of the kept records.
 */
const keeping = (store: PlanStore): { store: PlanStore; kept: () => readonly PlanRecord[] } => {
  let records: readonly PlanRecord[] = [];
  return {
    store: {
      ...store,
      readPlans: async (files) => {
        const read = await store.readPlans(files);
        if (read.ok) records = read.value;
        return read;
      },
    },
    kept: () => records,
  };
};

/**
 * Runs the entry.
 *
 * @param argv - the arguments after the script name.
 * @param read - reads the rule's answer and the plan records over `origin/<default-branch>`.
 * @param write - the output.
 * @returns the process exit code.
 */
export const run = async (
  argv: readonly string[],
  read: (branch: string) => Promise<UnbookedReading>,
  write: (s: string) => void,
): Promise<number> => {
  if (argv.length !== 1 || argv[0] === '') {
    write('usage: plot-release-unbooked.mjs <default-branch>\n');
    return EXIT.usage;
  }
  const reading = await read(argv[0]).catch((): UnbookedReading => ({ answer: 'unaskable', plans: [] }));
  write(unbookedLines(reading));
  return EXIT.ok;
};

/**
 * Reads the rule's answer and the plan records over `origin/<branch>`, from local git only.
 *
 * @param context - the repository root and the script directory.
 * @param branch - the default branch's name.
 * @returns the answer and the plan records it was read from.
 */
export const readUnbooked = async (context: { repoRoot: string; scriptDir: string }, branch: string): Promise<UnbookedReading> => {
  const config = scriptsShell(context);
  const [planDir, sprintDir] = await Promise.all([
    config.config('Plan directory', 'docs/plans/'),
    config.config('Sprint directory', 'docs/sprints/'),
  ]);
  const refs = refsGit(context);
  const ref = `origin/${branch}`;
  const plans = keeping(
    planStoreRef(refs, context, ref, (planDir.ok ? planDir.value.trim() : 'docs/plans/').replace(/\/+$/, '')),
  );
  const readings = await releaseUnbookedReadingsFor({
    refs,
    plans: plans.store,
    ref,
    sprintDir: sprintDir.ok ? sprintDir.value.trim() : null,
  });
  return { answer: releaseUnbooked(readings), plans: plans.kept() };
};

// Only when RUN, never when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const context = { repoRoot: process.cwd(), scriptDir };
  void endEntry(await run(process.argv.slice(2), (branch) => readUnbooked(context, branch), (s) => process.stdout.write(s)));
}
