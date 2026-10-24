// Which plan names a branch, and under which slice heading — for
// `plot-open-pr.sh`. `record-pr.ts` runs the same `findPlanForBranch`.
//
//   node plot-plan-for-branch.mjs <branch>
//
// Prints `<absolute plan file>\t<slice name>` and exits 0, or exits 1 with
// nothing printed when no plan in `Plan directory` names the branch.
import { refsGit } from '@plot-pm/domain/adapters/refs/refs-git';
import { planStoreShell } from '@plot-pm/domain/adapters/plan-store/plan-store-shell';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { findPlanForBranch } from './plan-lookup.js';

/**
 * Prints the plan that names `branch` in the repository holding `cwd`.
 *
 * @param branch - the branch to find.
 * @param cwd - a directory inside the repository.
 * @param scriptDir - the directory holding `plot-*.sh`.
 * @param write - where the answer goes.
 * @returns the process exit code: 0 found, 1 not found or not a repository.
 */
export const run = async (
  branch: string,
  cwd: string,
  scriptDir: string,
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> => {
  const probe = await refsGit({ repoRoot: cwd, scriptDir }).repoRoot();
  if (!probe.ok) return 1;
  const store = planStoreShell({ repoRoot: probe.value, scriptDir });
  const read = await store.config('Plan directory', 'docs/plans/');
  const planDir = read.ok && read.value.trim() !== '' ? read.value.trim() : 'docs/plans/';
  const found = await findPlanForBranch(store, planDir, branch);
  if (found === undefined) return 1;
  write(`${path.resolve(probe.value, found.file)}\t${found.sliceName}\n`);
  return 0;
};

// Runs only when launched as a program; a test imports `run` without starting it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [branch] = process.argv.slice(2);
  if (!branch) {
    process.stderr.write('usage: plot-plan-for-branch.mjs <branch>\n');
    process.exit(2);
  }
  const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(await run(branch, process.cwd(), scriptDir));
}
