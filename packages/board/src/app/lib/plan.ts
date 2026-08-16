import type { Card, StoryCard } from '../../contract/schema.js';

/**
 * The board-server route that renders a plan's file as HTML. `card.path` is
 * repo-relative (e.g. docs/plans/2026-07-12-foo.md); the server keys plans by
 * basename, so that's all the route needs. Encoded so odd characters survive.
 *
 * `card.path` comes from `path.relative` server-side, so it uses the OS
 * separator — a backslash on Windows. Split on both separators so the basename
 * is extracted correctly there, not left as the whole `docs\plans\foo.md`.
 */
export function planHref(card: Pick<Card, 'path'>): string {
  const basename = card.path.split(/[/\\]/).pop() ?? '';
  return `/plan/${encodeURIComponent(basename)}`;
}

/**
 * The board-server route that renders a story's own file — or "" where the
 * board found no file for it.
 *
 * Keyed on the SLUG rather than the path, because that is what the server's
 * allowlist matches: the story slug is both a directory name and part of the
 * filename, so the server resolves it against the stories it collected instead
 * of joining it into a path. `path` is read only as the yes/no of *is there a
 * file*, which is exactly what a plan row does with `planFile`.
 *
 * An empty return renders as no link at all — never a link that 404s.
 */
export function storyHref(story: Pick<StoryCard, 'slug' | 'path'>): string {
  if (!story.path || !story.slug) return '';
  return `/story/${encodeURIComponent(story.slug)}`;
}
