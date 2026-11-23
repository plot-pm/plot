import { describe, it, expect } from 'vitest';
import {
  ciSelection,
  corpusGlobs,
  estateReaders,
  globToRegExp,
  localChecks,
  plotReads,
  parseList,
  parseLocalChecks,
  searchTerms,
  shellWord,
  testsNaming,
  type BundleEntry,
  type LocalChecksReadings,
  type SelectionReadings,
  type TestFile,
} from '../src/rules/local-checks.js';

const CHECKS = parseLocalChecks(
  'test/reconcile/*.test.mjs = node --test {tests}; ' +
    'packages/domain/** = pnpm --filter @plot-pm/domain exec vitest related --run {changed}; ' +
    'packages/domain/src/** = pnpm --filter @plot-pm/domain exec tsc --noEmit',
);

const readings = (over: Partial<LocalChecksReadings>): LocalChecksReadings => ({
  changed: [],
  generated: [],
  references: new Map(),
  checks: CHECKS,
  limit: 20,
  ...over,
});

describe('parseLocalChecks', () => {
  it('reads `;`-separated `glob = command` pairs in order', () => {
    expect(CHECKS.map((check) => check.glob)).toEqual([
      'test/reconcile/*.test.mjs',
      'packages/domain/**',
      'packages/domain/src/**',
    ]);
    expect(CHECKS[0].command).toBe('node --test {tests}');
  });

  it('skips a pair without `=` or with an empty side, and an empty value', () => {
    expect(parseLocalChecks('nothing here; = cmd; glob = ; a/** = run')).toEqual([{ glob: 'a/**', command: 'run' }]);
    expect(parseLocalChecks('')).toEqual([]);
  });

  it('keeps a command that itself contains `=`', () => {
    expect(parseLocalChecks('a/** = FOO=1 run')).toEqual([{ glob: 'a/**', command: 'FOO=1 run' }]);
  });
});

describe('parseList', () => {
  it('reads a `;`-separated list', () => {
    expect(parseList(' pnpm run test:e2e ; pnpm run test:board;')).toEqual(['pnpm run test:e2e', 'pnpm run test:board']);
  });
});

describe('globToRegExp', () => {
  it('keeps `*` inside one segment and lets `**` cross segments', () => {
    expect(globToRegExp('test/reconcile/*.test.mjs').test('test/reconcile/host.test.mjs')).toBe(true);
    expect(globToRegExp('test/reconcile/*.test.mjs').test('test/reconcile/sub/host.test.mjs')).toBe(false);
    expect(globToRegExp('packages/domain/**').test('packages/domain/src/rules/x.ts')).toBe(true);
    expect(globToRegExp('**/*.test.ts').test('a.test.ts')).toBe(true);
    expect(globToRegExp('**/*.test.ts').test('packages/a/b.test.ts')).toBe(true);
  });

  it('lets `?` match one character inside a segment', () => {
    expect(globToRegExp('v?.ts').test('v1.ts')).toBe(true);
    expect(globToRegExp('v?.ts').test('v12.ts')).toBe(false);
    expect(globToRegExp('a?b').test('a/b')).toBe(false);
  });

  it('treats regex characters in a glob literally', () => {
    expect(globToRegExp('a+b.(c)').test('a+b.(c)')).toBe(true);
    expect(globToRegExp('a+b.(c)').test('aab.c')).toBe(false);
  });
});

describe('searchTerms', () => {
  it('searches a script by its basename', () => {
    expect(searchTerms('skills/plot/scripts/plot-dispatch.sh')).toEqual(['plot-dispatch.sh']);
  });

  it('searches a TypeScript source also by its `.js` import form', () => {
    expect(searchTerms('packages/domain/src/rules/queue.ts')).toEqual(['queue.ts', 'queue.js']);
  });
});

