import type { Card } from '../../contract/schema.js';

/**
 * The board-server route that renders a plan's file as HTML. `card.path` is
 * repo-relative (e.g. docs/plans/2026-07-12-foo.md); the server keys plans by
 * basename, so that's all the route needs. Encoded so odd characters survive.
 */
export function planHref(card: Pick<Card, 'path'>): string {
  const basename = card.path.split('/').pop() ?? '';
  return `/plan/${encodeURIComponent(basename)}`;
}
