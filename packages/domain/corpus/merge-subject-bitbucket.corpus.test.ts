import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { mergeSubjectForms } from '../src/adapters/host/merge-subjects.js';
import { mergedBySubject } from '../src/rules/merge-subject.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * THE SIXTH RULE-VERSUS-SHELL COMPARISON: does `plot-reconcile-scan.sh`
 * section 22's Bitbucket case arm recover the same branch that
 * `mergedBySubject` does, over a corpus of Bitbucket merge subjects?
 *
 * WHY A DUPLICATE RATHER THAN A CALL. Section 22 runs once per `plot reconcile`
 * invocation — an operator command — which `docs/shell-and-domain.md` §1 would
 * ordinarily route through the domain. It stays a shell duplicate here because
 * the surrounding per-merge walk (`:2841-2954`) is itself untouched shell
 * doing a `git log`/`git diff` walk no bundle wraps; lifting one case arm into
 * a `node` hop while the walk around it stays bash would split one block across
 * languages for no saving. `reconcile-22-reports-every-merge-carried` is the
 * plan that drew this boundary: extend the shell `case`, declared here.
 *
 * WHAT IS PINNED, AND WHAT IS NOT. The branch-extraction case arm
 * `plot-reconcile-scan.sh` added for Bitbucket's
 * `Merged in <branch> (pull request #<number>)` is read out of the script's
 * text and wrapped in a sourceable function, so this file runs the real
 * parameter expansion and an edit to the script's arm reaches this test. The PR-NUMBER case arm is NOT pinned here:
 * `mergedBySubject` matches `<number>` only to anchor the pattern and never
 * returns it, so the rule names no PR number to compare the shell's `nc_pr`
 * against — a hand-rolled second regex standing in for "the rule" would be the
 * re-typed-copy-compared-with-itself this tier's README names as the failure
 * mode that proves nothing. The PR number's correctness is the shell's own
 * `test/reconcile/scan.test.mjs` test, which has no domain-side counterpart to
 * pin it against.
 *
 * NEITHER SIDE IS AUTHORITATIVE. The test says they agree. On a disagreement
 * the branch stops; adjusting either side's literal to force a pass is the one
 * move forbidden (`docs/shell-and-domain.md` §3).
 */

const SIDES: Sides = { left: 'rule', right: 'shell' };
const report = describingAs(SIDES);

const SCAN = new URL('../../../skills/plot/scripts/plot-reconcile-scan.sh', import.meta.url).pathname;

/**
 * The Bitbucket branch-extraction case arm, read from `plot-reconcile-scan.sh`:
 * the line holding its `"Merged in "*" (pull request #"*)` pattern through the
 * first line ending in `;;`, comment lines dropped.
 *
 * @throws when the script holds no such arm, so a renamed or removed arm fails
 *   here instead of comparing nothing.
 */
const extractArm = (text: string): string => {
  const lines = text.split('\n');
  const from = lines.findIndex((l) => l.trim() === '"Merged in "*" (pull request #"*)');
  const to = lines.findIndex((l, i) => i > from && l.trimEnd().endsWith(';;'));
  if (from < 0 || to < 0) throw new Error(`no Bitbucket "Merged in" case arm in ${SCAN}`);
  return lines.slice(from, to + 1).filter((l) => !l.trim().startsWith('#')).join('\n');
};

/** The arm wrapped as a function: one subject in, the branch it names (or '') out. */
const BITBUCKET_BRANCH_ARM = `
bitbucket_branch() {
  subj=$1
  nc_branch=""
  case "$subj" in
${extractArm(readFileSync(SCAN, 'utf8'))}
  esac
  printf '%s\\n' "$nc_branch"
}
`;

/** One subject to run through both sides, and the one branch it is asked about. */
interface Case {
  name: string;
  subject: string;
  branch: string;
}

