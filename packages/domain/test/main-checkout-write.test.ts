import { describe, expect, it } from 'vitest';
import {
  commitCallsOf,
  commitDirs,
  gatesMainCheckout,
  gatesStrandingReset,
  gitPushCalls,
  gitWriteDirs,
  MAIN_CHECKOUT_WRITER_ENV,
  mainCheckoutWriteRefusal,
  makesCommit,
  mutatesGitState,
  strandingResetRefusal,
  strandsTree,
  treeStrandingResetDirs,
} from '../src/rules/main-checkout-write.js';
import { SPAWN_CONTRACT } from '../src/rules/spawn-contract.js';

describe('mutatesGitState', () => {
  it.each([
    'git add -A',
    'git add file.txt',
    'git commit -m x',
    'git reset --hard HEAD~1',
    'git reset HEAD~1',
    'git checkout -- .',
    'git restore .',
    'git merge origin/main',
    'git rebase origin/main',
    'git pull',
    'git pull --rebase origin main',
    'git cherry-pick abc123',
    'git revert abc123',
    'git am patch.diff',
    'git apply patch.diff',
    'git stash',
    'git stash pop',
    'git update-ref refs/heads/main abc123',
    'git symbolic-ref HEAD refs/heads/main',
    'git branch -f main abc123',
    'git branch new-branch',
    'git branch -D old',
    'git branch --set-upstream-to=origin/main',
    'git branch -a -d old',
    'git switch main',
    'git rm file.txt',
    'git mv a b',
    '/usr/bin/git commit -m x',
    'PLOT_X=1 git commit -m x',
  ])('reads %s as mutating', (command) => expect(mutatesGitState(command)).toBe(true));

  it.each([
    'git status',
    'git status --porcelain',
    'git diff HEAD --quiet',
    'git log --oneline',
    'git show HEAD:file.txt',
    'git grep commit',
    'ls -la',
    'cat file.txt',
    'pnpm test',
    'git rev-parse --show-toplevel',
    'git',
    'git --version',
    'git branch',
    'git branch -vv',
    'git branch --show-current',
    'git branch -a',
    'git branch -l',
    'git branch --list feature/*',
    'git branch -r -v',
    'git stash list',
    'git stash show -p',
  ])('reads %s as a non-mutating read', (command) => expect(mutatesGitState(command)).toBe(false));

  it('finds a mutating segment chained after a read', () => {
    expect(mutatesGitState('git status && git commit -m x')).toBe(true);
  });

  it('does not read a mutating subcommand named only inside quotes', () => {
    expect(mutatesGitState("echo 'git commit -m x'")).toBe(false);
  });

  it('does not read a mutating subcommand named only in a comment', () => {
    expect(mutatesGitState('git status # git commit -m x')).toBe(false);
  });

  it('reads each segment of a multi-line command', () => {
    expect(mutatesGitState('git status\ngit reset --hard')).toBe(true);
  });

  it.each([
    'X=$(git commit -m y)',
    'echo `git commit -m y`',
    'echo `git commit`',
    '(git commit -m y)',
  ])('reads a git call inside a substitution or subshell: %s', (command) => expect(mutatesGitState(command)).toBe(true));

  it.each([
    'if git commit -m x; then echo ok; fi',
    'for i in a b; do git checkout $i; done',
    '{ git reset --hard; }',
    '! git commit -m x',
    'time git commit -m x',
    '! time git commit -m x',
    'a & git commit -m x',
  ])('reads a git call behind a leading shell keyword or a backgrounding &: %s', (command) =>
    expect(mutatesGitState(command)).toBe(true));

  it.each([
    'if git status; then echo ok; fi',
    'for i in a b; do git status; done',
    '{ git status; }',
    '! git status',
    'time git status',
  ])('reads a read-only call behind a leading shell keyword as a non-mutating read: %s', (command) =>
    expect(mutatesGitState(command)).toBe(false));

  it('splits a single & as a separator without breaking && splitting', () => {
    expect(mutatesGitState('echo a && echo b & git commit -m x')).toBe(true);
    expect(mutatesGitState('echo a & git commit -m x')).toBe(true);
  });

  it.each([
    'git tag -l',
    'git tag --list',
    'git notes list',
    'git notes show abc123',
    'git clean -n',
    'git clean --dry-run',
    'git fetch origin main',
    'git fetch origin',
    'git fetch',
  ])('reads %s as a non-mutating read', (command) => expect(mutatesGitState(command)).toBe(false));

  it.each([
    'git tag v1.0',
    'git tag -d v1.0',
    'git notes add -m x',
    'git notes remove abc123',
    'git clean -f',
    'git clean -fd',
    'git clean -fx',
    'git fetch origin src:dst',
    'git fetch src:dst',
  ])('reads %s as mutating', (command) => expect(mutatesGitState(command)).toBe(true));

  it('reads a dry-run clean as a non-mutating read even combined with a force flag', () => {
    expect(mutatesGitState('git clean -nf')).toBe(false);
    expect(mutatesGitState('git clean -fn')).toBe(false);
  });

  it('does not read a mutating git call written into an unquoted heredoc body', () => {
    expect(mutatesGitState('cat <<EOF\ngit checkout x\nEOF')).toBe(false);
  });

  it('reads a mutating git call on the line right after the heredoc terminator', () => {
    expect(mutatesGitState('cat <<EOF\ngit checkout x\nEOF\ngit commit -m y')).toBe(true);
  });

  it.each([
    "cat <<'EOF'\ngit checkout x\nEOF",
    'cat <<"EOF"\ngit checkout x\nEOF',
  ])('does not read a mutating git call inside a quoted heredoc delimiter: %s', (command) =>
    expect(mutatesGitState(command)).toBe(false));

  it('does not read a mutating git call inside an indented (<<-) heredoc body', () => {
    expect(mutatesGitState('cat <<-EOF\n  git checkout x\n  EOF')).toBe(false);
  });
});