describe('localChecks', () => {
  it('a changed script selects every test file naming it inside the runner glob, and no typecheck', () => {
    const answer = localChecks(
      readings({
        changed: ['skills/plot/scripts/plot-reap.sh'],
        references: new Map([
          ['skills/plot/scripts/plot-reap.sh', ['test/reconcile/reap.test.mjs', 'test/reconcile/sweep.test.mjs', 'docs/x.md']],
        ]),
      }),
    );
    expect(answer.commands).toEqual(['node --test test/reconcile/reap.test.mjs test/reconcile/sweep.test.mjs']);
    expect(answer.untested).toEqual([]);
  });

  it('a changed domain rule runs the related tests on it and the typecheck', () => {
    const answer = localChecks(readings({ changed: ['packages/domain/src/rules/queue.ts'] }));
    expect(answer.commands).toEqual([
      'pnpm --filter @plot-pm/domain exec vitest related --run packages/domain/src/rules/queue.ts',
      'pnpm --filter @plot-pm/domain exec tsc --noEmit',
    ]);
  });

  it('a changed test file selects itself', () => {
    const answer = localChecks(readings({ changed: ['test/reconcile/reap.test.mjs'] }));
    expect(answer.commands).toEqual(['node --test test/reconcile/reap.test.mjs']);
    expect(answer.tests).toEqual(['test/reconcile/reap.test.mjs']);
  });

  it('a generated path selects nothing and is not reported', () => {
    const answer = localChecks(
      readings({
        changed: ['skills/plot/scripts/board/board-server.mjs'],
        generated: ['skills/plot/scripts/board/board-server.mjs'],
        references: new Map([['skills/plot/scripts/board/board-server.mjs', ['test/reconcile/a.test.mjs']]]),
      }),
    );
    expect(answer).toEqual({ commands: [], tests: [], overLimit: [], estateTests: [], untested: [] });
  });

  it('a path named by more test files than the limit is reported, and selects none of them', () => {
    const many = Array.from({ length: 21 }, (_, i) => `test/reconcile/t${i}.test.mjs`);
    const answer = localChecks(
      readings({
        changed: ['skills/plot/scripts/plot-dispatch.sh'],
        references: new Map([['skills/plot/scripts/plot-dispatch.sh', many]]),
      }),
    );
    expect(answer.commands).toEqual([]);
    expect(answer.overLimit).toEqual([{ path: 'skills/plot/scripts/plot-dispatch.sh', count: 21 }]);
    expect(answer.untested).toEqual([]);
  });

  it('exactly the limit still selects', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `test/reconcile/t${i}.test.mjs`);
    const answer = localChecks(
      readings({ changed: ['skills/plot/scripts/x.sh'], references: new Map([['skills/plot/scripts/x.sh', twenty]]) }),
    );
    expect(answer.tests).toHaveLength(20);
    expect(answer.overLimit).toEqual([]);
  });

  it('a path no check reaches is reported untested', () => {
    const answer = localChecks(readings({ changed: ['docs/plans/x.md', 'skills/plot/scripts/y.sh'] }));
    expect(answer.commands).toEqual([]);
    expect(answer.untested).toEqual(['docs/plans/x.md', 'skills/plot/scripts/y.sh']);
  });

  it('no declared checks select nothing and report every path untested', () => {
    const answer = localChecks(readings({ checks: [], changed: ['a.ts', 'b.sh'] }));
    expect(answer.commands).toEqual([]);
    expect(answer.untested).toEqual(['a.ts', 'b.sh']);
  });

  it('lists each test once when two changed paths name it, and each command once', () => {
    const answer = localChecks(
      readings({
        changed: ['skills/plot/scripts/a.sh', 'skills/plot/scripts/b.sh'],
        references: new Map([
          ['skills/plot/scripts/a.sh', ['test/reconcile/both.test.mjs']],
          ['skills/plot/scripts/b.sh', ['test/reconcile/both.test.mjs']],
        ]),
      }),
    );
    expect(answer.commands).toEqual(['node --test test/reconcile/both.test.mjs']);
  });

  it('fills the placeholders with absolute paths when the root is given', () => {
    const answer = localChecks(
      readings({ root: '/repo/', changed: ['packages/domain/src/a.ts', 'test/reconcile/t.test.mjs'] }),
    );
    expect(answer.commands).toEqual([
      'node --test /repo/test/reconcile/t.test.mjs',
      'pnpm --filter @plot-pm/domain exec vitest related --run /repo/packages/domain/src/a.ts',
      'pnpm --filter @plot-pm/domain exec tsc --noEmit',
    ]);
    expect(answer.tests).toEqual(['test/reconcile/t.test.mjs']);
  });

  it('a check with no placeholder runs once for many matching paths', () => {
    const answer = localChecks(
      readings({ changed: ['packages/domain/src/a.ts', 'packages/domain/src/b.ts'], checks: [CHECKS[2]] }),
    );
    expect(answer.commands).toEqual(['pnpm --filter @plot-pm/domain exec tsc --noEmit']);
  });
});

describe('shellWord', () => {
  it('keeps a plain path as written and single-quotes one the shell would split or expand', () => {
    expect(shellWord('packages/domain/src/a-b_c.ts')).toBe('packages/domain/src/a-b_c.ts');
    expect(shellWord('docs/a b.md')).toBe("'docs/a b.md'");
    expect(shellWord("docs/it's $HOME.md")).toBe("'docs/it'\\''s $HOME.md'");
  });

  it('quotes a changed path with a space where {changed} fills it', () => {
    const answer = localChecks(readings({ changed: ['packages/domain/src/a b.ts'] }));
    expect(answer.commands[0]).toBe("pnpm --filter @plot-pm/domain exec vitest related --run 'packages/domain/src/a b.ts'");
  });
});

