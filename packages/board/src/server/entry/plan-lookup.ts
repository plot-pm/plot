// The plan lookup `plan-for-branch.ts` and `record-pr.ts` share. A module of
// its own, with no run-when-launched block: bundling an entry's block into
// another entry would run it there too.
import type { PlanStore } from '@plot-pm/domain';
import type { Refs } from '@plot-pm/domain/ports/refs';
import { planForBranch, plansMentioning, type PlanForBranch } from '@plot-pm/domain/rules/plan-for-branch';
import { planBaseOf, sprintPlanReads, SPRINT_BRANCH_PREFIX } from '@plot-pm/domain/rules/slice-base';
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

/**
 * The branch a plan's slices are cut from and their PRs target — the base
 * fleetd hands an agent, decided by the same rules.
 *
 * Reads whether `origin/<default>` holds the plan file, which `origin/sprint/*`
 * tips hold it, and whether the default branch already contains each tip.
 * `sprintPlanReads` selects the carriers and `planBaseOf` decides. A default
 * branch that does not resolve answers the default branch.
 *
 * @param refs - the ref reader of the repository.
 * @param store - a plan store rooted at the tree to read the plan's `Sprint:` from.
 * @param file - the plan file, relative to the repository root.
 * @returns the base branch without `origin/`; `''` for the default branch.
 */
export const planBaseFor = async (
  refs: Pick<Refs, 'defaultBranch' | 'fileExistsSync' | 'branchTips' | 'contains'>,
  store: Pick<PlanStore, 'readPlans'>,
  file: string,
): Promise<string> => {
  const main = await refs.defaultBranch();
  if (!main.ok || main.value === '') return '';
  const held = refs.fileExistsSync(`origin/${main.value}`, file);
  const onDefault = !held.ok || held.value;
  if (onDefault) return '';
  const tips = await refs.branchTips([`refs/remotes/origin/${SPRINT_BRANCH_PREFIX}*`]);
  const sorted = tips.ok ? [...tips.value].sort((a, b) => (a.branch < b.branch ? -1 : 1)) : [];
  const listings = [];
  for (const tip of sorted) {
    const has = refs.fileExistsSync(`origin/${tip.branch}`, file);
    // plot-ancestry: prefilter — a contained tip only SKIPS a carrier, the
    // same rule fleetd applies before reading a sprint branch's plans.
    const contained = await refs.contains(tip.sha, `origin/${main.value}`);
    listings.push({
      branch: tip.branch,
      files: has.ok && has.value ? [file] : [],
      inDefault: contained.ok && contained.value === 'yes',
    });
  }
  const plan = await store.readPlans([file]);
  return planBaseOf({
    onDefault,
    sprint: plan.ok ? (plan.value[0]?.sprint ?? '') : '',
    carriers: sprintPlanReads([], listings).map((read) => read.branch),
  });
};
