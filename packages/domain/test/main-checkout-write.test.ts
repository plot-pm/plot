import { describe, expect, it } from 'vitest';
import { mainCheckoutWriteRefusal, mutatesGitState } from '../src/rules/main-checkout-write.js';

describe('mutatesGitState', () => {
  it.each([
    'git commit -m x',
    'git reset --hard HEAD~1',
    'git reset HEAD~1',
    'git checkout -- .',
    'git restore .',
    'git merge origin/main',
    'git rebase origin/main',
    'git cherry-pick abc123',
    'git revert abc123',
    'git am patch.diff',
    'git apply patch.diff',
    'git stash pop',
    'git update-ref refs/heads/main abc123',
    'git symbolic-ref HEAD refs/heads/main',
    'git branch -f main abc123',
    'git switch main',
    'git rm file.txt',
    'git mv a b',
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
});

describe('mainCheckoutWriteRefusal', () => {
  const text = mainCheckoutWriteRefusal('/repo/skills/plot/scripts');

  it('names the desk-root helper so the reader can resolve their own worktree', () => {
    expect(text).toContain('/repo/skills/plot/scripts/plot-desk-root.sh');
    expect(text).toContain('plot_desk_root');
  });

  it('names the main checkout as the problem', () => {
    expect(text).toContain('MAIN checkout');
  });
});
