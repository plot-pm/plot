import { describe, it, expect } from 'vitest';
import { ciSuiteRefusal, controllerHttpAction, controllerInvocation, programWords, withoutComments, withoutQuotes } from '../src/rules/ci-suite.js';
import { unpinnedMerges } from '../src/rules/controller-gate.js';

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
      ['git -C . grep, a quoted pattern', 'git -C . grep -n "A branch dispatch (--restart <branch>) starts a worker on any command." origin/main -- skills/plot/scripts/plot-dispatch.sh'],
      ['git -C <dir> diff', 'git -C /tmp/x diff -- plot-deliver.sh'],
      ['git -C . log piped into head', 'git -C . log --oneline -- skills/plot/scripts/plot-deliver.sh | head'],
      ['git --no-pager log', 'git --no-pager log -1 -- plot-approve.sh'],
    ])('%s', (_label, command) => {
      expect(controllerInvocation(command)).toBeNull();
    });
  });

  describe('#2706: a reader beyond ls/cat/git-grep is a read too, per row', () => {
    it.each([
      ['grep', 'grep -n x skills/plot/scripts/plot-dispatch.sh'],
      ['head', 'head -5 skills/plot/scripts/plot-approve.sh'],
      ['tail -f', 'tail -f skills/plot/scripts/plot-dispatch.sh'],
      ['wc -l', 'wc -l skills/plot/scripts/plot-deliver.sh'],
      ['diff', 'diff skills/plot/scripts/plot-approve.sh /dev/null'],
      ['stat', 'stat skills/plot/scripts/plot-deliver.sh'],
      ['shasum', 'shasum skills/plot/scripts/plot-dispatch.sh'],
      ['test -x', 'test -x skills/plot/scripts/plot-dispatch.sh'],
      ['[ -x ]', '[ -x skills/plot/scripts/plot-dispatch.sh ]'],
      ['git diff', 'git diff main -- skills/plot/scripts/plot-deliver.sh'],
      ['git show', 'git show HEAD:skills/plot/scripts/plot-dispatch.sh'],
      ['git log -p', 'git log -p -- skills/plot/scripts/plot-deliver.sh'],
      ['the issue #2706 command', "grep -n 'orphaned claim' skills/plot/scripts/plot-reap.sh | head"],
    ])('%s', (_label, command) => {
      expect(controllerInvocation(command)).toBeNull();
    });
  });

  describe('#2706: a substitution in a reader segment is still a run, per row', () => {
    it.each([
      ['$( ) as an operand', 'grep x $(skills/plot/scripts/plot-dispatch.sh s)', 'dispatch'],
      ['backtick as an operand', 'wc -c `skills/plot/scripts/plot-dispatch.sh s`', 'dispatch'],
      ['<( ) as an operand', 'diff <(skills/plot/scripts/plot-dispatch.sh s) f', 'dispatch'],
      ['>( ) as an operand', 'tail -f /dev/null >(skills/plot/scripts/plot-dispatch.sh s)', 'dispatch'],
      ['$( ) inside test -n', '[ -n "$(skills/plot/scripts/plot-deliver.sh s)" ]', 'deliver'],
      ['$( ) naming --release', 'wc -l $(plot-deliver.sh --release 1.0 x)', 'release'],
      ['a bare backtick call', 'grep x `plot-dispatch.sh y`', 'dispatch'],
      ['a bare <( ) call', 'head <(plot-dispatch.sh y)', 'dispatch'],
      ['the closed cat $( ) hole', 'cat $(skills/plot/scripts/plot-approve.sh y)', 'approve'],
    ] as const)('%s', (_label, command, action) => {
      expect(controllerInvocation(command)).toBe(action);
    });
  });

  describe('#2706: an assignment or env prefix on a reader is still a run, per row', () => {
    it.each([
      ['GIT_EXTERNAL_DIFF=', 'GIT_EXTERNAL_DIFF=skills/plot/scripts/plot-dispatch.sh git diff', 'dispatch'],
      ['GIT_PAGER=', 'GIT_PAGER=skills/plot/scripts/plot-dispatch.sh git grep x', 'dispatch'],
      ['env PAGER=', 'env PAGER=skills/plot/scripts/plot-dispatch.sh cat x', 'dispatch'],
    ] as const)('%s', (_label, command, action) => {
      expect(controllerInvocation(command)).toBe(action);
    });
  });

  describe('#2706: a git option that runs or writes is still a run, per row', () => {
    it.each([
      ['--ext-diff', 'git log --ext-diff -p -1 -- skills/plot/scripts/plot-dispatch.sh', 'dispatch'],
      ['-O...', 'git grep -Oskills/plot/scripts/plot-dispatch.sh x', 'dispatch'],
      ['--open-files-in-pager=', 'git grep --open-files-in-pager=skills/plot/scripts/plot-dispatch.sh x', 'dispatch'],
      ['--output=', 'git show -1 --output=skills/plot/scripts/plot-dispatch.sh', 'dispatch'],
      ['--textconv', 'git diff --textconv -- skills/plot/scripts/plot-dispatch.sh', 'dispatch'],
      ['-C . with --ext-diff', 'git -C . diff --ext-diff -- plot-deliver.sh', 'deliver'],
      ['-c diff.external=', 'git -c diff.external=x diff -- plot-deliver.sh', 'deliver'],
      ['-C . then -c core.pager=', 'git -C . -c core.pager=cat log -- plot-deliver.sh', 'deliver'],
    ] as const)('%s', (_label, command, action) => {
      expect(controllerInvocation(command)).toBe(action);
    });
  });

  describe('#2706: a reader piped into a shell stays a known hole, pinned at today’s answer', () => {
    it.each([
      'cat skills/plot/scripts/plot-dispatch.sh | bash -s s',
      'grep . skills/plot/scripts/plot-dispatch.sh | bash -s s',
      'head -n 9999 skills/plot/scripts/plot-dispatch.sh > /tmp/d.sh',
    ])('%s', (command) => {
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
    it.each(['--status', '--dry-run', '--stop', '--start', '--migrate', '--release', '--help', '-h'])(
      'plot-dispatch.sh %s has no endpoint',
      (mode) => {
        expect(controllerInvocation(`skills/plot/scripts/plot-dispatch.sh ${mode} x`)).toBeNull();
      },
    );

    it('plot-dispatch.sh --restart <branch> is the restart action, not dispatch', () => {
      expect(controllerInvocation('skills/plot/scripts/plot-dispatch.sh --restart feature/x')).toBe('restart');
    });

    it('--stop wins over --restart, because --stop has no endpoint', () => {
      expect(controllerInvocation('skills/plot/scripts/plot-dispatch.sh --stop --restart feature/x')).toBeNull();
    });

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

  describe('the approve and deliver commands are not gated', () => {
    it.each([
      'node skills/plot/scripts/board/plot-approve-command.mjs --who jwloka x',
      'node skills/plot/scripts/board/plot-approve-command.mjs --spike --who jwloka x',
      'node skills/plot/scripts/board/plot-deliver-command.mjs x',
      'node skills/plot/scripts/board/plot-deliver-command.mjs --branch sprint/a x',
    ])('%s answers null', (command) => {
      expect(controllerInvocation(command)).toBeNull();
    });

    it('a glob over plot-approve*.mjs still reads as approve', () => {
      expect(controllerInvocation('node skills/plot/scripts/board/plot-approve*.mjs x')).toBe('approve');
    });
  });

  it('answers null for a read-only script this rule does not gate', () => {
    expect(controllerInvocation('bash skills/plot/scripts/plot-fleet-scan.sh')).toBeNull();
    expect(controllerInvocation('gh pr merge 123 --squash')).toBeNull();
    expect(controllerInvocation('git push origin HEAD:main')).toBeNull();
  });

  it('a bare grep on a gated script is a read, widened by #2706', () => {
    expect(controllerInvocation('grep -c foo skills/plot/scripts/plot-dispatch.sh')).toBeNull();
  });

  it('sed and awk stay refused on purpose: #2706 widens the reader set, not this one', () => {
    expect(controllerInvocation("sed -n '1,5p' skills/plot/scripts/plot-dispatch.sh")).toBe('dispatch');
    expect(controllerInvocation('awk 1 skills/plot/scripts/plot-dispatch.sh')).toBe('dispatch');
    expect(controllerInvocation('rg -n x skills/plot/scripts/plot-dispatch.sh')).toBe('dispatch');
  });

  it('a reader name as an argument, not the program, is still a run', () => {
    expect(controllerInvocation('bash skills/plot/scripts/plot-dispatch.sh grep')).toBe('dispatch');
  });

  it('#2706: the merge-pin check shares the same reader predicate', () => {
    expect(unpinnedMerges('grep -n pr-merge skills/plot/scripts/plot-host.sh')).toEqual([]);
    expect(unpinnedMerges('git log -S pr-merge -- skills/plot/scripts/plot-host.sh')).toEqual([]);
    expect(unpinnedMerges('grep x $(gh pr merge 12)')).toEqual(['gh']);
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
    ['for f in plot-deliver.sh; do git diff --ext-diff -- $f; done', 'deliver'],
    ['for f in plot-deliver.sh; do git log --textconv -- $f; done', 'deliver'],
    ['for f in plot-deliver.sh; do X=1 cat $f; done', 'deliver'],
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

describe('a process-table read is a read (#2530)', () => {
  it.each([
    'while pgrep -f "plot-approve.mjs the-x" >/dev/null; do /bin/sleep 15; done',
    'pgrep -f "plot-approve.mjs the-x"',
    'ps -o pid= -C plot-deliver.mjs',
    'lsof -c plot-deliver.mjs',
    'ps aux | grep plot-approve.mjs',
    'pgrep -f "plot-approve.mjs|plot-deliver.mjs"',
  ])('%s is not a run', (command) => {
    expect(controllerInvocation(command)).toBeNull();
  });

  it.each([
    ['pkill -f plot-approve.mjs', 'approve'],
    ['pgrep -f plot-approve.mjs | xargs kill', 'approve'],
    ['until ! pgrep -f "plot-deliver.mjs x"; do sleep 1; done', 'deliver'],
    ['pgrep -KILL -f plot-approve.mjs', 'approve'],
    ['pgrep --signal=KILL -f plot-approve.mjs', 'approve'],
    ['X=1 pgrep -f plot-approve.mjs', 'approve'],
    ['pgrep -f $(plot-approve.mjs x)', 'approve'],
    ['for f in plot-approve.sh; do sed "1e $f slug" /dev/null; done', 'approve'],
    ['for f in plot-approve.mjs; do pgrep -f "$f" | xargs kill; done', 'approve'],
    ['while X=pgrep plot-approve.mjs x; do break; done', 'approve'],
    ['for f in plot-approve.mjs; do X=pgrep $f x; done', 'approve'],
    ['while $(echo pgrep) plot-approve.mjs x; do break; done', 'approve'],
  ] as const)('%s stays a run', (command, action) => {
    expect(controllerInvocation(command)).toBe(action);
  });

  it('a single capital-letter pgrep option is not a signal', () => {
    expect(controllerInvocation('pgrep -F pidfile -f plot-approve.mjs')).toBeNull();
  });

  it('the merge path sees the same answer', () => {
    expect(unpinnedMerges('while pgrep -f plot-host.sh pr-merge; do sleep 1; done')).toEqual([]);
  });
});

describe('a gated name inside program text is a run', () => {
  it.each([
    [`awk 'BEGIN{system("plot-approve.sh x")}'`, 'approve'],
    [`python3 -c 'import os; os.system("plot-approve.sh x")'`, 'approve'],
    [`node -e 'require("child_process").execSync("plot-deliver.sh x")'`, 'deliver'],
    [`node -e "require('fs').readFileSync('skills/plot/scripts/plot-deliver.sh','utf8')"`, 'deliver'],
    ['bash -c "plot-deliver.sh x"', 'deliver'],
  ] as const)('%s answers %s', (command, action) => {
    expect(controllerInvocation(command)).toBe(action);
  });
});

describe('a citation in a message is not a run', () => {
  it.each([
    "gh pr comment 12 --body 'see skills/plot/scripts/plot-deliver.sh:120 for the guard'",
    "gh issue comment 3145 --body 'The fix is in `plot-deliver.sh` now'",
    "gh api repos/o/r/issues -f body='`plot-approve.mjs` refuses'",
    "printf '%s\\n' plot-deliver.sh:12",
    'echo plot-deliver.sh:12',
    `grep -n 'system("plot-approve.sh x")' README.md`,
  ])('%s answers null', (command) => {
    expect(controllerInvocation(command)).toBeNull();
  });
});

describe('a quoted separator does not split a command', () => {
  it('reads grep with a quoted \\| as a read', () => {
    expect(controllerInvocation('grep -n "a\\|plot-deliver.mjs" README.md | head')).toBeNull();
    expect(controllerInvocation("grep -n 'a;plot-deliver.sh' README.md")).toBeNull();
  });

  it('keeps bash -c "plot-deliver.sh x" a run', () => {
    expect(controllerInvocation('bash -c "plot-deliver.sh x"')).toBe('deliver');
  });

  it('keeps an unquoted separator splitting', () => {
    expect(controllerInvocation('a | plot-deliver.sh x')).toBe('deliver');
    expect(controllerInvocation('cat x | plot-dispatch.sh y')).toBe('dispatch');
    expect(controllerInvocation('true && plot-approve.sh x')).toBe('approve');
  });

  it('keeps a loop body that only reads a read', () => {
    expect(controllerInvocation('for f in plot-deliver.sh; do grep "a\\|b" $f; done')).toBeNull();
  });
});

describe('an escaped quote does not open a span', () => {
  it('reads the command after it', () => {
    expect(controllerInvocation("cat it\\'s; plot-deliver.sh x; cat 'y'")).toBe('deliver');
  });

  it('refuses a suite after it', () => {
    expect(ciSuiteRefusal("cat it\\'s; pnpm run test:e2e; cat 'y'", SUITES)).toEqual({ suite: 'pnpm run test:e2e' });
  });

  it('passes a suite named inside quotes', () => {
    expect(ciSuiteRefusal('echo "a; pnpm run test:e2e"', SUITES)).toBeNull();
  });
});

describe('an unreadable command over-splits', () => {
  it('reads a run inside a case', () => {
    expect(controllerInvocation('case x in a) plot-deliver.sh y;; esac')).toBe('deliver');
  });

  it('reads a run after an unterminated quote', () => {
    expect(ciSuiteRefusal('echo "x; pnpm run test:e2e', SUITES)).toEqual({ suite: 'pnpm run test:e2e' });
  });
});

describe('a separator inside a substitution splits', () => {
  it.each([
    'out=$(cd e2e && pnpm run test:e2e 2>&1)',
    'x=`cd e2e; pnpm run test:e2e --ci`',
    'echo $(cd e2e; pnpm run test:e2e --ci)',
    'diff <(cd e2e; pnpm run test:e2e --ci) x',
  ])('%s runs a suite', (command) => {
    expect(ciSuiteRefusal(command, SUITES)).toEqual({ suite: 'pnpm run test:e2e' });
  });

  it('reads a run behind a separator inside a substitution', () => {
    expect(controllerInvocation('cat $(true;plot-deliver.sh x)')).toBe('deliver');
  });

  it('keeps a quoted separator inside a substitution from splitting', () => {
    expect(ciSuiteRefusal('echo "$(grep \'a; pnpm run test:e2e\' f)"', SUITES)).toBeNull();
  });
});

describe('a script glued behind a quoted separator is a run', () => {
  it('reads sh -c with the script after a ;', () => {
    expect(controllerInvocation("sh -c 'PATH=$PWD/skills/plot/scripts:$PATH;plot-deliver.sh x'")).toBe('deliver');
  });

  it('keeps a read that names the script after a quoted separator a read', () => {
    expect(controllerInvocation("grep -n 'a;plot-deliver.sh' README.md")).toBeNull();
  });
});

describe('a reserved word does not hide the program', () => {
  const R = 'http://localhost:4000/api/release';
  it.each([
    `for i in 1; do curl -X POST ${R}; done`,
    `while curl -X POST ${R}; do break; done`,
    `if curl -X POST ${R}; then :; fi`,
    `! curl -X POST ${R}`,
    `(curl -X POST ${R})`,
    `time curl -X POST ${R}`,
    `time -p curl -X POST ${R}`,
    `while X=ps curl -X POST ${R}; do break; done`,
  ])('%s is a release call', (command) => {
    expect(controllerInvocation(command)).toBe('release');
    expect(controllerHttpAction(command)).toBe('release');
  });

  it.each([
    'if true; then cat plot-deliver.sh; fi',
    'while true; do cat plot-deliver.sh; done',
    '{ cat plot-deliver.sh; }',
    'if [ -f skills/plot/scripts/plot-deliver.sh ]; then echo yes; fi',
    'if git -C . grep -q x -- plot-dispatch.sh; then :; fi',
  ])('%s is a read', (command) => {
    expect(controllerInvocation(command)).toBeNull();
  });

  it.each([
    ['until ! pgrep -f "plot-deliver.mjs x"; do sleep 1; done', 'deliver'],
    ['if pgrep -f plot-deliver.mjs; then :; fi', 'deliver'],
  ] as const)('%s stays a run', (command, action) => {
    expect(controllerInvocation(command)).toBe(action);
  });

  it.each([
    'for i in 1; do pnpm run test:e2e; done',
    'if true; then pnpm run test:e2e; fi',
    '! pnpm run test:e2e',
    'time pnpm run test:e2e',
    'time -p pnpm run test:e2e',
  ])('%s runs the suite', (command) => {
    expect(ciSuiteRefusal(command, SUITES)).toEqual({ suite: 'pnpm run test:e2e' });
  });
});
