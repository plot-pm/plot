import { describe, expect, it } from 'vitest';
import {
  gatesMainCheckout,
  gatesStrandingReset,
  gitWriteDirs,
  MAIN_CHECKOUT_WRITER_ENV,
  mainCheckoutWriteRefusal,
  mutatesGitState,
  strandsTree,
  treeStrandingResetDirs,
} from '../src/rules/main-checkout-write.js';

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

describe('mainCheckoutWriteRefusal', () => {
  const text = mainCheckoutWriteRefusal('/repo/skills/plot/scripts');

  it('names the desk-root helper so the reader can resolve their own worktree', () => {
    expect(text).toContain('/repo/skills/plot/scripts/plot-desk-root.sh');
    expect(text).toContain('plot_desk_root');
  });

  it('names the main checkout and PLOT_UNATTENDED as the reasons', () => {
    expect(text).toContain('MAIN checkout');
    expect(text).toContain('PLOT_UNATTENDED=1');
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

describe('gatesStrandingReset', () => {
  it('applies to an unattended agent, marked as a writer or not', () => {
    expect(gatesStrandingReset({ PLOT_UNATTENDED: '1' })).toBe(true);
    expect(gatesStrandingReset({ PLOT_UNATTENDED: '1', [MAIN_CHECKOUT_WRITER_ENV]: '1' })).toBe(true);
  });

  it('leaves an attended session free', () => {
    expect(gatesStrandingReset({})).toBe(false);
  });
});
