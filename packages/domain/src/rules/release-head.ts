import type { FileChange } from '../ports/refs.js';

/** The release head's changes against its merge base, as the caller read them; `unaskable` where the read failed. */
export type ReleaseHeadReading = readonly FileChange[] | 'unaskable';

/**
 * What the head's changes come to.
 *
 * - `clean`: every change is one the changesets version step writes.
 * - `foreign`: `path` is the first changed path the version step does not write.
 * - `empty`: the head changed nothing against its merge base, so no version step ran.
 * - `unaskable`: the changes could not be read.
 */
export type ReleaseHeadVerdict =
  | { read: 'clean' }
  | { read: 'foreign'; path: string }
  | { read: 'empty' }
  | { read: 'unaskable' };

const VERSION_JSON_LINE = /^\s*"version":\s*"[^"]*",?\s*$/;
const SKILL_VERSION_LINE = /^ {2}version:\s*\S+\s*$/;

/** Whether every changed line is a replaced version line: as many added as removed, each matching. */
const onlyVersionLines = (change: FileChange, isVersion: RegExp, section?: string): boolean => {
  if (change.status !== 'modified' || change.hunks.length === 0) return false;
  return change.hunks.every(
    (hunk) =>
      (section === undefined || hunk.section === section) &&
      hunk.added.length > 0 &&
      hunk.added.length === hunk.removed.length &&
      [...hunk.added, ...hunk.removed].every((line) => isVersion.test(line)),
  );
};

/** Whether the changesets version step may write this change. */
const writtenByVersionStep = (change: FileChange): boolean => {
  const { path } = change;
  if (/^\.changeset\/[^/]+\.md$/.test(path)) {
    return change.status === 'deleted' && path !== '.changeset/README.md';
  }
  if (path === 'CHANGELOG.md' || /^packages\/[^/]+\/CHANGELOG\.md$/.test(path)) {
    return change.status !== 'other';
  }
  if (path === 'package.json' || /^packages\/[^/]+\/package\.json$/.test(path)) {
    return onlyVersionLines(change, VERSION_JSON_LINE);
  }
  if (path === '.claude-plugin/plugin.json' || path === '.claude-plugin/marketplace.json') {
    return onlyVersionLines(change, VERSION_JSON_LINE);
  }
  if (/^skills\/[^/]+\/SKILL\.md$/.test(path)) {
    return onlyVersionLines(change, SKILL_VERSION_LINE, 'metadata:');
  }
  return false;
};

/**
 * Whether the release head changes only what the changesets version step writes.
 *
 * The version step deletes `.changeset/*.md` changesets, rewrites changelogs,
 * and replaces the `version` line of the package manifests, the plugin
 * metadata and each skill's `metadata.version`. Any other change, including a
 * dependency line beside a version line, is foreign. `.changeset/README.md`,
 * `config.json` and every non-markdown file there stay untouched.
 *
 * @param reading - the head's changes against its merge base with the default branch.
 * @returns the verdict; a failed read is `unaskable` and never `clean`.
 */
export const releaseHeadVerdict = (reading: ReleaseHeadReading): ReleaseHeadVerdict => {
  if (reading === 'unaskable') return { read: 'unaskable' };
  if (reading.length === 0) return { read: 'empty' };
  const foreign = reading.find((change) => !writtenByVersionStep(change));
  return foreign === undefined ? { read: 'clean' } : { read: 'foreign', path: foreign.path };
};
