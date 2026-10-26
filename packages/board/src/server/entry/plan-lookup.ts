// The plan lookup `plan-for-branch.ts` and `record-pr.ts` share. A module of
// its own, with no run-when-launched block: bundling an entry's block into
// another entry would run it there too.
import type { PlanStore } from '@plot-pm/domain';
import { planForBranch, plansMentioning, type PlanForBranch } from '@plot-pm/domain/rules/plan-for-branch';
import path from 'node:path';

/**
 * Finds the plan under `planDir` whose slices name `branch`.
 *
 * Only the plans whose text contains the branch name are parsed: measured
 * 2026-09-09, parsing all 253 plans took 103 s against 0.6 s for a text
 * search first.
 *
 * @param store - a plan store rooted at the tree to search.
 * @param planDir - the `Plan directory` value, relative to the store's root or absolute.
 * @param branch - the branch to find.
 * @returns the plan file, as `planDir` spells it, and the slice name; or `undefined`.
 */
export const findPlanForBranch = async (store: PlanStore, planDir: string, branch: string): Promise<PlanForBranch | undefined> => {
  const listed = await store.listDir(planDir);
  const files = (listed.ok ? listed.value : []).filter((name) => name.endsWith('.md')).map((name) => path.join(planDir, name));
  const texts = [];
  for (const file of files) {
    const read = await store.readText(file);
    if (read.ok && read.value !== null) texts.push({ file, text: read.value });
  }
  const parsed = await store.readPlans(plansMentioning(texts, branch));
  return planForBranch(parsed.ok ? parsed.value : [], branch);
};
