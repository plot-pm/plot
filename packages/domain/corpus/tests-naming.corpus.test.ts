import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext } from '../src/adapters/scripts.js';
import { isAnswered } from '../src/port-result.js';
import { searchTerms, testsNaming, type TestFile } from '../src/rules/local-checks.js';
import { compareField, describingAs, type Disagreement, type Sides } from './compare.js';

/**
 * The script-to-test map on this repository's estate: `testsNaming`, which CI
 * and `plot-local-checks.mjs` read, against `git grep -F` through
 * `Refs.filesNaming`, the reading `plot-local-checks.mjs` made before the map
 * moved into the domain.
 *
 * The subjects are every tracked script and bundle under `skills/` and
 * `scripts/`. The test files are the contract tests and the packages' test
 * files. A test reaches a script by naming it, so both sides read names; the
 * comparison holds the domain's reading of a test file's text to git's.
 *
 * On a disagreement the branch stops. Adjusting either side to make this pass
 * is the one move this tier forbids.
 */

const ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

/** The test files the map reads: the contract tests and every package test file. */
const TEST_GLOBS = ['test/reconcile/*.test.mjs', 'packages/*/test/**/*.test.ts', 'packages/*/corpus/*.test.ts'];

const SIDES: Sides = { left: 'rule', right: 'git-grep' };
const report = describingAs(SIDES);

const tracked = (pathspecs: readonly string[]): string[] =>
  execFileSync('git', ['ls-files', '--', ...pathspecs], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '');

describe('testsNaming agrees with git grep over the estate', () => {
  const tests: TestFile[] = tracked(TEST_GLOBS.map((glob) => `:(glob)${glob}`)).map((file) => ({
    path: file,
    text: readFileSync(path.join(ROOT, file), 'utf8'),
  }));
  const subjects = tracked([':(glob)skills/**/*.sh', ':(glob)skills/**/*.mjs', ':(glob)scripts/*.sh']);

  it('reads a non-empty estate', () => {
    expect(tests.length).toBeGreaterThan(100);
    expect(subjects.length).toBeGreaterThan(50);
  });

  it('maps plot-host.sh to the contract test that runs it', () => {
    const map = testsNaming(['skills/plot/scripts/plot-host.sh'], tests);
    expect(map.get('skills/plot/scripts/plot-host.sh')).toContain('test/reconcile/host.test.mjs');
  });

  it('names the same test files as git grep for every script and bundle', async () => {
    const refs = refsGit(shellContext(ROOT));
    const map = testsNaming(subjects, tests);
    const found: Disagreement[] = [];
    for (const subject of subjects) {
      const grep = new Set<string>();
      for (const term of searchTerms(subject)) {
        const read = await refs.filesNaming(term, TEST_GLOBS);
        if (!isAnswered(read)) throw new Error(`git grep could not answer for ${term}`);
        read.value.forEach((file) => grep.add(file));
      }
      compareField(found, subject, 'tests', map.get(subject), [...grep].sort());
    }
    expect(found.map(report)).toEqual([]);
  }, 120_000);
});
