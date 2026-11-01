import { itemsFrom, type MoscowTier } from '../entities/sprint.js';
import { slugOf } from './state-transition.js';
import { sprintOfPlan, unstruckSprintMembers, type SprintFile } from './sprint-membership.js';

/** One sprint file a commit changed: its text before and after. */
export interface SprintChange {
  /** The sprint file's path. */
  file: string;
  /** The text at the base, or `null` where the commit creates the file. */
  before: string | null;
  /** The text the commit leaves. */
  after: string;
}

/** One plan file a commit changed: its text before and after. */
export interface PlanChange {
  /** The plan file's path. */
  file: string;
  /** The text at the base, or `null` where the commit creates the file. */
  before: string | null;
  /** The text the commit leaves. */
  after: string;
}

/** A member line a commit added or moved, whose plan names another sprint than the rule does. */
export interface SprintMemberRefusal {
  /** The plan's slug. */
  slug: string;
  /** The sprint the rule answers over the new tree. */
  sprint: string;
  /** The sprint file the commit changed. */
  file: string;
  /** The tier the line sits under. */
  tier: Exclude<MoscowTier, 'deferred'>;
  /** The plan's `Sprint:` value, comment removed and trimmed; `''` when empty. */
  field: string;
}

/** A plan whose `Sprint:` value a commit set to a sprint that does not list it. */
export interface SprintFieldNotice {
  /** The plan's slug. */
  slug: string;
  /** The sprint the field names. */
  field: string;
}

const OPEN_STATES: readonly string[] = ['Planning', 'Committed', 'Active'];
const STATE_FIELD = /^- \*\*State:\*\* (.+)$/m;
const SPRINT_FIELD = /^[ \t]*[-*][ \t]*\*\*Sprint:\*\*[ \t]*(.*)$/;
const STATUS_HEADING = /^##[ \t]*[Ss]tatus[ \t]*$/;
const ANY_H2 = /^##[ \t]/;

/**
 * The plan's `- **Sprint:**` value, read from its first `## Status` block.
 *
 * @param planText - the plan file's text.
 * @returns the value with HTML comments removed and trimmed; `''` where the field is absent or empty.
 */
export const planSprintField = (planText: string): string => {
  const lines = planText.split('\n');
  const start = lines.findIndex((line) => STATUS_HEADING.test(line));
  if (start === -1) return '';
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (ANY_H2.test(line)) return '';
    const match = line.match(SPRINT_FIELD);
    if (match) return match[1]!.replace(/<!--[\s\S]*?-->/g, '').trim();
  }
  return '';
};

/** The tier an unstruck member line sits under, or `undefined` where the text holds no such member. */
const tierOf = (content: string | null, slug: string): MoscowTier | undefined =>
  content === null || !unstruckSprintMembers(content).includes(slug)
    ? undefined
    : itemsFrom(content).find((item) => item.plan === slug && item.tier !== 'deferred')?.tier;

/**
 * The member lines a commit added or moved onto an open sprint whose plan's
 * `Sprint:` field disagrees with {@link sprintOfPlan} over the new tree.
 *
 * A slug is added or moved when it is an unstruck Must/Should/Could member in
 * the sprint's new text and was not a member in the old text, or sat under
 * another tier. A tick, an annotation, a Deferred line and a struck line are
 * neither. A sprint file is read only when its new `State:` is Planning,
 * Committed or Active. A slug with no plan file passes.
 *
 * @param changed - the sprint files the commit changed.
 * @param sprints - every dated sprint file in the new tree.
 * @param plans - every plan file in the new tree.
 * @returns one refusal per disagreeing added or moved slug, in file then line order.
 */
export const sprintMemberRefusals = (
  changed: readonly SprintChange[],
  sprints: readonly SprintFile[],
  plans: readonly { file: string; content: string }[],
): SprintMemberRefusal[] => {
  const planBySlug = new Map(plans.map((plan) => [slugOf('plan', plan.file), plan.content]));
  const refusals: SprintMemberRefusal[] = [];
  for (const change of changed) {
    const state = change.after.match(STATE_FIELD)?.[1]!.trim() ?? '';
    if (!OPEN_STATES.includes(state)) continue;
    for (const slug of unstruckSprintMembers(change.after)) {
      const tier = tierOf(change.after, slug);
      if (tier === undefined || tier === 'deferred' || tierOf(change.before, slug) === tier) continue;
      const planText = planBySlug.get(slug);
      if (planText === undefined) continue;
      const ruled = sprintOfPlan(slug, sprints)?.sprint ?? '';
      const field = planSprintField(planText);
      if (field !== ruled) {
        refusals.push({ slug, sprint: slugOf('sprint', change.file), file: change.file, tier, field });
      }
    }
  }
  return refusals;
};

/**
 * The plans whose `Sprint:` value a commit set or changed to a sprint that
 * does not list them. Reported, never refused: a Draft may name the sprint it
 * is about to join.
 *
 * @param changed - the plan files the commit changed.
 * @param sprints - every dated sprint file in the new tree.
 * @returns one notice per such plan.
 */
export const sprintFieldNotices = (
  changed: readonly PlanChange[],
  sprints: readonly SprintFile[],
): SprintFieldNotice[] => {
  const notices: SprintFieldNotice[] = [];
  for (const change of changed) {
    const field = planSprintField(change.after);
    if (field === '' || (change.before !== null && planSprintField(change.before) === field)) continue;
    const slug = slugOf('plan', change.file);
    const listed = sprints.some((s) => slugOf('sprint', s.file) === field && unstruckSprintMembers(s.content).includes(slug));
    if (!listed) notices.push({ slug, field });
  }
  return notices;
};

/**
 * The refusal text for the commit-time and CI forms.
 *
 * @param refusals - the refusals {@link sprintMemberRefusals} returned.
 * @returns one block per refusal naming the plan, the sprint, the line to write and the command; `null` for none.
 */
export const sprintMemberRefusalText = (refusals: readonly SprintMemberRefusal[]): string | null =>
  refusals.length === 0
    ? null
    : refusals
        .map(
          (r) =>
            `sprint-member: ${r.file} lists '${r.slug}' under ${r.tier}, but the plan's field reads ` +
            `${r.field === '' ? 'empty' : `'${r.field}'`}. Write '- **Sprint:** ${r.sprint}' in the plan; ` +
            `the command writes both files: plot-sprint-member.mjs add ${r.sprint} ${r.slug} --tier ${r.tier}`,
        )
        .join('\n');
