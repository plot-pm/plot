import { describe, expect, it } from 'vitest';

import {
  CORPUS_SUITE,
  candidateTests,
  ciSelection,
  corpusGlobs,
  globRoot,
  isTestFile,
  localChecks,
  parseLocalChecks,
  testsNaming,
  type SelectionReadings,
  type TestFile,
} from '../src/rules/local-checks.js';

/** The repository's own `Local checks` shape, cut to one check of each kind. */
const CHECKS = parseLocalChecks(
  'test/reconcile/*.test.mjs = node --test {tests}; ' +
    'packages/domain/** = pnpm --filter @plot-pm/domain exec vitest related --run {changed}; ' +
    'packages/domain/src/** = pnpm --filter @plot-pm/domain exec tsc --noEmit -p .; ' +
    '** = ./scripts/check-script-names.sh',
);

const HOST_TEST: TestFile = {
  path: 'test/reconcile/host.test.mjs',
  text: "const host = path.join(scripts, 'plot-host.sh');\n",
};
const QUEUE_TEST: TestFile = {
  path: 'packages/domain/test/queue.test.ts',
  text: "import { queue } from '../src/rules/queue.js';\nconst script = 'plot-merge-queue.sh';\n",
};
const UNRELATED: TestFile = { path: 'test/reconcile/reap.test.mjs', text: "'plot-reap.sh'\n" };

const selection = (over: Partial<SelectionReadings>): SelectionReadings => ({
  changed: [],
  generated: [],
  checks: CHECKS,
  tests: [HOST_TEST, QUEUE_TEST, UNRELATED],
  corpus: corpusGlobs('docs/plans/', 'docs/sprints/'),
  ...over,
});

describe('isTestFile', () => {
  it('marks `*.test.*` and `*.spec.*` JavaScript and TypeScript files', () => {
    expect(isTestFile('test/reconcile/host.test.mjs')).toBe(true);
    expect(isTestFile('packages/board/src/a.spec.tsx')).toBe(true);
    expect(isTestFile('packages/domain/corpus/refs.corpus.test.ts')).toBe(true);
    expect(isTestFile('packages/domain/src/rules/queue.ts')).toBe(false);
    expect(isTestFile('docs/test.md')).toBe(false);
  });
});

describe('globRoot', () => {
  it('names the directory before the first wildcard segment', () => {
    expect(globRoot('test/reconcile/*.test.mjs')).toBe('test/reconcile');
    expect(globRoot('packages/domain/**')).toBe('packages/domain');
    expect(globRoot('packages/*/src/**')).toBe('packages');
    expect(globRoot('docs/plans/x.md')).toBe('docs/plans');
  });

  it('answers `.` for a glob that starts at the repository root', () => {
    expect(globRoot('**')).toBe('.');
    expect(globRoot('*.md')).toBe('.');
    expect(globRoot('CLAUDE.md')).toBe('.');
  });
});

describe('candidateTests', () => {
  it('keeps a path under a `{tests}` glob and only a test file under a `{changed}` glob, each once', () => {
    expect(
      candidateTests(
        [
          'test/reconcile/host.test.mjs',
          'test/reconcile/helpers.mjs',
          'packages/domain/test/queue.test.ts',
          'packages/domain/src/rules/queue.ts',
          'scripts/check-script-names.sh',
          'test/reconcile/host.test.mjs',
        ],
        CHECKS,
      ),
    ).toEqual(['packages/domain/test/queue.test.ts', 'test/reconcile/host.test.mjs']);
  });

  it('keeps nothing when no check has a placeholder', () => {
    expect(candidateTests(['test/reconcile/host.test.mjs'], parseLocalChecks('** = echo ok'))).toEqual([]);
  });
});