describe('declaration order', () => {
  it('prints commands in the order the key declares them, whatever order the paths arrive in', () => {
    const checks = parseLocalChecks('src/** = echo first; test/*.test.mjs = node --test {tests}; ** = echo last');
    const references = new Map([['src/a.ts', ['test/a.test.mjs']]]);
    const forward = localChecks(readings({ checks, changed: ['src/a.ts', 'test/a.test.mjs'], references }));
    const reverse = localChecks(readings({ checks, changed: ['test/a.test.mjs', 'src/a.ts'], references }));
    expect(forward.commands).toEqual(reverse.commands);
    expect(forward.commands[0]).toBe('echo first');
    expect(forward.commands.at(-1)).toBe('echo last');
  });
});

describe('estate readers', () => {
  const CORPUS = corpusGlobs('docs/plans/', 'docs/sprints/');
  const PLAN = 'docs/plans/x.md';
  const PLANS_READER: TestFile = { path: 'test/reconcile/parser.test.mjs', text: '// plot-reads: docs/plans\nreaddirSync(plansDir);\n' };
  const SPRINTS_READER: TestFile = { path: 'test/reconcile/sprint.test.mjs', text: '// plot-reads: docs/sprints\n' };
  const UNMARKED: TestFile = { path: 'test/reconcile/walk.test.mjs', text: "readdirSync(path.join(repoRoot, 'docs', 'plans'));\n" };
  const BASENAME: TestFile = { path: 'test/reconcile/fixture.test.mjs', text: "const plan = 'x.md';\n" };
  const TESTS = [PLANS_READER, SPRINTS_READER, UNMARKED, BASENAME];

  const local = (changed: readonly string[], tests: readonly TestFile[]) =>
    localChecks({ ...readings({ changed }), references: new Map(changed.map((path) => [path, tests.map((t) => t.path)])), corpus: CORPUS, tests });
  const ci = (changed: readonly string[], tests: readonly TestFile[]) =>
    ciSelection({
      changed,
      generated: [],
      checks: CHECKS,
      tests,
      corpus: CORPUS,
      corpusFiles: [],
      sync: { planDir: 'docs/plans/', activeIndex: 'docs/plans/active/', deliveredIndex: 'docs/plans/delivered/', sprintDir: 'docs/sprints/', releaseDir: 'docs/releases/' },
    } satisfies SelectionReadings);

  it('reads one directory per `// plot-reads:` line, without `./` or a trailing `/`', () => {
    expect(plotReads('// plot-reads: ./docs/plans/\n  // plot-reads: docs/sprints\nconst x = 1; // plot-reads: nope\n')).toEqual([
      'docs/plans',
      'docs/sprints',
    ]);
  });

  it('a changed plan selects a test marked `docs/plans` and not an unmarked one', () => {
    expect(estateReaders([PLAN, 'skills/plot/a.sh'], CORPUS, TESTS)).toEqual(new Map([[PLAN, [PLANS_READER.path]]]));
    expect(local([PLAN], TESTS).estateTests).toEqual([PLANS_READER.path]);
    expect(ci([PLAN], TESTS).estateTests).toEqual([PLANS_READER.path]);
  });

  it('a test marked `docs/sprints` is not selected by a plan path, and is by a sprint path', () => {
    expect(local([PLAN], [SPRINTS_READER]).estateTests).toEqual([]);
    expect(ci([PLAN], [SPRINTS_READER]).estateTests).toEqual([]);
    expect(ci(['docs/sprints/s.md'], TESTS).estateTests).toEqual([SPRINTS_READER.path]);
  });

  it('a plan path selects no test that only names its basename, in localChecks and in ciSelection', () => {
    const answer = local([PLAN], [BASENAME]);
    expect(answer.commands).toEqual([]);
    expect(answer.tests).toEqual([]);
    expect(answer.untested).toEqual([PLAN]);
    const selected = ci([PLAN], [BASENAME]);
    expect(selected.tests).toEqual([]);
    expect(selected.estateTests).toEqual([]);
  });

  it('runs the estate readers locally through the check whose glob holds them', () => {
    const answer = local([PLAN], TESTS);
    expect(answer.commands).toEqual(['node --test test/reconcile/parser.test.mjs']);
    expect(answer.untested).toEqual([]);
  });

  it('selects 25 marked tests, and reports none of them in overLimit', () => {
    const marked = Array.from({ length: 25 }, (_, i): TestFile => ({
      path: `test/reconcile/estate-${String(i).padStart(2, '0')}.test.mjs`,
      text: '// plot-reads: docs/plans\n',
    }));
    const answer = local([PLAN], marked);
    expect(answer.estateTests).toEqual(marked.map((t) => t.path));
    expect(answer.overLimit).toEqual([]);
    expect(answer.commands).toEqual([`node --test ${marked.map((t) => t.path).join(' ')}`]);
    expect(ci([PLAN], marked).estateTests).toEqual(marked.map((t) => t.path));
  });

  it('localChecks and ciSelection answer the same estateTests for one input', () => {
    const changed = [PLAN, 'docs/sprints/s.md', 'skills/plot/scripts/plot-host.sh'];
    expect(local(changed, TESTS).estateTests).toEqual(ci(changed, TESTS).estateTests);
    expect(ci(changed, TESTS).estateTests).toEqual([PLANS_READER.path, SPRINTS_READER.path]);
  });

  it('keeps the estate readers out of the CI checks, which the job map reads apart', () => {
    const selected = ci([PLAN], TESTS);
    expect(selected.checks.every((check) => check.tests.length === 0)).toBe(true);
    expect(selected.corpus).toBe(true);
  });
});

