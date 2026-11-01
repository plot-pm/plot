/** What `planIndexOf` reads of one Planning card. */
export interface PlanIndexCard {
  slug: string;
  title: string;
  /** The plan's repo-relative file path, OS separator either way. */
  path: string;
  issues: readonly string[];
}

/** What `planIndexOf` reads of one draft plan. */
export interface PlanIndexDraft {
  plan: string;
  planFile: string;
  title: string;
  issues: readonly string[];
}

/** What `planIndexOf` reads of one `/api/fleet` plan entry. */
export interface PlanIndexFleetPlan {
  file: string;
  issues: readonly string[];
}

/** The payloads `planIndexOf` builds a {@link PlanIndex} from. Every field is optional — a caller passes what it has. */
export interface PlanIndexSources {
  cards?: readonly PlanIndexCard[];
  drafts?: readonly PlanIndexDraft[];
  /** The `/api/fleet` plan index, keyed by slug. Unused until the payload carries it. */
  fleetPlans?: Readonly<Record<string, PlanIndexFleetPlan>>;
}

/** One plan's resolved identity, as `planIndexOf` keys it by file basename and by slug. */
export interface PlanIndexEntry {
  slug: string;
  title: string;
  file: string;
  issues: readonly string[];
}

/** The index `planReference` resolves a plan reference against. */
export type PlanIndex = ReadonlyMap<string, PlanIndexEntry>;

/**
 * One tracker key, normalised: a leading `#` removed, as a string.
 *
 * `String(n)` matches `issueKey` (`schema.ts:3572`) exactly, so a key built
 * here and a key built there compare equal.
 *
 * @param n - the key as its source spelled it.
 * @returns the key as a bare string, with no leading `#`.
 */
