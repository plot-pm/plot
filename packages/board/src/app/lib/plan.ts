import { checksUnaskable, planRoute } from '@plot-pm/domain';
import type { Ref } from '@plot-pm/domain/entities/card-facts';
import type { Board, Card, StoryCard } from '../../contract/schema.js';

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

/** The board's lookups for the items a card names, each by its identifier. */
export interface BoardLinks {
  /**
   * A ticket's host address: the URL its issue row carries, else the
   * repository's issue-page prefix and the number; `undefined` where neither answers.
   */
  ticketHref: (key: string) => string | undefined;
  /** A branch's page on the host, from the repository's branch-page prefix; `undefined` where it is unknown. */
  branchHref: (branch: string) => string | undefined;
  /** The story the board collected under a slug. */
  storyOf: (slug: string) => StoryCard | undefined;
  /** The plan card the board holds under a slug. */
  planOf: (slug: string) => Card | undefined;
}

/**
 * The board's lookups for the items a card names. Every address comes from a
 * reading or from the repository's host address, never from free text: a
 * ticket's from its issue row or `issueUrlBase`, a branch's from `branchUrlBase`.
 *
 * @param board - the board payload; `tickets` may be absent.
 * @returns the lookups; each answers `undefined` where the board holds no answer.
 */
export const boardLinksOf = (
  board: Pick<Board, 'tickets' | 'branchUrlBase' | 'stories' | 'columns'> & Partial<Pick<Board, 'issueUrlBase'>>,
): BoardLinks => {
  const tickets = new Map<string, string>();
  const groups = board.tickets;
  if (groups) {
    for (const row of [...groups.open, ...groups['in-progress'], ...groups.done]) {
      if (row.url) tickets.set(String(row.id), row.url);
    }
  }
  const stories = new Map(board.stories.map((s) => [s.slug, s]));
  const plans = new Map(board.columns.flatMap((c) => c.cards).map((c) => [c.slug, c]));
  const base = board.branchUrlBase ?? '';
  const issueBase = board.issueUrlBase ?? '';
  return {
    // Only a number names an issue on the host; any other key belongs to another tracker.
    ticketHref: (key) => tickets.get(key) ?? (issueBase !== '' && /^\d+$/.test(key) ? `${issueBase}${key}` : undefined),
    // Encoded per path segment, as the fleet rows encode a branch link.
    branchHref: (branch) => (base === '' || branch === '' ? undefined : `${base}${branch.split('/').map(encodeURIComponent).join('/')}`),
    storyOf: (slug) => stories.get(slug),
    planOf: (slug) => plans.get(slug),
  };
};

/** Where one item a card names links: an address, and the board view it opens in place. */
export interface LinkTarget {
  href: string;
  /** The host, in a new tab; `false` for a view inside the board. */
  external: boolean;
  /** The board view a plain click opens in place; `null` for a host link. */
  opens: { kind: 'story'; story: StoryCard } | { kind: 'plan'; card: Card } | { kind: 'sprint'; slug: string } | null;
}

/**
 * Where an item a plan card names links. A story, a plan and a sprint open
 * their board view on a plain click, and their href is a route the board reads
 * (`/story/<slug>`, `/plan/<file>`, `/?sprint=<slug>`); a ticket, a branch, a PR
 * and its build open the host. A
 * slice links its PR where the card holds that PR's reading, else its branch.
 *
 * @param ref - the item.
 * @param aspect - `build` asks for a PR's checks page; `item` for the item itself.
 * @param prs - the card's PR readings.
 * @param links - the board's lookups.
 * @returns the target, or `null` where no reading gives the item an address.
 */
export const linkTargetOf = (
  ref: Ref, aspect: 'item' | 'build', prs: readonly Pick<Card['prs'][number], 'number' | 'url' | 'checksUrl'>[], links: BoardLinks,
): LinkTarget | null => {
  switch (ref.kind) {
    case 'story': {
      const story = links.storyOf(ref.slug);
      const href = story ? storyHref(story) : '';
      return story && href ? { href, external: false, opens: { kind: 'story', story } } : null;
    }
    case 'plan': {
      const card = links.planOf(ref.slug);
      return card ? { href: planRoute(card.path), external: false, opens: { kind: 'plan', card } } : null;
    }
    case 'sprint':
      // The board's own sprint filter route: loading it opens the board filtered to the sprint.
      return { href: `/?sprint=${encodeURIComponent(ref.slug)}`, external: false, opens: { kind: 'sprint', slug: ref.slug } };
    case 'ticket': {
      const href = links.ticketHref(ref.key);
      return href ? { href, external: true, opens: null } : null;
    }
    case 'slice': {
      const pr = ref.pr === null ? undefined : prs.find((one) => one.number === ref.pr);
      if (aspect === 'build') return pr?.checksUrl ? { href: pr.checksUrl, external: true, opens: null } : null;
      const href = pr?.url || links.branchHref(ref.branch);
      return href ? { href, external: true, opens: null } : null;
    }
  }
};
