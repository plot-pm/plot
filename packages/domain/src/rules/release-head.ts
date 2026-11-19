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

const VERSION_JSON_LINE = /^\s*"version":\s*"([^"]*)",?\s*$/;
const MARKETPLACE_LINE = /^(\s*)"(version|ref)":\s*"([^"]*)",?\s*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
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

/** The semver version the head writes into the root `package.json`, or `undefined` where it writes none. */
const releaseVersion = (reading: readonly FileChange[]): string | undefined => {
  const pkg = reading.find((change) => change.path === 'package.json');
  const values = (pkg?.hunks ?? []).flatMap((hunk) => hunk.added.flatMap((line) => VERSION_JSON_LINE.exec(line)?.[1] ?? []));
  return values.length === 1 && SEMVER.test(values[0]) ? values[0] : undefined;
};

/**
 * Whether a marketplace change replaces `version` and `ref` lines one for one,
 * each added line keeping the key and indentation of the line it replaces, and
 * every added ref reading `v<release>`.
 */
const onlyVersionAndTagLines = (change: FileChange, release: string | undefined): boolean => {
  if (change.status !== 'modified' || change.hunks.length === 0) return false;
  return change.hunks.every(
    (hunk) =>
      hunk.added.length > 0 &&
      hunk.added.length === hunk.removed.length &&
      hunk.added.every((line, i) => {
        const added = MARKETPLACE_LINE.exec(line);
        const removed = MARKETPLACE_LINE.exec(hunk.removed[i]);
        if (added === null || removed === null || added[1] !== removed[1] || added[2] !== removed[2]) return false;
        return added[2] === 'version' || (release !== undefined && added[3] === `v${release}`);
      }),
  );
};

/** Whether the changesets version step may write this change. */
const writtenByVersionStep = (change: FileChange, release: string | undefined): boolean => {
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
  if (path === '.claude-plugin/plugin.json') {
    return onlyVersionLines(change, VERSION_JSON_LINE);
  }
  if (path === '.claude-plugin/marketplace.json') {
    return onlyVersionAndTagLines(change, release);
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
 * metadata and each skill's `metadata.version`. In `marketplace.json` it also
 * replaces the `ref` line of an entry's source: each added ref must read
 * `v<version>`, where `<version>` is the semver version the head writes into
 * the root `package.json`, and each replaced line keeps its key and
 * indentation. Any other change, including a dependency line beside a version
 * line, is foreign. `.changeset/README.md`,
 * `config.json` and every non-markdown file there stay untouched.
 *
 * @param reading - the head's changes against its merge base with the default branch.
 * @returns the verdict; a failed read is `unaskable` and never `clean`.
 */
export const releaseHeadVerdict = (reading: ReleaseHeadReading): ReleaseHeadVerdict => {
  if (reading === 'unaskable') return { read: 'unaskable' };
  if (reading.length === 0) return { read: 'empty' };
  const release = releaseVersion(reading);
  const foreign = reading.find((change) => !writtenByVersionStep(change, release));
  return foreign === undefined ? { read: 'clean' } : { read: 'foreign', path: foreign.path };
};
