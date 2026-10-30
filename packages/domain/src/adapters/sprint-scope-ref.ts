import { planSlug } from '../rules/auto-dispatch.js';
import { sprintScope, type SprintScope } from '../rules/sprint-scope.js';
import { isAnswered } from '../port-result.js';
import type { Refs } from '../ports/refs.js';
import type { Scripts } from '../ports/scripts.js';

/** Where a sprint's `active/` directory sits, absent a configured one. */
const DEFAULT_SPRINT_DIR = 'docs/sprints';

/** The filename's own stem, stripped of its path and `.md` extension. */
const slugOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.endsWith('.md') ? base.slice(0, -3) : base;
};

/**
 * Reads the active sprint's commitment from git, never the working tree.
 *
 * The scope moves with a person's commit: every call re-resolves the `Sprint
 * directory` config key, re-lists `active/` at `ref`, and re-reads whatever it
 * finds — there is no cache here and no state file. A `sprint: scope change`
 * commit on the default branch is the only thing that moves what a caller
 * reading through this adapter sees next; a local checkout's own edits do
 * nothing until they land there.
 *
 * Resolves which file to read via {@link Refs.listBlobs} over the configured
 * directory's `active/` subdirectory, never a hand-built path or a parsed tree
 * listing — zero or more than one blob there is itself the `none` case
 * {@link sprintScope} reports, mirroring `plot-sprint-release.sh`'s own
 * threshold. The file's content comes from {@link Refs.showFile}, which reads
 * at a ref without checking anything out.
 *
 * @param refs - the ref reader.
 * @param scripts - the config reader, for the `Sprint directory` key.
 * @param ref - the revision to read at, such as `origin/main`.
 * @returns the scope `sprintScope` computes from what git holds at `ref`.
 */
export const sprintScopeRef = async (refs: Refs, scripts: Scripts, ref: string): Promise<SprintScope> => {
  const configured = await scripts.config('Sprint directory', DEFAULT_SPRINT_DIR);
  const sprintDir = isAnswered(configured) ? configured.value.trim().replace(/\/+$/, '') : DEFAULT_SPRINT_DIR;
  const activeDir = `${sprintDir}/active`;

  const listing = await refs.listBlobs(ref, activeDir);
  const files = isAnswered(listing)
    ? listing.value.filter((blob) => (blob.mode === '100644' || blob.mode === '100755') && blob.path.endsWith('.md'))
    : [];

  // `sprintScope` treats zero or more than one as the `none` case by COUNT
  // alone, so with more than one file nothing is worth reading: the count
  // alone is enough for it to refuse, and a placeholder entry per file
  // preserves that count without fetching content nothing will use.
  let sprintTexts: { content: string; slug: string }[] = files.map(() => ({ content: '', slug: '' }));
  if (files.length === 1) {
    const [file] = files;
    const content = await refs.showFile(ref, file!.path);
    sprintTexts = isAnswered(content) ? [{ content: content.value, slug: slugOf(file!.path) }] : [];
  }

  const pulse = await refs.pulse();

  return sprintScope({
    sprintTexts,
    pulse: isAnswered(pulse) ? pulse.value : null,
    planSlug,
  });
};
