import { describe, it, expect } from 'vitest';
import {
  globToRegExp,
  localChecks,
  parseList,
  parseLocalChecks,
  searchTerms,
  shellWord,
  type LocalChecksReadings,
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
    expect(answer).toEqual({ commands: [], tests: [], overLimit: [], untested: [] });
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
