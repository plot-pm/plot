import type { HostBackend } from '../../ports/host.js';

/**
 * The merge subjects each host writes, as templates.
 *
 * DATA, NOT A RULE. {@link ../../rules/merge-subject.js} matches these and
 * names no host; this file names the hosts and matches nothing. The split is
 * the vendor boundary: a domain rule may not hold a vendor word, so the words
 * live here, in the adapter that already drives these two CLIs.
 *
 * A template carries up to three placeholders — `<branch>`, `<owner>` and
 * `<number>` — and every other character is literal text the host wrote.
 *
 * ## Why a backend may have none
 *
 * A host whose merge subject names no branch proves nothing, and the answer is
 * an empty list rather than a guess. Bitbucket Data Center writes
 * `Pull request #N: <title>`, which names a title; `plot-host.sh` drives only
 * Bitbucket Cloud, so that form is absent rather than wrong. Every branch on
 * such a host falls through to the host's own answer, as it does today.
 *
 * A squash or rebase merge carries one parent and no conforming subject at
 * all. Measured 2026-10-01 over 200 merged GitHub pull requests: 122 found by
 * subject, 78 squash or rebase, and each of the 78 falls through to the host.
 */
export const MERGE_SUBJECT_FORMS: Readonly<Record<string, readonly string[]>> = {
  /**
   * GitHub's default merge-commit subject.
   *
   * It names the OWNER as well as the branch, because the head may sit on a
   * fork. Measured 2026-10-01 on this repository: of 200 merged pull requests,
   * 22 first-parent subjects name another owner — 20 from before the
   * repository was transferred and four contributor forks.
   */
  github: ['Merge pull request #<number> from <owner>/<branch>'],
  /**
   * Bitbucket Cloud's default merge-commit subject.
   *
   * It names no owner, so the owner reading does not narrow it. Measured
   * 2026-10-01 on a Bitbucket estate: 1723 of 1723 `Merged in` subjects sit on
   * two-parent merges, so a `--merges` walk loses none.
   */
  bitbucket: ['Merged in <branch> (pull request #<number>)'],
};

/**
 * The subject templates one backend writes.
 *
 * @param backend - the backend word, as `plot-host.sh backend` answers it.
 * @returns the templates, or an empty list for a backend with none — which
 *   proves nothing and sends every branch to the host.
 */
export const mergeSubjectForms = (backend: HostBackend): readonly string[] =>
  MERGE_SUBJECT_FORMS[backend] ?? [];