describe('testsNaming', () => {
  it('maps a changed script to the test files that name it', () => {
    const map = testsNaming(['skills/plot/scripts/plot-host.sh'], [HOST_TEST, UNRELATED]);
    expect(map.get('skills/plot/scripts/plot-host.sh')).toEqual(['test/reconcile/host.test.mjs']);
  });

  it('maps a TypeScript source through its `.js` import name', () => {
    const map = testsNaming(['packages/domain/src/rules/queue.ts'], [QUEUE_TEST, HOST_TEST]);
    expect(map.get('packages/domain/src/rules/queue.ts')).toEqual(['packages/domain/test/queue.test.ts']);
  });

  it('answers an empty list for a path nothing names, and each test once', () => {
    const twice: TestFile = { path: 'test/reconcile/b.test.mjs', text: 'plot-host.sh plot-host.sh' };
    const map = testsNaming(['docs/x.md', 'skills/plot/scripts/plot-host.sh'], [twice, HOST_TEST, twice]);
    expect(map.get('docs/x.md')).toEqual([]);
    expect(map.get('skills/plot/scripts/plot-host.sh')).toEqual([
      'test/reconcile/b.test.mjs',
      'test/reconcile/host.test.mjs',
    ]);
  });
});

describe('corpusGlobs', () => {
  it('turns the plan and sprint directories into globs and adds `.plot/`', () => {
    expect(corpusGlobs('docs/plans/', './docs/sprints')).toEqual(['docs/plans/**', 'docs/sprints/**', '.plot/**']);
  });

  it('skips an empty directory', () => {
    expect(corpusGlobs(' ', 'docs/sprints/')).toEqual(['docs/sprints/**', '.plot/**']);
  });
});

describe('ciSelection', () => {
  it('a changed script selects the test that runs it', () => {
    const answer = ciSelection(selection({ changed: ['skills/plot/scripts/plot-host.sh'] }));
    expect(answer.tests).toEqual(['test/reconcile/host.test.mjs']);
    expect(answer.checks[0]).toEqual({
      suite: 'test/reconcile',
      command: 'node --test test/reconcile/host.test.mjs',
      tests: ['test/reconcile/host.test.mjs'],
      always: false,
    });
    expect(answer.untested).toEqual([]);
  });

  it('a new test file is selected with no registration', () => {
    const fresh: TestFile = { path: 'test/reconcile/brand-new.test.mjs', text: 'spawnSync("bash", [x, "plot-novel.sh"])' };
    const answer = ciSelection(
      selection({ changed: ['skills/plot/scripts/plot-novel.sh'], tests: [HOST_TEST, fresh] }),
    );
    expect(answer.tests).toEqual(['test/reconcile/brand-new.test.mjs']);
  });

  it('selects every naming test, with no limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ path: `test/reconcile/t${i}.test.mjs`, text: 'plot-host.sh' }));
    const answer = ciSelection(selection({ changed: ['skills/plot/scripts/plot-host.sh'], tests: many }));
    expect(answer.tests).toHaveLength(50);
  });

  it('a changed plan, sprint or `.plot/` file answers corpus', () => {
    for (const path of ['docs/plans/2026-10-30-x.md', 'docs/sprints/2026-w44.md', '.plot/briefs/x.md']) {
      const answer = ciSelection(selection({ changed: [path] }));
      expect(answer.corpus, path).toBe(true);
      expect(answer.suites, path).toContain(CORPUS_SUITE);
      expect(answer.untested, path).toEqual([]);
    }
  });

  it('a change outside plan data does not answer corpus', () => {
    const answer = ciSelection(selection({ changed: ['skills/plot/scripts/plot-host.sh'] }));
    expect(answer.corpus).toBe(false);
    expect(answer.suites).not.toContain(CORPUS_SUITE);
  });

  it('a changed path no check reaches stays in untested', () => {
    const answer = ciSelection(selection({ changed: ['docs/notes/x.md', 'docs/plans/y.md'] }));
    expect(answer.untested).toEqual(['docs/notes/x.md']);
  });

  it('runs the checks with no placeholder on every change, and they reach no path', () => {
    const answer = ciSelection(selection({ changed: ['README.md'] }));
    expect(answer.checks).toEqual([
      {
        suite: 'packages/domain/src',
        command: 'pnpm --filter @plot-pm/domain exec tsc --noEmit -p .',
        tests: [],
        always: true,
      },
      { suite: '.', command: './scripts/check-script-names.sh', tests: [], always: true },
    ]);
    expect(answer.suites).toEqual(['.', 'packages/domain/src']);
    expect(answer.untested).toEqual(['README.md']);
  });

  it('an empty change still runs the always checks', () => {
    const answer = ciSelection(selection({ changed: [] }));
    expect(answer.checks.map((check) => check.always)).toEqual([true, true]);
    expect(answer.tests).toEqual([]);
    expect(answer.corpus).toBe(false);
  });

  it('a script a vitest test names by path selects that test through `{changed}`', () => {
    const answer = ciSelection(selection({ changed: ['skills/plot/scripts/plot-merge-queue.sh'] }));
    const vitest = answer.checks.find((check) => check.suite === 'packages/domain');
    expect(vitest).toEqual({
      suite: 'packages/domain',
      command: 'pnpm --filter @plot-pm/domain exec vitest related --run packages/domain/test/queue.test.ts',
      tests: ['packages/domain/test/queue.test.ts'],
      always: false,
    });
    expect(answer.tests).toEqual(['packages/domain/test/queue.test.ts']);
    expect(answer.untested).toEqual([]);
  });

  it('leaves a TypeScript source to the import graph rather than to the tests naming it', () => {
    const answer = ciSelection(
      selection({ changed: ['packages/domain/src/rules/queue.ts'], root: '/repo' }),
    );
    const vitest = answer.checks.find((check) => check.suite === 'packages/domain');
    expect(vitest?.command).toBe(
      'pnpm --filter @plot-pm/domain exec vitest related --run /repo/packages/domain/src/rules/queue.ts',
    );
    expect(vitest?.tests).toEqual([]);
  });

  it('a naming file that is not a test, or lies outside the glob, selects nothing through `{changed}`', () => {
    const helper: TestFile = { path: 'packages/domain/test/helpers.ts', text: 'plot-novel.sh' };
    const other: TestFile = { path: 'packages/board/test/a.test.ts', text: 'plot-novel.sh' };
    const answer = ciSelection(
      selection({ changed: ['skills/plot/scripts/plot-novel.sh'], tests: [helper, other] }),
    );
    expect(answer.checks.filter((check) => !check.always)).toEqual([]);
    expect(answer.untested).toEqual(['skills/plot/scripts/plot-novel.sh']);
  });

  it('a generated path selects nothing and is not reported', () => {
    const answer = ciSelection(
      selection({
        changed: ['skills/plot/scripts/board/plot-host.sh'],
        generated: ['skills/plot/scripts/board/plot-host.sh'],
      }),
    );
    expect(answer.tests).toEqual([]);
    expect(answer.untested).toEqual([]);
  });
});