describe('gitWriteDirs', () => {
  it('answers null for a call in the working directory', () => {
    expect(gitWriteDirs('git commit -m x')).toEqual([null]);
  });

  it('skips -c and its value before the subcommand', () => {
    expect(gitWriteDirs('git -c user.name=x commit -m y')).toEqual([null]);
  });

  it('skips --git-dir=, --work-tree= and other leading options', () => {
    expect(gitWriteDirs('git --no-pager --git-dir=.git --work-tree=. commit -m y')).toEqual([null]);
  });

  it('skips a global option given its value as the next word', () => {
    expect(gitWriteDirs('git --git-dir .git commit -m y')).toEqual([null]);
  });

  it('names the -C path', () => {
    expect(gitWriteDirs('git -C /repo/main commit -m y')).toEqual(['/repo/main']);
  });

  it('joins successive -C paths the way git does', () => {
    expect(gitWriteDirs('git -C a -C b reset --hard')).toEqual(['a/b']);
    expect(gitWriteDirs('git -C a -C /abs reset --hard')).toEqual(['/abs']);
  });

  it('reads a -C read-only call as no write', () => {
    expect(gitWriteDirs('git -C /repo status')).toEqual([]);
  });

  it.each([
    'git -C "$DESK" commit -m x',
    'git -C $DESK commit -m x',
    "git -C '/path with space' commit -m x",
    'git -C',
  ])('leaves out a call whose -C path the text cannot give: %s', (command) => expect(gitWriteDirs(command)).toEqual([]));

  it('answers one entry per mutating call', () => {
    expect(gitWriteDirs('git -C d commit -m x; git reset --hard')).toEqual(['d', null]);
  });

  it.each([
    ['cd /repo/main && git commit -m x', ['/repo/main']],
    ['cd /repo/main; git add -A; git commit -m x', ['/repo/main', '/repo/main']],
    ['cd /repo/main || exit 1\ngit commit -m x', ['/repo/main']],
    ['pushd /repo/main && git commit -m x', ['/repo/main']],
    ['cd -P /repo/main && git commit -m x', ['/repo/main']],
    ['cd -- /repo/main && git commit -m x', ['/repo/main']],
    ['cd sub && git commit -m x', ['sub']],
    ['cd /repo && cd main && git commit -m x', ['/repo/main']],
    ['cd /repo && git -C main commit -m x', ['/repo/main']],
    ['cd /repo && git -C /desk commit -m x', ['/desk']],
    ['git commit -m x && cd /repo/main', [null]],
  ])('judges a call after a literal cd in that directory: %s', (command, dirs) => expect(gitWriteDirs(command)).toEqual(dirs));

  it.each([
    'cd "$desk" && git commit -m x',
    'cd $DESK && git commit -m x',
    'cd $(plot_desk_root) && git commit -m x',
    'cd /repo/$(x) && git commit -m x',
    'cd /repo/`x` && git commit -m x',
    'cd && git commit -m x',
    'cd - && git commit -m x',
    'cd ~/repo && git commit -m x',
    'cd /repo && popd && git commit -m x',
    'cd "$desk" && cd sub && git commit -m x',
    'cd "$desk" && git -C sub commit -m x',
    'git -C /repo -C "$x" commit -m x',
  ])('leaves out a call after a cd the text cannot place: %s', (command) => expect(gitWriteDirs(command)).toEqual([]));

  it('places a call again after an absolute cd or -C', () => {
    expect(gitWriteDirs('cd "$desk" && cd /repo/main && git commit -m x')).toEqual(['/repo/main']);
    expect(gitWriteDirs('cd "$desk" && git -C /repo/main commit -m x')).toEqual(['/repo/main']);
    expect(gitWriteDirs('git -C "$x" -C /repo commit -m x')).toEqual(['/repo']);
  });

  it('ends a cd at the ) that closes its subshell', () => {
    expect(gitWriteDirs('(cd /repo/desk && git commit -m x); git commit -m y')).toEqual(['/repo/desk', null]);
    expect(gitWriteDirs('X=$(cd /repo/desk && git commit -m x) && git reset --hard')).toEqual(['/repo/desk', null]);
  });

  it('ends a cd at the backtick that closes its substitution', () => {
    expect(gitWriteDirs('echo `cd /repo/desk && git commit -m x` && git reset --hard')).toEqual(['/repo/desk', null]);
  });

  it('reads a ) with no opening ( as no subshell', () => {
    expect(gitWriteDirs('cd /repo/main; case x in a) git commit -m x;; esac')).toEqual(['/repo/main']);
  });

  it('judges --git-dir and --work-tree calls by cd and -C, not by the options', () => {
    expect(gitWriteDirs('cd /repo/desk && git --git-dir=/repo/main/.git --work-tree=/repo/main commit -m x')).toEqual([
      '/repo/desk',
    ]);
  });
});

