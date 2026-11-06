import { planSlug } from './auto-dispatch.js';
import { groupChangesets, type ReleaseChangeset } from './release-prepare.js';

/**
 * The unstruck plan slugs under the Must, Should and Could headings of a sprint file.
 *
 * @param content - the whole sprint file.
 * @returns each slug once, in file order.
 */
export const scopeSlugs = (content: string): string[] => {
  const slugs: string[] = [];
  let inTier = false;
  for (const line of content.split('\n')) {
    if (/^#{2,3} /.test(line)) {
      inTier = /^#{2,3} (Must|Should|Could)\b/i.test(line);
      continue;
    }
    const m = inTier ? line.match(/^- \[[ x]\] \[([a-z0-9][a-z0-9-]*)\]/) : null;
    if (m?.[1] !== undefined && !slugs.includes(m[1])) slugs.push(m[1]);
  }
  return slugs;
};

/**
 * The plan slugs that shipped changesets name outside the sprint's scope.
 *
 * Splits through {@link groupChangesets}, so the sprint/outside decision has one home.
 *
 * @param shipped - the changesets the release merge removed.
 * @param slugs - the sprint scope's plan slugs.
 * @returns each named slug once, in changeset order; changesets naming no plan add none.
 */
export const namedOutsideScope = (shipped: readonly ReleaseChangeset[], slugs: readonly string[]): string[] => {
  const outside = new Set(groupChangesets(shipped, slugs).outside);
  const named: string[] = [];
  for (const c of shipped) {
    if (c.plan === '' || !outside.has(c.file)) continue;
    const slug = planSlug(c.plan);
    if (!named.includes(slug)) named.push(slug);
  }
  return named;
};