const normalizedIssueKey = (n: string | number): string => String(n).replace(/^#/, '');

/**
 * Tracker keys, normalised for display: stringified, `#`-stripped, blanks
 * dropped, duplicates dropped with the first occurrence kept.
 *
 * @param issues - the keys as a source stated them.
 * @returns the keys in their original order, deduplicated.
 */
const normalizedIssues = (issues: readonly (string | number)[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of issues) {
    const key = normalizedIssueKey(raw);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
};

/**
 * A plan's basename, split on `/` and `\` alike.
 *
 * `path` comes from `path.relative` server-side, so it carries the OS
 * separator — a backslash on Windows. Splitting on both means the basename
 * extracts correctly there too, not left as the whole path.
 *
 * @param path - a repo-relative or bare plan file path.
 * @returns the path's final segment.
 */
const basenameOf = (path: string): string => {
  const segments = path.split(/[/\\]/);
  return segments[segments.length - 1];
};

/**
 * The index entry one card, draft or fleet plan contributes, keyed by its
 * file basename and by its slug.
 */
const indexEntry = (slug: string, title: string, file: string, issues: readonly (string | number)[]): PlanIndexEntry => ({
  slug,
  title,
  file,
  issues: normalizedIssues(issues),
});

/**
 * Builds the plan index `planReference` resolves against, from whichever
 * payloads the caller holds.
 *
 * Every source is optional, so Rows and Panels can call this with partial
 * data — a caller with only cards passes `{ cards }`. Keyed by both the
 * file's basename and the slug, so a reference naming either resolves.
 *
 * @param sources - the Planning cards, draft plans and `/api/fleet` plan index the caller holds.
 * @returns a plan index keyed by file basename and by slug.
 */
export const planIndexOf = (sources: PlanIndexSources): PlanIndex => {
  const index = new Map<string, PlanIndexEntry>();
  const add = (entry: PlanIndexEntry) => {
    if (entry.file !== '') index.set(basenameOf(entry.file), entry);
    if (entry.slug !== '') index.set(entry.slug, entry);
  };
  for (const card of sources.cards ?? []) {
    add(indexEntry(card.slug, card.title, card.path, card.issues));
  }
  for (const draft of sources.drafts ?? []) {
    add(indexEntry(draft.plan, draft.title, draft.planFile, draft.issues));
  }
  for (const [slug, plan] of Object.entries(sources.fleetPlans ?? {})) {
    add(indexEntry(slug, '', plan.file, plan.issues));
  }
  return index;
};

/** Names a plan, by its file, its slug, or both; may carry its own issue keys. */
export interface PlanRef {
  /** The plan's repo-relative file path, or basename — a reference that carries its own file links from it at once. */
  file?: string;
  slug?: string;
  issues?: readonly (string | number)[];
}

/** What `planReference` answers for one plan reference. */
export interface PlanReferenceAnswer {
  /** `<keys joined by ", ">: <slug>`, or the slug alone where there are no keys. */
  label: string;
  issues: readonly string[];
  title: string;
  href: string | null;
  exists: boolean;
}

/**
 * The board's route for a plan, `/plan/<encoded basename>`.
 *
 * Splits the path on `/` and `\` so a `Card.path` that carries the OS
 * separator (a backslash on Windows) still yields its basename rather than
 * the whole path as one encoded segment.
 *
 * @param file - a repo-relative or bare plan file path.
 * @returns the board's in-app route for that plan.
 */
export const planRoute = (file: string): string => `/plan/${encodeURIComponent(basenameOf(file))}`;

/**
 * Rewrites a relative doc-body link to its board route; any other link
 * passes through unchanged.
 *
 * A plan link (`../../plans/2026-08-16-slug.md`) rewrites to `/plan/slug.md`
 * — the date prefix dropped, matching the board's `/plan/<basename>`
 * resolution for a file whose stored name and rendered basename differ. A
 * story link (`../stories/<slug>/STORY-*.md`) rewrites to `/story/<slug>`.
 *
 * @param href - a link found inside a rendered plan or story document body.
 * @returns the rewritten board route, or `href` unchanged.
 */
export const planRouteOfDocLink = (href: string): string => {
  const planMatch = href.match(/(?:\.\.\/)*plans\/(?:\d{4}-\d{2}-\d{2}-)?([^/]+\.md)$/);
  if (planMatch) return `/plan/${planMatch[1]}`;
  const storyMatch = href.match(/(?:\.\.\/)*stories\/([^/]+)\/STORY-[^/]+\.md$/);
  if (storyMatch) return `/story/${storyMatch[1]}`;
  return href;
};

/**
 * Resolves one plan reference's label, issue prefix, title and link.
 *
 * `ref` names the plan by `file` or `slug`, or both, and may carry its own
 * `issues` — the inferred plan on an issue row carries issues and no file.
 * The index entry's `issues` and `title` win over the reference's own when
 * the index resolves one; `href` does not wait on the index: a reference
 * carrying its own `file` links at once, before the index can resolve
 * anything, so a Delivery row's day-one link never regresses behind a slow
 * or missing index. `href` priority: the reference's own `file`, then the
 * index's resolved file, then `null`. `exists` is `href !== null`.
 *
 * @param ref - the plan reference, named by file, by slug, or both.
 * @param index - the plan index built by {@link planIndexOf}; an empty map resolves nothing.
 * @returns the reference's label, issue prefix, title, href and whether it resolved to a link.
 */
export const planReference = (ref: PlanRef, index: PlanIndex): PlanReferenceAnswer => {
  const entry = (ref.file !== undefined ? index.get(basenameOf(ref.file)) : undefined)
    ?? (ref.slug !== undefined ? index.get(ref.slug) : undefined);
  const file = ref.file ?? entry?.file ?? null;
  // A file the index never resolved still needs a display name — its own
  // basename, stripped of the extension, is the only name a bare `ref.file`
  // carries.
  const slug = ref.slug ?? entry?.slug ?? (file !== null ? basenameOf(file).replace(/\.md$/, '') : '');
  const issues = normalizedIssues(entry?.issues ?? ref.issues ?? []);
  const title = entry?.title ?? '';
  const href = file !== null && file !== '' ? planRoute(file) : null;
  return {
    label: issues.length > 0 ? `${issues.join(', ')}: ${slug}` : slug,
    issues,
    title,
    href,
    exists: href !== null,
  };
};
