import {
  sprintFieldNotices,
  sprintMemberRefusals,
  type SprintFieldNotice,
  type SprintMemberRefusal,
} from '@plot-pm/domain/rules/sprint-member-gate';
import { slugOf } from '@plot-pm/domain/rules/state-transition';
import { unstruckSprintMembers, type SprintFile } from '@plot-pm/domain/rules/sprint-membership';

/** Where one tree pair — a base and its successor — is read from. */
export interface TreeReader {
  /** The `.md` paths directly under `dir` in the successor tree. */
  list(dir: string): Promise<readonly string[]>;
  /** A path's text at the base, or `null` where it is absent. */
  before(path: string): Promise<string | null>;
  /** A path's text in the successor, or `null` where it is absent. */
  after(path: string): Promise<string | null>;
}

/** The answer over one tree pair. */
export interface SprintMemberCheck {
  refusals: SprintMemberRefusal[];
  notices: SprintFieldNotice[];
}

const inDir = (path: string, dir: string): boolean => path.startsWith(`${dir.replace(/\/+$/, '')}/`) && path.endsWith('.md');

/**
 * Runs the sprint-member rule over the files a change touched.
 *
 * Reads every sprint file of the successor tree, because
 * `sprintOfPlan` answers over all of them, but only the plan files a changed
 * sprint names and the plan files the change touched.
 *
 * @param reader - where the two trees are read from.
 * @param changed - the repository-relative paths the change touched.
 * @param planDir - the `Plan directory` value.
 * @param sprintDir - the `Sprint directory` value.
 */
export const checkSprintMembers = async (
  reader: TreeReader,
  changed: readonly string[],
  planDir: string,
  sprintDir: string,
): Promise<SprintMemberCheck> => {
  const changedSprints = changed.filter((p) => inDir(p, sprintDir));
  const changedPlans = changed.filter((p) => inDir(p, planDir));
  if (changedSprints.length === 0 && changedPlans.length === 0) return { refusals: [], notices: [] };

  const sprints: SprintFile[] = [];
  for (const file of await reader.list(sprintDir)) {
    const content = await reader.after(file);
    if (content !== null) sprints.push({ file, content });
  }

  const sprintChanges = [];
  const wanted = new Set<string>();
  for (const file of changedSprints) {
    const after = await reader.after(file);
    if (after === null) continue;
    sprintChanges.push({ file, before: await reader.before(file), after });
    for (const slug of unstruckSprintMembers(after)) wanted.add(slug);
  }

  const planFiles = new Set(changedPlans);
  for (const file of await reader.list(planDir)) if (wanted.has(slugOf('plan', file))) planFiles.add(file);
  const plans: { file: string; content: string }[] = [];
  const planChanges = [];
  for (const file of planFiles) {
    const content = await reader.after(file);
    if (content === null) continue;
    plans.push({ file, content });
    if (changedPlans.includes(file)) planChanges.push({ file, before: await reader.before(file), after: content });
  }

  return {
    refusals: sprintMemberRefusals(sprintChanges, sprints, plans),
    notices: sprintFieldNotices(planChanges, sprints),
  };
};