// Table lifted verbatim from docs/plans/2026-10-31-the-commit-gates-match-only-the.md's
// `## Notes` table: each row's `commitDirs` column is its expected value, and
// `makesCommit` must agree with the `Matches` column (floor rows return `[]`
// from commitDirs alone — the substring floor in gate.ts, not this rule, is
// what matches them; a floor-only row is tested here as a non-match).
describe('commitDirs', () => {
  it.each([
    ['git commit -m x', [null]],
    ['git commit --amend', [null]],
    ['git -C /x commit -m y', ['/x']],
    ['git -C /a -C b commit', ['/a/b']],
    ['git -c a=b commit', [null]],
    ['git  commit', [null]],
    ['cd x && git commit', ['x']],
    ['cd x && git -C sub commit', ['x/sub']],
    ['git -C /a commit && git -C /b commit', ['/a', '/b']],
    ['git -C "$d" commit', ['unplaced']],
    ['cd "$desk" && git commit', ['unplaced']],
    ['git add -A && git -C y commit', ['y']],
    ['git -C y add -A && git -C y commit', ['y']],
    ['git merge --continue', [null]],
    ['git rebase --continue', [null]],
    ['GIT_EDITOR=true git rebase --continue', [null]],
    ['git cherry-pick --continue', [null]],
    ['git revert --continue', [null]],
    ['git am --continue', [null]],
    ['git am --resolved', [null]],
    ['git am -r', [null]],
    ['git commit -m a && git -C sub commit -m b', [null, 'sub']],
    ['git fetch --all && git commit -m x', [null]],
    ['if git commit -m x; then :; fi', [null]],
    ['time git commit', [null]],
    ['(cd /repo/desk && git commit -m x); git commit -m y', ['/repo/desk', null]],
    ['X=$(cd /repo/desk && git commit -m x) && git reset --hard', ['/repo/desk']],
    ['echo `cd /repo/desk && git commit -m x` && git reset --hard', ['/repo/desk']],
    ['cd /repo/main; case x in a) git commit -m x;; esac', ['/repo/main']],
  ])('reads %s as %j', (command, dirs) => expect(commitDirs(command)).toEqual(dirs));

  it.each([
    'bash -c "git commit -m x"',
    'bash -c "git commit -am x"',
    'bash -c "git add -A && git commit -m x"',
    "sh -c 'cd /d && git commit -m x'",
    'eval "git commit -m x"',
    'command git commit',
    'timeout 60 git commit -m x',
    'nice git commit',
    'sudo git commit',
    'xargs git commit',
    'git commit-tree abc',
    'echo "run git commit later"',
  ])('leaves out a floor-only wrapper the walker cannot place: %s', (command) => expect(commitDirs(command)).toEqual([]));

  it.each([
    'git merge origin/main',
    'git merge --no-commit x',
    'git merge --squash x',
    'git merge --abort',
    'git rebase --skip',
    'git cherry-pick --quit',
    'git pull',
    'git cherry-pick abc',
    'git rebase main',
    'git status',
  ])('reads %s as making no commit', (command) => expect(commitDirs(command)).toEqual([]));
});