const CASES: Case[] = [
  { name: 'plain branch', subject: 'Merged in bug/y (pull request #9)', branch: 'bug/y' },
  { name: 'idea branch', subject: 'Merged in idea/x (pull request #7)', branch: 'idea/x' },
  {
    name: 'nested path branch',
    subject: 'Merged in feature/a/b/c (pull request #123)',
    branch: 'feature/a/b/c',
  },
  {
    name: 'branch with a dot',
    subject: 'Merged in release/v.1 (pull request #4)',
    branch: 'release/v.1',
  },
  {
    name: 'branch with a plus',
    subject: 'Merged in bug/a+b (pull request #5)',
    branch: 'bug/a+b',
  },
  {
    name: 'large PR number',
    subject: 'Merged in bug/z (pull request #104329)',
    branch: 'bug/z',
  },
  // NOT Bitbucket's form — proves the pair agrees that neither side matches.
  {
    name: 'GitHub subject, not Bitbucket',
    subject: 'Merge pull request #9 from plot-pm/bug/y',
    branch: 'bug/y',
  },
  {
    name: 'git merge-branch subject, not Bitbucket',
    subject: "Merge branch 'bug/y'",
    branch: 'bug/y',
  },
];

/**
 * Every case's shell answer, from one bash process.
 *
 * ONE PROCESS FOR THE WHOLE CORPUS, as `sample.corpus.test.ts` does: a start
 * per subject would cost more than the comparison it is proving.
 */
const shellAnswers = (cases: readonly Case[]): string[] => {
  const stdin = cases.map((c) => c.subject).join('\n') + '\n';
  const script = `
    ${BITBUCKET_BRANCH_ARM}
    while IFS= read -r subj; do
      bitbucket_branch "$subj"
    done
  `;
  const out = execFileSync('bash', ['-c', script], {
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  });
  const lines = out.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

const shell = shellAnswers(CASES);

/** The rule's answer for one case: the branch it names, or '' for no match. */
const ruleBranch = (c: Case): string => {
  const hits = mergedBySubject({
    subjects: [{ sha: 'x', subject: c.subject }],
    branches: [c.branch],
    forms: mergeSubjectForms('bitbucket'),
    owner: null,
  });
  return hits.length > 0 ? hits[0].branch : '';
};

describe('the shell Bitbucket case arm agrees with mergedBySubject', () => {
  it('reads a corpus worth comparing', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(8);
    expect(shell.length).toBe(CASES.length);
  });

  it('exercises both a match and a non-match, so this is not vacuous', () => {
    expect(CASES.some((c) => ruleBranch(c) !== '')).toBe(true);
    expect(CASES.some((c) => ruleBranch(c) === '')).toBe(true);
    expect(shell.some((s) => s !== '')).toBe(true);
    expect(shell.some((s) => s === '')).toBe(true);
  });

  it('agrees on the branch named, for every subject', () => {
    const found: Disagreement[] = [];
    CASES.forEach((c, i) => {
      compareField(found, c.name, 'branch', ruleBranch(c), shell[i]);
    });
    expect(found.map(report)).toEqual([]);
  });

  it('recovers the motivating case: a Bitbucket merge shipping code, no changeset', () => {
    const c = CASES.find((one) => one.name === 'plain branch')!;
    const i = CASES.indexOf(c);
    expect(shell[i]).toBe('bug/y');
    expect(ruleBranch(c)).toBe('bug/y');
  });

  it('excludes an idea/* branch named by a Bitbucket subject, on both sides', () => {
    const c = CASES.find((one) => one.name === 'idea branch')!;
    const i = CASES.indexOf(c);
    expect(shell[i]).toBe('idea/x');
    expect(ruleBranch(c)).toBe('idea/x');
  });

  it('agrees that a GitHub-form subject names no branch under Bitbucket forms', () => {
    const c = CASES.find((one) => one.name === 'GitHub subject, not Bitbucket')!;
    const i = CASES.indexOf(c);
    expect(shell[i]).toBe('');
    expect(ruleBranch(c)).toBe('');
  });

  it('reports a disagreement naming the subject and both answers', () => {
    const line = report({ subject: 'plain branch', field: 'branch', adapter: 'bug/y', production: '' });
    expect(line).toBe('plain branch :: branch :: rule=bug/y shell=');
  });
});
