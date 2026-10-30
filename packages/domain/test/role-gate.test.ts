import { describe, expect, it } from 'vitest';
import {
  callsCommitStatus,
  callsMerge,
  callsReviewRun,
  commitMessageClosesIssue,
  isProtectedPath,
  pushesDefaultBranch,
  roleDeniesCommand,
  roleDeniesPath,
} from '../src/rules/role-gate.js';

describe('callsCommitStatus', () => {
  it.each(['plot-host.sh commit-status abc123 success plot/review', 'skills/plot/scripts/plot-host.sh commit-status abc123 failure plot/review'])(
    'refuses %s',
    (command) => {
      expect(callsCommitStatus(command)).toBe(true);
    },
  );

  it.each(['plot-host.sh pr-merge 1 abc123', 'echo "plot-host.sh commit-status"', 'git status'])('allows %s', (command) => {
    expect(callsCommitStatus(command)).toBe(false);
  });
});

describe('callsReviewRun', () => {
  it('refuses a direct call', () => {
    expect(callsReviewRun('node board/plot-review.mjs 42')).toBe(true);
    expect(callsReviewRun('skills/plot/scripts/plot-review.mjs 42')).toBe(true);
  });

  it('allows a reference inside a quoted string or comment', () => {
    expect(callsReviewRun('echo "plot-review.mjs"')).toBe(false);
    expect(callsReviewRun('git status # plot-review.mjs')).toBe(false);
  });
});

describe('callsMerge', () => {
  it.each([
    'gh pr merge 42 --match-head-commit deadbeef',
    'gh pr merge 42',
    'plot-ask.mjs merge 42 deadbeef',
    'skills/plot/scripts/board/plot-ask.mjs merge 42 deadbeef',
  ])('refuses %s', (command) => {
    expect(callsMerge(command)).toBe(true);
  });

  it.each(['gh pr view 42', 'gh pr list', 'plot-ask.mjs board', 'echo "gh pr merge 42"'])('allows %s', (command) => {
    expect(callsMerge(command)).toBe(false);
  });
});

describe('pushesDefaultBranch', () => {
  it.each([
    ['git push origin main', 'main', 'fix/x'],
    ['git push origin HEAD', 'main', 'main'],
    ['git push', 'main', 'main'],
    ['git push origin +fix/x:main', 'main', 'fix/x'],
    ['git push origin refs/heads/fix/x:refs/heads/main', 'main', 'fix/x'],
    ['git push --all', 'main', 'fix/x'],
    ['git push --mirror', 'main', 'fix/x'],
  ])('refuses %s (default=%s, current=%s)', (command, defaultBranch, currentBranch) => {
    expect(pushesDefaultBranch(command, defaultBranch, currentBranch)).toBe(true);
  });

  it.each([
    ['git push origin fix/x', 'main', 'fix/x'],
    ['git push', 'main', 'fix/x'],
    ['git push origin HEAD', 'main', 'fix/x'],
    ['git status', 'main', 'main'],
    ['git push origin main', '', 'main'],
  ])('allows %s (default=%s, current=%s)', (command, defaultBranch, currentBranch) => {
    expect(pushesDefaultBranch(command, defaultBranch, currentBranch)).toBe(false);
  });
});

describe('commitMessageClosesIssue', () => {
  it.each([
    'git commit -m "Fixes #123"',
    'git commit -m "fixes #123: done"',
    'git commit -m "Closes #9"',
    'git commit -m "resolved #42"',
  ])('refuses %s', (command) => {
    expect(commitMessageClosesIssue(command)).toBe(true);
  });

  it.each(['git commit -m "plain message"', 'git status'])('allows %s', (command) => {
    expect(commitMessageClosesIssue(command)).toBe(false);
  });
});

describe('isProtectedPath', () => {
  it.each([
    '.claude/agents/fixer.md',
    './.claude/settings.json',
    'scripts/check-shell-lines.sh',
    'skills/plot/scripts/plot-controller-gate.sh',
    '.github/workflows/ci.yml',
    'nested/.github/workflows/ci.yml',
  ])('refuses %s', (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });

  it.each(['packages/domain/src/rules/role-gate.ts', 'scripts/other.sh', 'skills/plot/scripts/plot-host.sh', 'docs/plans/x.md'])(
    'allows %s',
    (path) => {
      expect(isProtectedPath(path)).toBe(false);
    },
  );
});

describe('roleDeniesCommand', () => {
  it('refuses a forbidden call and names it', () => {
    const refusal = roleDeniesCommand('gh pr merge 42', 'main', 'fix/x');
    expect(refusal).not.toBeNull();
    expect(refusal).toContain('merges a pull request');
  });

  it('allows a permitted control in the same shape', () => {
    expect(roleDeniesCommand('git commit -m "a normal change"', 'main', 'fix/x')).toBeNull();
    expect(roleDeniesCommand('echo permitted-control-ran', 'main', 'fix/x')).toBeNull();
  });
});

describe('roleDeniesPath', () => {
  it('refuses a protected path', () => {
    expect(roleDeniesPath('.claude/agents/fixer.md')).toContain('.claude/agents/fixer.md');
  });

  it('allows an ordinary path', () => {
    expect(roleDeniesPath('packages/domain/src/index.ts')).toBeNull();
  });
});