describe('commitCallsOf', () => {
  it('reads each committing call with its own placement and arguments', () => {
    expect(commitCallsOf('git -C /x commit -m y && git commit --amend')).toEqual([
      { placed: true, dir: '/x', args: ['-m', 'y'] },
      { placed: true, dir: null, args: ['--amend'] },
    ]);
    expect(commitCallsOf('git -C "$d" commit -m x')).toEqual([{ placed: false, args: ['-m', 'x'] }]);
    expect(commitCallsOf('git status')).toEqual([]);
  });
});

describe('makesCommit', () => {
  it.each([
    'git commit -m x',
    'git -C /x commit -m y',
    'git merge --continue',
    'git rebase --continue',
    'git cherry-pick --continue',
    'git revert --continue',
    'git am --continue',
    'git am --resolved',
    'git am -r',
    'git -C "$d" commit',
  ])('reads %s as making a commit', (command) => expect(makesCommit(command)).toBe(true));

  it.each([
    'git merge origin/main',
    'git merge --no-commit x',
    'git merge --squash x',
    'git merge --abort',
    'git rebase --skip',
    'git cherry-pick --quit',
    'git pull',
    'git cherry-pick abc',
    'git rebase main',
    'git status',
    'bash -c "git commit -m x"',
  ])('reads %s as making no commit', (command) => expect(makesCommit(command)).toBe(false));
});

describe('gatesMainCheckout', () => {
  it('gates an unattended agent with no writer marker', () => {
    expect(gatesMainCheckout({ PLOT_UNATTENDED: '1' })).toBe(true);
    expect(gatesMainCheckout({ PLOT_UNATTENDED: '1', [MAIN_CHECKOUT_WRITER_ENV]: '' })).toBe(true);
  });

  it('does not gate an unattended agent its spawn marked as a main-checkout writer', () => {
    expect(gatesMainCheckout({ PLOT_UNATTENDED: '1', [MAIN_CHECKOUT_WRITER_ENV]: '1' })).toBe(false);
  });

  it.each([{}, { PLOT_UNATTENDED: '0' }, { PLOT_UNATTENDED: '' }])('does not gate an attended session: %o', (env) =>
    expect(gatesMainCheckout(env)).toBe(false),
  );

  it('names the marker variable', () => {
    expect(MAIN_CHECKOUT_WRITER_ENV).toBe('PLOT_MAIN_CHECKOUT_WRITER');
  });
});

const FORBIDDEN = [/--stop\b/, /\brestart/, /\bkill\b/, /\bbootout/];

describe('mainCheckoutWriteRefusal', () => {
  const equalReading = { number: SPAWN_CONTRACT } as const;
  const text = mainCheckoutWriteRefusal('/repo/skills/plot/scripts', equalReading);

  it('names the desk-root helper so the reader can resolve their own worktree', () => {
    expect(text).toContain('/repo/skills/plot/scripts/plot-desk-root.sh');
    expect(text).toContain('plot_desk_root');
  });

  it('names the main checkout and PLOT_UNATTENDED as the reasons', () => {
    expect(text).toContain('MAIN checkout');
    expect(text).toContain('PLOT_UNATTENDED=1');
  });

  it('names both numbers and tells a by-design writer to stop and report on an absent reading', () => {
    const skewed = mainCheckoutWriteRefusal('/repo/skills/plot/scripts', 'absent');
    expect(skewed).toContain(String(SPAWN_CONTRACT));
    expect(skewed).toContain('none');
    expect(skewed).toContain('stop and report');
    // The disposable-worktree sentence is dropped only in the proven-skew case.
    expect(skewed).not.toContain('disposable worktree the way plot-dispatch.sh');
  });

  it('names the older-gate direction for an absent reading', () => {
    const skewed = mainCheckoutWriteRefusal('/repo/skills/plot/scripts', 'absent');
    expect(skewed).toContain('older');
  });

  it('names both numbers, the newer-gate direction, and tells a by-design writer to stop and report on a larger spawner number', () => {
    const skewed = mainCheckoutWriteRefusal('/repo/skills/plot/scripts', { number: SPAWN_CONTRACT + 1 });
    expect(skewed).toContain(String(SPAWN_CONTRACT));
    expect(skewed).toContain(String(SPAWN_CONTRACT + 1));
    expect(skewed).toContain('newer');
    expect(skewed).toContain('stop and report');
    expect(skewed).not.toContain('disposable worktree the way plot-dispatch.sh');
  });

  it.each([
    ['empty', 'empty' as const],
    ['unreadable', 'unreadable' as const],
    ['equal', equalReading],
  ])('adds no spawner paragraph for %s', (_label, reading) => {
    const unskewed = mainCheckoutWriteRefusal('/repo/skills/plot/scripts', reading);
    expect(unskewed).not.toContain('stop and report');
    expect(unskewed).toContain('disposable worktree the way plot-dispatch.sh');
  });

  it('contains none of the stop/restart/kill/bootout command words, in any reading', () => {
    for (const reading of ['absent', 'empty', 'unreadable', { number: 1 }, { number: SPAWN_CONTRACT }, { number: 999 }] as const) {
      const t = mainCheckoutWriteRefusal('/repo/skills/plot/scripts', reading);
      for (const word of FORBIDDEN) expect(t).not.toMatch(word);
    }
  });
});

