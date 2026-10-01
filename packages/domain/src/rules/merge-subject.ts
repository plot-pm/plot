/**
 * A merge commit on the default branch, as a walk reported it.
 */
export interface MergeSubject {
  /** The merge commit's hash — what an ancestry test is run against. */
  sha: string;
  /** The commit's subject line, unparsed. */
  subject: string;
}

/**
 * What was read, and what to look for in it.
 */
export interface MergeSubjectInput {
  /** The merges on the default branch, newest first or in any order. */
  subjects: readonly MergeSubject[];
  /** The branch names to look for — the refless branches of one plan. */
  branches: readonly string[];
  /**
   * The subject templates this host writes, each carrying `<branch>` and
   * optionally `<owner>` and `<number>`.
   *
   * Data from the caller, so this rule names no host. An empty list proves
   * nothing, which is the answer for a host whose merge subjects name no
   * branch.
   */
  forms: readonly string[];
  /**
   * The repository's own account, lowercased, or `null` where none was read.
   *
   * `null` matches any owner, which is what a local-path origin produces and
   * what this rule answered before an owner was read at all.
   */
  owner: string | null;
}

/**
 * One merge that names one branch.
 */
export interface MergeSubjectMatch {
  /** The merge commit's hash. */
  sha: string;
  /** The branch it names, as the caller spelled it. */
  branch: string;
}

/** The placeholder a form uses for the branch it names. */
const BRANCH = '<branch>';
/** The placeholder a form uses for the account the branch belonged to. */
const OWNER = '<owner>';
/** The placeholder a form uses for the pull request's number. */
const NUMBER = '<number>';

/**
 * Every regex metacharacter, escaped so a string matches as literal text.
 *
 * @param text - the text to match literally.
 * @returns the text with each metacharacter escaped.
 */
const literal = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

/**
 * Which branch each merge subject names, for the branches asked about.
 *
 * POSITIVE EVIDENCE ONLY. A subject that matches nothing is absence, and
 * absence keeps the caller's own answer.
 *
 * WHOLE-LINE MATCHES. A subject is the whole of one form or it matches
 * nothing, so `Revert "Merge pull request #12 from acme/x"` proves nothing
 * about `x` and neither does a subject carrying text after the branch.
 *
 * The branch and the owner match as LITERAL TEXT. A branch name may legally
 * hold `+`, `.`, `(` or `{`, and as a pattern each one changes the match:
 * `feature/v.1` would match `feature/vX1` and `bug/a+b` would fail to match
 * its own subject. The second is the quieter fault — a branch that silently
 * never matches simply keeps reading as unlanded.
 *
 * ONE PAIR PER MERGE, not per branch. A name merged twice yields two matches,
 * because which of them predates a plan is decided by an ancestry test the
 * caller runs per pair.
 *
 * @param input - the merges read, the branches asked about, the host's forms
 *   and the repository's own owner.
 * @returns one entry per merge that names an asked branch, in the order the
 *   merges were given. Empty where nothing matched, where no form was given,
 *   or where no branch was asked about.
 */
export const mergedBySubject = (input: MergeSubjectInput): MergeSubjectMatch[] => {
  const { subjects, branches, forms, owner } = input;
  // Built once per call rather than per subject: a walk carries up to 2000
  // merges and a plan a handful of branches, so compiling inside the loop
  // would build the same pattern thousands of times.
  const patterns = patternsFor(forms, branches, owner);
  if (patterns.length === 0) return [];
  const out: MergeSubjectMatch[] = [];
  for (const { sha, subject } of subjects) {
    // The FIRST match wins and the search stops. A form list may hold two
    // forms one subject fits, and a second match would report one merge as
    // proving one branch twice.
    const hit = patterns.find((p) => p.pattern.test(subject));
    if (hit !== undefined) out.push({ sha, branch: hit.branch });
  }
  return out;
};

/**
 * One compiled pattern, and the branch a subject matching it names.
 */
interface BranchPattern {
  /** The whole-line pattern for one form and one branch. */
  pattern: RegExp;
  /** The branch that pattern proves, as the caller spelled it. */
  branch: string;
}

/**
 * A pattern per form and branch, with the placeholders filled.
 *
 * A form naming no branch is dropped: it can prove nothing whatever it
 * matches, and matching it against every asked branch would report a merge as
 * proving a branch its subject never mentions.
 *
 * @param forms - the host's subject templates.
 * @param branches - the branches asked about.
 * @param owner - the repository's own owner, or `null` to accept any.
 * @returns one entry per form and branch that can match.
 */
const patternsFor = (
  forms: readonly string[],
  branches: readonly string[],
  owner: string | null,
): BranchPattern[] => {
  const out: BranchPattern[] = [];
  for (const form of forms) {
    if (!form.includes(BRANCH)) continue;
    for (const branch of branches) {
      out.push({ pattern: patternFor(form, branch, owner), branch });
    }
  }
  return out;
};

/**
 * The whole-line pattern for one form and one branch.
 *
 * THE FORM IS ESCAPED FIRST, then its placeholders are replaced. The
 * placeholders carry no metacharacter, so they survive escaping unchanged,
 * while the literal text around them does not: a form's own `(` is part of the
 * subject a host writes, and left unescaped it would open a group and let
 * `Merged in x pull request #4` match without its parentheses.
 *
 * @param form - one subject template.
 * @param branch - the branch to match literally.
 * @param owner - the owner to match without case, or `null` to accept any.
 * @returns a pattern anchored to both ends of the line.
 */
const patternFor = (form: string, branch: string, owner: string | null): RegExp => {
  const body = literal(form)
    .split(literal(BRANCH))
    .join(literal(branch))
    // A digit run. A subject whose number is not digits is a different
    // sentence, and a host does not write one.
    .split(literal(NUMBER))
    .join('\\d+')
    // THE OWNER MAY NOT REACH ACROSS A SEPARATOR. `[^/]+` for an unknown
    // owner, so `acme/extra/bug/flaky` does not match with the owner read as
    // `acme/extra` and the branch as `flaky` — the segment is one path
    // segment, which is what the form gives it.
    .split(literal(OWNER))
    .join(owner === null ? '[^/]+' : literal(owner));
  // `i` for the owner, which is compared without case. The branch is matched
  // literally and git ref names are case-sensitive, so a case-insensitive
  // branch match is a widening — accepted because the owner needs the flag and
  // a form holds one line: a subject differing from a branch only by case is a
  // shape no host writes, where an owner differing by case is measured.
  return new RegExp(`^${body}$`, owner === null ? '' : 'i');
};
