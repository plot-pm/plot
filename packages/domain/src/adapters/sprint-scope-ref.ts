import { posix } from 'node:path';

import { planSlug } from '../rules/auto-dispatch.js';
import { sprintScope, type SprintScope } from '../rules/sprint-scope.js';
import { isAnswered } from '../port-result.js';
import type { Refs, TreeBlob } from '../ports/refs.js';
import type { Scripts } from '../ports/scripts.js';

/** Where a sprint's `active/` directory sits, absent a configured one. */
const DEFAULT_SPRINT_DIR = 'docs/sprints';

/** The git mode of a symlink blob, whose content is its target's path. */
const LINK_MODE = '120000';

/** Whether a blob is a regular file rather than a symlink or a submodule. */
const isFile = (blob: TreeBlob): boolean => blob.mode === '100644' || blob.mode === '100755';

/** The filename's own stem, stripped of its path and `.md` extension. */
const slugOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
};

/** Where an `active/` entry's text lives, or why it cannot be read. */
type Resolved = { path: string } | { why: 'sprint-link-escapes' | 'sprint-link-missing' };

/**
 * Resolves an `active/` entry to the regular file that holds its sprint text.
 *
 * A regular file resolves to itself. A symlink's target is read from its blob
 * and resolved against `active/`, the directory the link sits in.
 *
 * @param refs - the ref reader.
 * @param ref - the revision to read at.
 * @param entry - the `active/` entry.
 * @param sprintDir - the configured sprint directory.
 * @param blobs - every blob under `sprintDir` at `ref`.
 * @returns the target's path; `sprint-link-escapes` for a target outside
 *   `sprintDir`; `sprint-link-missing` for a target that is not a regular file
 *   at `ref`, or a link blob that cannot be read.
 */
const resolveEntry = async (
  refs: Refs,
  ref: string,
  entry: TreeBlob,
  sprintDir: string,
  blobs: readonly TreeBlob[],
): Promise<Resolved> => {
  if (entry.mode !== LINK_MODE) return { path: entry.path };
  const target = await refs.showFile(ref, entry.path);
  if (!isAnswered(target)) return { why: 'sprint-link-missing' };
  const link = target.value.trim();
  const resolved = posix.normalize(posix.join(posix.dirname(entry.path), link));
  if (posix.isAbsolute(link) || !resolved.startsWith(`${sprintDir}/`)) return { why: 'sprint-link-escapes' };
  return blobs.some((blob) => blob.path === resolved && isFile(blob)) ? { path: resolved } : { why: 'sprint-link-missing' };
};

/**
 * Reads the active sprint's commitment from git, never the working tree.
 *
 * Every call re-resolves the `Sprint directory` config key, re-lists the
 * directory at `ref`, and re-reads the sprint file. It keeps no cache and no
 * state file, so only a commit that moves `ref` changes the answer.
 *
 * The entries of `<Sprint directory>/active/` ending in `.md` are the active
 * sprints. `plot-sprint-state.sh` writes each one as a symlink
 * `active/<slug>.md -> ../<dated>.md`, git mode `120000`. A symlink's text is
 * read from its target, resolved against `active/`; a regular file is read
 * directly. The slug comes from the entry's own name. Zero entries or more
 * than one is the `none` case {@link sprintScope} reports, and no entry is
 * read then.
 *
 * @param refs - the ref reader.
 * @param scripts - the config reader, for the `Sprint directory` key.
 * @param ref - the revision to read at, such as `origin/main`.
 * @returns the scope `sprintScope` computes from what git holds at `ref`;
 *   `{ read: 'none', why: 'sprint-link-escapes' }` when the active link points
 *   outside the sprint directory; `{ read: 'none', why: 'sprint-link-missing' }`
 *   when its target is not a regular file at `ref`.
 */
export const sprintScopeRef = async (refs: Refs, scripts: Scripts, ref: string): Promise<SprintScope> => {
  const configured = await scripts.config('Sprint directory', DEFAULT_SPRINT_DIR);
  const sprintDir = isAnswered(configured) ? configured.value.trim().replace(/\/+$/, '') : DEFAULT_SPRINT_DIR;
  const activeDir = `${sprintDir}/active`;

  const listing = await refs.listBlobs(ref, sprintDir);
  const blobs = isAnswered(listing) ? listing.value : [];
  const entries = blobs.filter(
    (blob) => blob.path.startsWith(`${activeDir}/`) && blob.path.endsWith('.md') && (isFile(blob) || blob.mode === LINK_MODE),
  );

  // `sprintScope` refuses zero or more than one entry by COUNT alone, so a
  // placeholder per entry keeps that count without reading any content.
  let sprintTexts: { content: string; slug: string }[] = entries.map(() => ({ content: '', slug: '' }));
  if (entries.length === 1) {
    const [entry] = entries;
    const resolved = await resolveEntry(refs, ref, entry!, sprintDir, blobs);
    if ('why' in resolved) return { read: 'none', why: resolved.why };
    const content = await refs.showFile(ref, resolved.path);
    sprintTexts = isAnswered(content) ? [{ content: content.value, slug: slugOf(entry!.path) }] : [];
  }

  const pulse = await refs.pulse();

  return sprintScope({
    sprintTexts,
    pulse: isAnswered(pulse) ? pulse.value : null,
    planSlug,
  });
};