describe('localChecks with a `{changed}` check', () => {
  it('adds the test files under the glob that name a changed script', () => {
    const answer = localChecks({
      changed: ['skills/plot/scripts/plot-merge-queue.sh'],
      generated: [],
      references: testsNaming(['skills/plot/scripts/plot-merge-queue.sh'], [QUEUE_TEST]),
      checks: CHECKS,
      limit: 20,
    });
    expect(answer.commands).toEqual([
      'pnpm --filter @plot-pm/domain exec vitest related --run packages/domain/test/queue.test.ts',
      './scripts/check-script-names.sh',
    ]);
    expect(answer.tests).toEqual(['packages/domain/test/queue.test.ts']);
  });
});

describe('the limit counts only the references a check can run', () => {
  it('a TypeScript source imported by many vitest tests is not over the limit for the runner glob', () => {
    const importers = Array.from({ length: 30 }, (_, i) => `packages/domain/test/t${i}.test.ts`);
    const answer = localChecks({
      changed: ['packages/domain/src/rules/queue.ts'],
      generated: [],
      references: new Map([['packages/domain/src/rules/queue.ts', [...importers, 'test/reconcile/queue.test.mjs']]]),
      checks: CHECKS,
      limit: 20,
    });
    expect(answer.overLimit).toEqual([]);
    expect(answer.tests).toEqual(['test/reconcile/queue.test.mjs']);
  });

  it('a non-test file under both a `{tests}` and a `{changed}` glob runs only through `{tests}`', () => {
    const answer = localChecks({
      changed: ['skills/x.sh'],
      generated: [],
      references: new Map([['skills/x.sh', ['test/fixtures/data.mjs']]]),
      checks: parseLocalChecks('test/** = node --test {tests}; ** = vitest related --run {changed}'),
      limit: 20,
    });
    expect(answer.commands).toEqual(['node --test test/fixtures/data.mjs', 'vitest related --run skills/x.sh']);
  });
});
