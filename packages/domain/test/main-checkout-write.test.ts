import { describe, expect, it } from 'vitest';
import { gitWriteDirs, mainCheckoutWriteRefusal, mutatesGitState } from '../src/rules/main-checkout-write.js';

describe('mutatesGitState', () => {
  it.each([
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
    '(git commit -m y)',
  ])('reads a git call inside a substitution or subshell: %s', (command) => expect(mutatesGitState(command)).toBe(true));
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