describe('strandingResetRefusal', () => {
  const text = strandingResetRefusal('/repo/skills/plot/scripts');

  it('names the desk-root helper and the mixed-reset paragraph', () => {
    expect(text).toContain('/repo/skills/plot/scripts/plot-desk-root.sh');
    expect(text).toContain('mixed');
  });

  it('carries no spawner-marker sentence', () => {
    expect(text).not.toContain('PLOT_MAIN_CHECKOUT_WRITER');
    expect(text).not.toContain('stop and report');
  });

  it('contains none of the stop/restart/kill/bootout command words', () => {
    for (const word of FORBIDDEN) expect(text).not.toContain(word);
  });
});

describe('treeStrandingResetDirs', () => {
  it.each([
    'git reset',
    'git reset origin/main',
    'git reset -q',
    'git reset --mixed HEAD~1',
    'git reset -- file.txt',
    'git reset origin/main -- file.txt',
  ])('reads %s as stranding', (command) => expect(strandsTree(command)).toBe(true));

  it.each(['git reset --hard', 'git reset --hard origin/main', 'git reset --soft HEAD~1', 'git reset --keep HEAD~1', 'git reset --merge'])(
    'reads %s as tree-consistent',
    (command) => expect(strandsTree(command)).toBe(false),
  );

  it('ignores other mutating calls and reads', () => {
    expect(strandsTree('git commit -m x')).toBe(false);
    expect(strandsTree('git status')).toBe(false);
  });

  it('places the call by -C and cd', () => {
    expect(treeStrandingResetDirs('git -C /abs/main reset')).toEqual(['/abs/main']);
    expect(treeStrandingResetDirs('cd /abs/main && git reset')).toEqual(['/abs/main']);
    expect(treeStrandingResetDirs('cd "$desk" && git reset')).toEqual([]);
  });
});

describe('gitPushCalls', () => {
  it('reads a push with no leading option', () => {
    expect(gitPushCalls('git push origin main')).toEqual([['origin', 'main']]);
  });

  it('skips a value-taking global option (value as the next word) before push', () => {
    expect(gitPushCalls('git -C /repo push origin main')).toEqual([['origin', 'main']]);
    expect(gitPushCalls('git --git-dir /repo/.git push origin main')).toEqual([['origin', 'main']]);
  });

  it('skips a boolean global option, and a value-taking one given as --opt=value, before push', () => {
    expect(gitPushCalls('git --no-pager push origin main')).toEqual([['origin', 'main']]);
    expect(gitPushCalls('git --git-dir=/repo/.git push origin main')).toEqual([['origin', 'main']]);
  });

  it('answers no calls for a git command with no push', () => {
    expect(gitPushCalls('git commit -m x')).toEqual([]);
  });

  it('answers no calls for a non-git command', () => {
    expect(gitPushCalls('pnpm test')).toEqual([]);
  });

  it('reads one entry per push across a chained command', () => {
    expect(gitPushCalls('git push origin main && git push origin --tags')).toEqual([
      ['origin', 'main'],
      ['origin', '--tags'],
    ]);
  });
});

describe('gatesStrandingReset', () => {
  it('applies to an unattended agent, marked as a writer or not', () => {
    expect(gatesStrandingReset({ PLOT_UNATTENDED: '1' })).toBe(true);
    expect(gatesStrandingReset({ PLOT_UNATTENDED: '1', [MAIN_CHECKOUT_WRITER_ENV]: '1' })).toBe(true);
  });

  it('leaves an attended session free', () => {
    expect(gatesStrandingReset({})).toBe(false);
  });
});
