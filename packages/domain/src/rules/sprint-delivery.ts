import type { DeliveryScopeKind } from './delivery-scope.js';

/** The title of the Delivery section while the scope is the release. */
export const RELEASE_DELIVERY_TITLE = 'Release delivery';

/** The title of the Delivery section under the `my-sprint` scope, without a sprint name. */
export const SPRINT_DELIVERY_TITLE = 'Sprint delivery';

/** The scope fields the section reads: its kind and the sprints in scope. */
export interface SprintDeliveryScope {
  readonly kind: DeliveryScopeKind;
  readonly sprints: readonly { readonly slug: string; readonly title?: string; readonly members: readonly string[] }[];
}

/** One sprint's group of plans in the section. */
export interface SprintDeliveryGroup {
  readonly sprint: string;
  /** The sprint's title, or its slug where it has none. */
  readonly name: string;
  /** The sprint's approved plans, each once. */
  readonly plans: string[];
}

/**
 * The section's title.
 *
 * @param scope - the Delivery scope.
 * @returns `Release delivery` under the release scope, `Sprint delivery · <title>` where the scope holds one sprint, and `Sprint delivery` where it holds several or none.
 */
export const sprintDeliveryTitle = (scope: SprintDeliveryScope): string => {
  if (scope.kind === 'release') return RELEASE_DELIVERY_TITLE;
  const [only] = scope.sprints;
  if (scope.sprints.length !== 1 || only === undefined) return SPRINT_DELIVERY_TITLE;
  return `${SPRINT_DELIVERY_TITLE} · ${only.title ?? only.slug}`;
};

/**
 * The plan groups of the section under the `my-sprint` scope: one group per sprint in scope.
 *
 * @param scope - the Delivery scope.
 * @param approved - every plan approved for delivery, in the order the section lists them.
 * @returns `[]` under the release scope. Otherwise one group per scope sprint holding the sprint's members that are approved, in `approved` order. A plan two sprints name appears in both groups.
 */
export const sprintDeliveryGroups = (scope: SprintDeliveryScope, approved: readonly string[]): SprintDeliveryGroup[] =>
  scope.kind === 'release'
    ? []
    : scope.sprints.map((s) => ({
        sprint: s.slug,
        name: s.title ?? s.slug,
        plans: approved.filter((p) => s.members.includes(p)),
      }));

/**
 * A group's header line.
 *
 * @param name - the group's sprint name.
 * @param several - whether the scope holds more than one sprint.
 * @param counts - the header text over the group's plans (`headerText`).
 * @returns the counts alone for a single sprint, whose name the section title carries; the name and the counts for several.
 */
export const sprintGroupHeader = (name: string, several: boolean, counts: string): string =>
  several ? `${name} · ${counts}` : counts;
