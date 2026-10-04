import { describe, it, expect } from 'vitest';
import { ciSuiteRefusal, controllerInvocation, programWords, withoutQuotes } from '../src/rules/ci-suite.js';

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

describe('controllerInvocation', () => {
  describe('a read or mention returns null, per row', () => {
    it.each([
      ['ls', 'ls skills/plot/scripts/plot-dispatch.sh'],
      ['git grep -l, a pathspec glob', "git grep -l plot-dispatch.sh -- '*.sh'"],
      ['git grep -n, a named pathspec', 'git grep -n x -- skills/plot/scripts/plot-deliver.sh'],
      ['cat', 'cat plot-approve.sh'],
    ])('%s', (_label, command) => {
      expect(controllerInvocation(command)).toBeNull();
    });
  });

  describe('a run returns the action, per row', () => {
    it.each([
      ['bash <script>', 'bash skills/plot/scripts/plot-dispatch.sh x', 'dispatch'],
      ['./<script>', './plot-approve.sh x', 'approve'],
      ['a loop body', 'for s in a b; do plot-dispatch.sh $s; done', 'dispatch'],
      ['a bare call', 'skills/plot/scripts/plot-deliver.sh x', 'deliver'],
    ] as const)('%s', (_label, command, action) => {
      expect(controllerInvocation(command)).toBe(action);
    });
  });

  it('answers the loop spelling and the glob RUN, which command-position matching would miss', () => {
    expect(controllerInvocation('for s in a b; do plot-dispatch.sh $s; done')).toBe('dispatch');
    expect(controllerInvocation('bash skills/plot/scripts/*dispatch.sh x')).toBe('dispatch');
  });

  it('answers null for a glob matching all three, not one — reached as a RUN, not spared by the read carve-out', () => {
    expect(controllerInvocation('ls skills/plot/scripts/*.sh')).toBeNull();
    expect(controllerInvocation('bash skills/plot/scripts/*.sh')).toBeNull();
  });

  it('answers null for a glob naming none of the three — reached as a RUN, not spared by the read carve-out', () => {
    expect(controllerInvocation('ls skills/plot/scripts/*other.sh')).toBeNull();
    expect(controllerInvocation('bash skills/plot/scripts/*other.sh')).toBeNull();
  });

  describe('a single-quoted heredoc body is the caller’s to strip, not this reading’s', () => {
    it('an unquoted heredoc body line stays tokenised', () => {
      const command = ['git commit -F - <<EOF', 'plot: record', '', 'written by skills/plot/scripts/plot-dispatch.sh', 'EOF'].join('\n');
      expect(controllerInvocation(command)).toBe('dispatch');
    });

    it('a body mentioning --dry-run does not exempt a real invocation on the same line', () => {
      const command = 'skills/plot/scripts/plot-dispatch.sh slug && git commit -F - <<EOF\nwe also ran --dry-run first\nEOF';
      expect(controllerInvocation(command)).toBe('dispatch');
    });
  });

  describe('plot-deliver.sh names a fourth action: release', () => {
    it('plot-deliver.sh --release 2.22.3 x is release, not deliver', () => {
      expect(controllerInvocation('skills/plot/scripts/plot-deliver.sh --release 2.22.3 x')).toBe('release');
    });

    it('plot-dispatch.sh --release <branch> is null — no endpoint for this mode, scoped to dispatch alone', () => {
      expect(controllerInvocation('skills/plot/scripts/plot-dispatch.sh --release feature/x')).toBeNull();
    });

    it('a bare plot-deliver.sh is still deliver', () => {
      expect(controllerInvocation('skills/plot/scripts/plot-deliver.sh x')).toBe('deliver');
    });
  });

  describe('the mode split', () => {
    it.each(['--status', '--dry-run', '--stop', '--restart', '--start', '--migrate', '--release', '--help', '-h'])(
      'plot-dispatch.sh %s has no endpoint',
      (mode) => {
        expect(controllerInvocation(`skills/plot/scripts/plot-dispatch.sh ${mode} x`)).toBeNull();
      },
    );

    it.each(['--status', '--dry-run', '--help', '-h'])('plot-approve.sh %s has no endpoint', (mode) => {
      expect(controllerInvocation(`skills/plot/scripts/plot-approve.sh ${mode} x`)).toBeNull();
    });

    it.each(['--status', '--dry-run', '--help', '-h'])('plot-deliver.sh %s has no endpoint', (mode) => {
      expect(controllerInvocation(`skills/plot/scripts/plot-deliver.sh ${mode} x`)).toBeNull();
    });

    it('plot-approve.sh --who is still the approve action — only the four modes above are exempt', () => {
      expect(controllerInvocation('skills/plot/scripts/plot-approve.sh --who jwloka x')).toBe('approve');
    });
  });

  it('answers null for a read-only script this rule does not gate', () => {
    expect(controllerInvocation('bash skills/plot/scripts/plot-fleet-scan.sh')).toBeNull();
    expect(controllerInvocation('gh pr merge 123 --squash')).toBeNull();
    expect(controllerInvocation('git push origin HEAD:main')).toBeNull();
  });

  it('a known false positive stays refused on purpose: grep and sed are not carved out', () => {
    expect(controllerInvocation('grep -c foo skills/plot/scripts/plot-dispatch.sh')).toBe('dispatch');
    expect(controllerInvocation("sed -n '1,5p' skills/plot/scripts/plot-dispatch.sh")).toBe('dispatch');
  });

  it('a segment with no program after its assignments is not a read, and is not a run either', () => {
    // `FOO=1` alone strips to an empty program; the segment names no gated
    // script, so the command is still null overall — exercised beside a
    // segment that does, so both of controllerInvocation's segment-handling
    // paths run in one command.
    expect(controllerInvocation('FOO=1')).toBeNull();
    expect(controllerInvocation('FOO=1 && bash skills/plot/scripts/plot-dispatch.sh x')).toBe('dispatch');
  });
});
