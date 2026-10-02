import { describe, it, expect } from 'vitest';
import { ciSuiteRefusal, programWords, withoutQuotes } from '../src/rules/ci-suite.js';

const SUITES = [
  'pnpm run test:e2e',
  'pnpm run test:contracts',
  'pnpm run test:board',
  'pnpm --filter @plot-pm/domain exec vitest run --coverage',
  'node --test test/reconcile/*.test.mjs',
];

describe('ciSuiteRefusal', () => {
  it('refuses each suite where it runs', () => {
    for (const suite of SUITES) expect(ciSuiteRefusal(suite, SUITES)).toEqual({ suite });
  });

  it('refuses a suite behind assignments and env prefixes', () => {
    expect(ciSuiteRefusal('FOO=1 BAR=2 pnpm run test:contracts', SUITES)?.suite).toBe('pnpm run test:contracts');
    expect(ciSuiteRefusal('env -u PLOT_UNATTENDED pnpm run test:board', SUITES)?.suite).toBe('pnpm run test:board');
    expect(ciSuiteRefusal('env -i PATH=/bin pnpm run test:e2e', SUITES)?.suite).toBe('pnpm run test:e2e');
  });

  it('refuses a suite inside a chain, and with arguments after it', () => {
    expect(ciSuiteRefusal('nvm use && pnpm run test:contracts', SUITES)).not.toBeNull();
    expect(ciSuiteRefusal('cd x; pnpm run test:contracts -- --help', SUITES)).not.toBeNull();
    expect(ciSuiteRefusal('pnpm run test:board 2>&1 | tail -20', SUITES)).not.toBeNull();
  });

  it('passes a read, a commit message and a PR body that mention a suite', () => {
    expect(ciSuiteRefusal('grep test:contracts package.json', SUITES)).toBeNull();
    expect(ciSuiteRefusal('git commit -m "skip pnpm run test:contracts locally"', SUITES)).toBeNull();
    expect(ciSuiteRefusal("gh pr create --body 'ran pnpm run test:board in CI'", SUITES)).toBeNull();
    expect(ciSuiteRefusal('echo pnpm run test:e2e', SUITES)).toBeNull();
  });

  it('passes a suite not on the list, and refuses nothing for an empty list', () => {
    expect(ciSuiteRefusal('pnpm test', SUITES)).toBeNull();
    expect(ciSuiteRefusal('node --test test/reconcile/reap.test.mjs', SUITES)).toBeNull();
    expect(ciSuiteRefusal('pnpm run test:contracts', [])).toBeNull();
    expect(ciSuiteRefusal('pnpm run test:contracts', ['  '])).toBeNull();
  });
});

describe('the readings', () => {
  it('withoutQuotes empties single- and double-quoted spans', () => {
    expect(withoutQuotes(`a 'b c' "d \\" e" f`)).toBe(`a '' "" f`);
  });

  it('programWords skips assignments and env with its options', () => {
    expect(programWords(['A=1', 'env', '-u', 'X', 'B=2', 'pnpm', 'run'])).toEqual(['pnpm', 'run']);
    expect(programWords(['pnpm', 'run'])).toEqual(['pnpm', 'run']);
  });
});