describe('bundle entries', () => {
  const ENTRY = 'packages/board/src/server/entry/needs-design.ts';
  const PAIR: BundleEntry = { entry: ENTRY, shipped: 'skills/plot/scripts/board/plot-needs-design.mjs' };
  const BUNDLE_TEST: TestFile = {
    path: 'test/reconcile/needs-design-entry.test.mjs',
    text: "const bundle = path.join(repoRoot, 'skills/plot/scripts/board/plot-needs-design.mjs');\n",
  };
  const OTHER: TestFile = { path: 'test/reconcile/other.test.mjs', text: "spawnSync('plot-ask.mjs');\n" };
  const TESTS = [BUNDLE_TEST, OTHER];
  const BOARD_CHECKS = parseLocalChecks('test/reconcile/*.test.mjs = node --test {tests}; packages/board/** = vitest related --run {changed}');

  const local = (changed: readonly string[], bundles?: readonly BundleEntry[]) =>
    localChecks({ ...readings({ changed, checks: BOARD_CHECKS }), references: testsNaming(changed, TESTS), tests: TESTS, bundles });
  const ci = (changed: readonly string[], bundles?: readonly BundleEntry[]) =>
    ciSelection({
      changed,
      generated: [],
      checks: BOARD_CHECKS,
      tests: TESTS,
      corpus: [],
      corpusFiles: [],
      sync: { planDir: 'docs/plans/', activeIndex: 'docs/plans/active/', deliveredIndex: 'docs/plans/delivered/', sprintDir: 'docs/sprints/', releaseDir: 'docs/releases/' },
      bundles,
    } satisfies SelectionReadings);

  it('adds the shipped basename to the search terms of an entry source', () => {
    expect(searchTerms(ENTRY, [PAIR])).toEqual(['needs-design.ts', 'needs-design.js', 'plot-needs-design.mjs']);
  });

  it('a path that is not an entry gains no term', () => {
    expect(searchTerms('packages/domain/src/workflows/needs-design.ts', [PAIR])).toEqual(['needs-design.ts', 'needs-design.js']);
    expect(ci(['packages/board/src/server/entry/approve.ts'], [PAIR]).tests).toEqual([]);
  });

  it('a changed entry source selects a test that names its bundle', () => {
    expect(ci([ENTRY], [PAIR]).tests).toEqual([BUNDLE_TEST.path]);
    expect(local([ENTRY], [PAIR]).tests).toEqual([BUNDLE_TEST.path]);
    expect(local([ENTRY], [PAIR]).commands).toContain(`node --test ${BUNDLE_TEST.path}`);
  });

  it('with no pairs it selects nothing new', () => {
    expect(ci([ENTRY]).tests).toEqual([]);
    expect(ci([ENTRY], []).tests).toEqual([]);
    expect(local([ENTRY]).tests).toEqual([]);
    expect(local([ENTRY], []).tests).toEqual([]);
  });

  it('selects the bundle test where the caller read no references for the entry', () => {
    const answer = localChecks({ ...readings({ changed: [ENTRY], checks: BOARD_CHECKS }), tests: TESTS, bundles: [PAIR] });
    expect(answer.tests).toEqual([BUNDLE_TEST.path]);
  });

  it('a generated entry source and an absent tests reading select nothing', () => {
    expect(localChecks({ ...readings({ changed: [ENTRY], generated: [ENTRY], checks: BOARD_CHECKS }), tests: TESTS, bundles: [PAIR] }).tests).toEqual([]);
    expect(localChecks({ ...readings({ changed: [ENTRY], checks: BOARD_CHECKS }), bundles: [PAIR] }).tests).toEqual([]);
  });

  it('localChecks and ciSelection answer the same tests for one input', () => {
    const changed = [ENTRY, 'packages/board/src/server/entry/approve.ts'];
    expect(local(changed, [PAIR]).tests).toEqual(ci(changed, [PAIR]).tests);
    expect(local(changed).tests).toEqual(ci(changed).tests);
  });
});
