import type { LinkIconKind } from '@plot-pm/domain';
import { GLYPH_PATH, type GlyphKind } from '../lib/glyphs.js';

/** The glyph each link icon kind is drawn with; a slice wears the tuple rows' slice glyph. */
export const LINK_GLYPH: Readonly<Record<LinkIconKind, GlyphKind>> = {
  plan: 'plan',
  slice: 'wave',
  branch: 'branch',
  pr: 'pr',
  ticket: 'ticket',
  story: 'story',
  sprint: 'sprint',
  release: 'release',
  worktree: 'worktree',
  agent: 'agent',
  build: 'build',
  external: 'external',
};

/**
 * The Octicon of the place a link leads to, drawn before the link's text.
 *
 * Decorative: `aria-hidden`, because the link's text names the place. One em of the text beside it, in the muted
 * colour, centred on the line as the tuple rows' icons are. Renders nothing for a `null` kind.
 *
 * @param kind - the kind `linkIconKind` answered for the link's target.
 */
export const LinkIcon = ({ kind }: { kind: LinkIconKind | null }) => (
  kind === null ? null : (
    <svg
      aria-hidden
      data-link-icon={kind}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="currentColor"
      className="me-1 inline-block shrink-0 self-center align-[-0.125em] text-(--card-meta)"
    >
      <path d={GLYPH_PATH[LINK_GLYPH[kind]]} />
    </svg>
  )
);
