/**
 * Why a changeset is refused, named rather than counted.
 *
 * `unknown-package` means the frontmatter names a package the workspace does
 * not have. `no-description` means the published description would be absent:
 * the first non-empty body line opens an HTML comment, or what it says is
 * shorter than {@link MIN_DESCRIPTION}.
 *
 * The two are distinct because their repairs are: one is a name to correct in
 * the frontmatter, the other is prose to move or write. A caller that collapses
 * them to a boolean can report that a file is bad and not what to do about it.
 */
export type ChangesetRefusal = 'unknown-package' | 'no-description';

/**
 * The shortest description this rule accepts, in characters.
 *
 * A labelled guess. It sits below anything a person writes — `Fix typo` is 8 —
 * and above what is produced with nothing to say: `.`, `wip`, `TODO`. If it
 * ever refuses a real description, the floor is wrong and not the description.
 */
export const MIN_DESCRIPTION = 20;

/** One refusal, and the reading it was taken from. */
export interface ChangesetProblem {
  /** Which measurement failed. */
  refusal: ChangesetRefusal;
  /**
   * The package name for `unknown-package`; the offending first line, trimmed,
   * for `no-description` — empty when there was no body line at all.
   */
  detail: string;
}

/**
 * A changeset split into the two parts this rule measures.
 *
 * Exported because the split is itself specified: which line counts as the
 * description is the whole of the defect, so it is tested directly rather than
 * only through {@link checkChangeset}.
 */
export interface ChangesetParts {
  /** Package names named by the frontmatter, in the order they appear. */
  packages: string[];
  /** Body lines — everything after the closing frontmatter delimiter. */
  body: string[];
}

/** Whether a line is a frontmatter delimiter, ignoring surrounding blanks. */
const isDelimiter = (line: string): boolean => line.trim() === '---';

/**
 * Split a changeset's text into its frontmatter package names and its body.
 *
 * A file whose first non-empty line is not `---` has no frontmatter; it yields
 * no packages and its whole text as body, leaving the malformed-file complaint
 * to `changeset` itself. Quotes around a name are stripped, matching the
 * single- and double-quoted forms both in use.
 *
 * @param text The changeset file's full contents.
 * @returns The names the frontmatter declares, and the lines beneath it.
 */
export const parseChangeset = (text: string): ChangesetParts => {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length || !isDelimiter(lines[i])) {
    return { packages: [], body: lines };
  }
  const packages: string[] = [];
  i++;
  while (i < lines.length && !isDelimiter(lines[i])) {
    const colon = lines[i].indexOf(':');
    if (colon !== -1) {
      const name = lines[i]
        .slice(0, colon)
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .trim();
      if (name !== '') packages.push(name);
    }
    i++;
  }
  return { packages, body: lines.slice(i + 1) };
};

/**
 * The line Changesets would publish as the description.
 *
 * Changesets takes the body's first non-empty line, whatever it is — which is
 * why a `bumps:` comment written first is published in place of the prose
 * behind it.
 *
 * @param body The body lines from {@link parseChangeset}.
 * @returns The first non-empty line, trimmed, or `''` when the body is empty.
 */
export const publishedDescription = (body: string[]): string => {
  for (const line of body) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
  }
  return '';
};

/**
 * Whether a changeset is valid, and every reason it is not.
 *
 * Checks syntax and size, never meaning: that the frontmatter names packages
 * the workspace has, and that the line Changesets would publish is prose rather
 * than a comment marker or a placeholder. Whether a description is *good* is
 * not measured, because a gate that judges wording is one people route around.
 *
 * Every problem is reported, not just the first, so one run names everything a
 * contributor must fix.
 *
 * @param text The changeset file's full contents.
 * @param workspacePackages The package names the workspace actually has,
 *   derived by the caller from the workspace's own manifests. Passed in because
 *   the domain reads no disk; a name absent from this list is unknown.
 * @returns One entry per failed measurement, empty when the changeset is valid.
 */
export const checkChangeset = (
  text: string,
  workspacePackages: readonly string[],
): ChangesetProblem[] => {
  const { packages, body } = parseChangeset(text);
  const problems: ChangesetProblem[] = packages
    .filter((name) => !workspacePackages.includes(name))
    .map((name) => ({ refusal: 'unknown-package' as const, detail: name }));

  const description = publishedDescription(body);
  if (description.startsWith('<!--') || description.length < MIN_DESCRIPTION) {
    problems.push({ refusal: 'no-description', detail: description });
  }
  return problems;
};
