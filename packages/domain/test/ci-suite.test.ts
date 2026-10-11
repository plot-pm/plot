import { describe, it, expect } from 'vitest';
import { ciSuiteRefusal, controllerInvocation, programWords, withoutComments, withoutQuotes } from '../src/rules/ci-suite.js';

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

  it('admits the command bundles while a bare plot-dispatch.sh stays gated', () => {
    expect(controllerInvocation('node skills/plot/scripts/board/plot-dispatch-command.mjs some-slug')).toBeNull();
    expect(controllerInvocation('node skills/plot/scripts/board/plot-continue-command.mjs b -')).toBeNull();
    expect(controllerInvocation('plot-dispatch.sh some-slug')).toBe('dispatch');
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

    it.each(['--dry-run', '--help', '-h'])('plot-approve.sh %s has no endpoint', (mode) => {
      expect(controllerInvocation(`skills/plot/scripts/plot-approve.sh ${mode} x`)).toBeNull();
    });

    it.each(['--status', '--dry-run', '--help', '-h'])('plot-deliver.sh %s has no endpoint', (mode) => {
      expect(controllerInvocation(`skills/plot/scripts/plot-deliver.sh ${mode} x`)).toBeNull();
    });

    it('plot-approve.sh --who is still the approve action — only the four modes above are exempt', () => {
      expect(controllerInvocation('skills/plot/scripts/plot-approve.sh --who jwloka x')).toBe('approve');
    });
  });

  // THE BUNDLE IS A SECOND NAME FOR THE SAME ACTION. `plot-deliver.sh` became a
  // launcher in `the-first-script-becomes-a-command`, so an agent running its
  // bundle directly must read exactly as the launcher does — a hole here would
  // let a command walk around the controller by skipping the `.sh` entirely.
  describe('plot-deliver.mjs is the same action as plot-deliver.sh', () => {
    it('a bare call is deliver', () => {
      expect(controllerInvocation('node skills/plot/scripts/board/plot-deliver.mjs x')).toBe('deliver');
    });

    it('--release names the fourth action, release, not deliver', () => {
      expect(controllerInvocation('node skills/plot/scripts/board/plot-deliver.mjs --release 2.22.3 x')).toBe(
        'release',
      );
    });

    it.each(['--status', '--dry-run', '--help', '-h'])('%s has no endpoint', (mode) => {
      expect(controllerInvocation(`node skills/plot/scripts/board/plot-deliver.mjs ${mode} x`)).toBeNull();
    });

    it('a read is still null — cat, ls, git grep', () => {
      expect(controllerInvocation('cat skills/plot/scripts/board/plot-deliver.mjs')).toBeNull();
      expect(controllerInvocation('ls skills/plot/scripts/board/plot-deliver.mjs')).toBeNull();
      expect(controllerInvocation('git grep -l plot-deliver.mjs')).toBeNull();
    });

    it('a glob matching both the launcher and the bundle is ambiguous and answers null', () => {
      expect(controllerInvocation('bash skills/plot/scripts/*deliver*')).toBeNull();
    });
  });

  // `approval-becomes-a-command` made `plot-approve.sh` a launcher over its own
  // bundle, so a direct call to the bundle reads as the launcher does.
  describe('plot-approve.mjs is the same action as plot-approve.sh', () => {
    it('a bare call is approve', () => {
      expect(controllerInvocation('node skills/plot/scripts/board/plot-approve.mjs x')).toBe('approve');
    });

    it('--who on the bundle is still approve', () => {
      expect(controllerInvocation('node skills/plot/scripts/board/plot-approve.mjs --who "A Person" x')).toBe(
        'approve',
      );
    });

    it.each(['--dry-run', '--help', '-h'])('%s has no endpoint', (mode) => {
      expect(controllerInvocation(`node skills/plot/scripts/board/plot-approve.mjs ${mode} x`)).toBeNull();
    });

    it('a read is still null — cat, ls, git grep', () => {
      expect(controllerInvocation('cat skills/plot/scripts/board/plot-approve.mjs')).toBeNull();
      expect(controllerInvocation('ls skills/plot/scripts/board/plot-approve.mjs')).toBeNull();
      expect(controllerInvocation('git grep -l plot-approve.mjs')).toBeNull();
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

describe('a word list is data only when every body command is a reader (#1341)', () => {
  it.each([
    'for f in plot-deliver.sh plot-approve.sh; do cmp $f /tmp/$f; done',
    'for f in plot-deliver.sh; do git diff --stat -- "$f"; done',
    'for f in plot-deliver.sh; do git show HEAD:$f | head -3; git log -1 -- $f; done',
    'for f in skills/plot/scripts/plot-dispatch.sh; do wc -l ${f}; done',
    'for f in plot-deliver.sh; do [ -f $f ] && test -x $f && stat $f; done',
    'for f in plot-deliver.sh; do diff $f x; shasum $f; sha256sum $f; tail -1 $f; grep -c x $f; ls $f; cat $f; done',
    'for f in plot-deliver.sh; do cmp $f x; done; echo ok',
  ])('%s answers null', (command) => {
    expect(controllerInvocation(command)).toBeNull();
  });

  it.each([
    ['for f in plot-deliver.sh; do bash $f x; done', 'deliver'],
    ['for f in plot-approve.sh; do "$f" x; done', 'approve'],
    ['for f in plot-dispatch.sh; do ./scripts/$f x; done', 'dispatch'],
    ['for s in a b; do plot-dispatch.sh $s; done', 'dispatch'],
    ['for f in plot-deliver.sh\ndo\n  bash "$f" x\ndone', 'deliver'],
    ['for f in skills/plot/scripts/plot-deliver.sh; do timeout 600 bash $f s; done', 'deliver'],
    ['for f in plot-deliver.sh; do bash -e $f s; done', 'deliver'],
    ['for f in plot-deliver.sh; do eval "bash $f s"; done', 'deliver'],
    ['for f in plot-deliver.sh; do sudo $f s; done', 'deliver'],
    ['for f in plot-deliver.sh; do x=$f; bash $x s; done', 'deliver'],
    ['for f in plot-deliver.sh; do echo $f | xargs bash; done', 'deliver'],
    ['for f in plot-deliver.sh; do cmp $f x; bash $f s; done', 'deliver'],
    ['for f in plot-deliver.sh; do cat $(bash $f s); done', 'deliver'],
    ['for f in plot-deliver.sh; do grep x `bash $f s`; done', 'deliver'],
    ['for f in plot-deliver.sh; do diff <(bash $f s) x; done', 'deliver'],
    ['for f in plot-deliver.sh; do git commit -m $f; done', 'deliver'],
  ])('%s answers %s', (command, action) => {
    expect(controllerInvocation(command)).toBe(action);
  });
});

describe('the word after --who and --release is a value (#1449)', () => {
  it('reads --who --dry-run slug as an approve', () => {
    expect(controllerInvocation('node board/plot-approve.mjs --who --dry-run slug')).toBe('approve');
    expect(controllerInvocation('plot-approve.sh --who --status slug')).toBe('approve');
  });

  it('still reads a bare --dry-run as no endpoint', () => {
    expect(controllerInvocation('node board/plot-approve.mjs --dry-run slug')).toBeNull();
    expect(controllerInvocation('node board/plot-approve.mjs --who jwloka --dry-run slug')).toBeNull();
  });

  it('reads --status on approve as a run, because the approve entry has no --status mode', () => {
    expect(controllerInvocation('plot-approve.sh --status slug')).toBe('approve');
    expect(controllerInvocation('node board/plot-approve.mjs --status slug')).toBe('approve');
    expect(controllerInvocation('plot-deliver.sh --status slug')).toBeNull();
  });

  it('keeps --release as the flag that names the action', () => {
    expect(controllerInvocation('plot-deliver.sh --release 2.22.3 slug')).toBe('release');
    expect(controllerInvocation('plot-dispatch.sh --release branch')).toBeNull();
  });
});

describe('an unquoted # starts a comment', () => {
  it('ignores a gated script named in a comment', () => {
    expect(controllerInvocation('git status # then plot-deliver.sh x')).toBeNull();
    expect(controllerInvocation('# plot-approve.sh x\nls')).toBeNull();
  });

  it('reads a command before the comment', () => {
    expect(controllerInvocation('plot-approve.sh x # why')).toBe('approve');
  });

  it('does not truncate at a quoted #', () => {
    expect(controllerInvocation('echo "a # b"; plot-approve.sh x')).toBe('approve');
    expect(controllerInvocation("echo 'a # b' && plot-deliver.sh x")).toBe('deliver');
  });

  it('does not read $# or ${#x} as a comment', () => {
    expect(controllerInvocation('echo $# ; plot-approve.sh x')).toBe('approve');
    expect(controllerInvocation('echo ${#x}; plot-approve.sh x')).toBe('approve');
  });

  it('cuts one line at a time', () => {
    expect(withoutComments('a # b\nc # d\ne')).toBe('a \nc \ne');
  });
});

describe('a .mjs glob resolves like a .sh glob', () => {
  it('answers where exactly one gated bundle matches', () => {
    expect(controllerInvocation('node board/plot-appro?e.mjs x')).toBe('approve');
    expect(controllerInvocation('node board/plot-deliv*.mjs x')).toBe('deliver');
  });

  it('answers null where several match', () => {
    expect(controllerInvocation('node board/*.mjs x')).toBeNull();
  });
});
