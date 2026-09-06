/**
 * Why a changeset is refused, named rather than counted.
 *
 * `unknown-package` means the frontmatter names a package the workspace does
 * not have. `no-description` means the published description would be absent:
 * the first non-empty body line opens an HTML comment, declares a plan, or says
 * less than {@link MIN_DESCRIPTION} characters' worth.
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
 * A changeset split into the parts this rule measures.
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
  /**
   * The plan this changeset implements, as written on its `plan:` line, or
   * `undefined` when it names none.
   *
   * Optional by design. A changeset written by hand, or by a contributor with
   * no plan, is valid without one — so this is a fast path for the release
   * cross-check rather than a requirement, and its absence is not a refusal.
   */
  plan?: string;
  /**
   * Skill bump levels declared by the `bumps:` block, by skill name.
   *
   * Empty when the block is absent or names no skills. Parsed here because a
   * `plan:` reference and `bumps:` are the same kind of thing — a structured
   * comment in the body — and a parser that learned one and not the other
   * would leave the next reader to write the second half again.
   */
  bumps: Record<string, string>;
}

/** Whether a line is a frontmatter delimiter, ignoring surrounding blanks. */
const isDelimiter = (line: string): boolean => line.trim() === '---';

/**
 * What a plan reference looks like, wherever it is read or refused.
 *
 * A leading `#` is accepted because the block this line usually sits in is an
 * HTML comment whose contents some authors prefix; the reference is the same
 * statement either way.
 */
const PLAN_LINE = /^\s*(?:#\s*)?plan:\s*(\S.*?)\s*$/;

/**
 * The plan a body names, read from its `plan:` line.
 *
 * Read from the WHOLE body rather than from inside the comment block, because
 * the block is not required to exist and a `plan:` line outside one is the same
 * statement. What the line may not be is FIRST: Changesets publishes the first
 * non-empty line after the frontmatter, so a reference written above the prose
 * becomes the release note — the 11% failure `bumps:` already produced here.
 * {@link checkChangeset} refuses that through {@link isPlanLine}.
 *
 * The FIRST such line wins. A body naming two plans is already ambiguous, and
 * picking one deterministically beats reporting a link the file does not have.
 *
 * @param body The body lines from {@link parseChangeset}.
 * @returns The reference as written, trimmed, or `undefined` when absent.
 */
const planReference = (body: string[]): string | undefined => {
  for (const line of body) {
    const match = PLAN_LINE.exec(line);
    if (match) return match[1];
  }
  return undefined;
};

/**
 * Whether a line is a plan reference rather than prose.
 *
 * THE ORDER RULE NEEDS ITS OWN MEASUREMENT, and this is why. A `plan:` line
 * written first would be the published description, and neither existing check
 * catches it: the marker check looks for `<!--`, and `plan: docs/plans/x.md`
 * is 21 characters — one over {@link MIN_DESCRIPTION}, so the floor passes it.
 * It would publish as the release note, which is the same failure `bumps:`
 * produced in 19 of 169 entries. Measured by this rule's own test, which
 * failed until this existed.
 *
 * It shares {@link PLAN_LINE} with {@link planReference} deliberately: the
 * line a changeset may not open with and the line its link is read from are
 * one definition, so they cannot drift into disagreeing about what a plan
 * reference looks like.
 *
 * @param line One line, already trimmed.
 * @returns Whether it declares a plan.
 */
const isPlanLine = (line: string): boolean => PLAN_LINE.test(line);

/**
 * The skill bump levels a body declares under `bumps:`.
 *
 * Reads the `skills:` mapping CLAUDE.md documents — two levels of indentation
 * under `bumps:`, one `name: level` pair per skill. Stops at the comment close
 * or at a line that returns to column zero, so prose following the block is not
 * read as a skill.
 *
 * @param body The body lines from {@link parseChangeset}.
 * @returns Bump level by skill name; empty when the block names none.
 */
const bumpLevels = (body: string[]): Record<string, string> => {
  const bumps: Record<string, string> = {};
  let inSkills = false;
  let started = false;
  for (const line of body) {
    if (/^\s*bumps:\s*$/.test(line)) {
      started = true;
      continue;
    }
    if (!started) continue;
    if (/^\s*skills:\s*$/.test(line)) {
      inSkills = true;
      continue;
    }
    if (line.includes('--' + '>')) break;
    if (!inSkills) continue;
    const entry = /^\s+(\S+):\s*(\S+)\s*$/.exec(line);
    if (entry) bumps[entry[1]] = entry[2];
    else if (line.trim() !== '') break;
  }
  return bumps;
};

/**
 * Split a changeset's text into its frontmatter package names and its body.
 *
 * A file whose first non-empty line is not `---` has no frontmatter; it yields
 * no packages and its whole text as body, leaving the malformed-file complaint
 * to `changeset` itself. Quotes around a name are stripped, matching the
 * single- and double-quoted forms both in use.
 *
 * THE PLAN LINK IS READ FROM THE BODY, NEVER THE FRONTMATTER. Changesets owns
 * that block — package name and bump level — and a key it does not know is a
 * key its own parser must tolerate for the release to run at all.
 *
 * @param text The changeset file's full contents.
 * @returns The names the frontmatter declares, the lines beneath it, and the
 *   plan and skill bumps those lines declare.
 */
export const parseChangeset = (text: string): ChangesetParts => {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length || !isDelimiter(lines[i])) {
    return { packages: [], body: lines, plan: planReference(lines), bumps: bumpLevels(lines) };
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
  const body = lines.slice(i + 1);
  return { packages, body, plan: planReference(body), bumps: bumpLevels(body) };
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
 * A MISSING `plan:` LINE IS NOT A PROBLEM. The link is optional: a changeset
 * written by hand, or by a contributor with no plan, is valid without one, and
 * 0 of 19 changesets carried one when this was written — a gate refusing them
 * would refuse every changeset in flight. What IS refused is a `plan:` line
 * written first, and by the existing measurement rather than a new one: it
 * would be the published description, which is the same failure `bumps:`
 * produced 19 times in 169 published entries.
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
  if (
    description.startsWith('<!--') ||
    isPlanLine(description) ||
    description.length < MIN_DESCRIPTION
  ) {
    problems.push({ refusal: 'no-description', detail: description });
  }
  return problems;
};
