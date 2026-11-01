import { checksUnaskable } from '@plot-pm/domain';
import type { Board, StoryCard } from '../../contract/schema.js';

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

/**
 * Whether the host could not report checks for ANY pull request on this board.
 *
 * THE RULE IS THE DOMAIN'S; THIS ONLY COLLECTS. `checksUnaskable` decides —
 * including that an EMPTY set is not a refusal, because a board that has not
 * fetched yet has no evidence either way and a warning there would be
 * permanent on a first load. All this does is flatten the columns into the
 * readings that rule takes.
 *
 * It reads every card's PRs rather than a sample: a service-level claim has to
 * be true of every reading the board holds, and a sample would let one green
 * PR in a hidden column silence a stack that genuinely cannot answer, or one
 * unknown PR in the visible set speak for a stack that can.
 *
 * @param board - the board payload as it arrived.
 * @returns true when there are PRs and the host answered `unknown` for all.
 */
export function checksUnaskableOn(board: Pick<Board, 'columns'>): boolean {
  return checksUnaskable(
    board.columns.flatMap((column) =>
      column.cards.flatMap((card) =>
        card.prs.map((pr) => ({ checks: pr.checks, mergeable: pr.mergeable })),
      ),
    ),
  );
}
