const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Display text for a story's `created` or `updated` value.
 *
 * @param raw The string the story file states.
 * @param now The clock reading to measure against.
 * @returns `today`, `yesterday`, `N days ago`, `N weeks ago`, or the locale
 * date for a value 30 or more days old. Returns `null` for an absent value and
 * for a value `Date` cannot parse, so the caller shows nothing for it.
 */
export const storyDateText = (raw: string | undefined | null, now: Date): string | null => {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const diffDays = Math.floor((now.getTime() - date.getTime()) / DAY_MS);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString();
};
