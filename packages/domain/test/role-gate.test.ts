import { describe, expect, it } from 'vitest';
import {
  callsCommitStatus,
  callsMerge,
  callsReviewRun,
  commitMessageClosesIssue,
  gateInsideTree,
  gateInsideTreeRefusal,
  isProtectedPath,
  pushesDefaultBranch,
  roleDeniesCommand,
  roleDeniesPath,
  roleOwnBranch,
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
    'plot-host.sh pr-merge 42 --match-head deadbeef',
    'skills/plot/scripts/plot-host.sh pr-merge 42',
    'bash skills/plot/scripts/plot-host.sh pr-merge 42 --match-head deadbeef',
    'gh api -X PUT repos/o/r/pulls/42/merge',
    'gh api --method PUT "repos/o/r/pulls/42/merge" -f sha=deadbeef',
    "curl -X PUT -H 'Authorization: token x' https://api.github.com/repos/o/r/pulls/42/merge",
    'curl -X POST https://api.bitbucket.org/2.0/repositories/w/r/pullrequests/7/merge',
    "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
    "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
  ])('refuses %s', (command) => {
    expect(callsMerge(command)).toBe(true);
  });

  it.each([
    'gh pr view 42',
    'gh pr list',
    'plot-ask.mjs board',
    'echo "gh pr merge 42"',
    'gh pr view 42 && git merge origin/main',
    'plot-host.sh pr-view 42',
    'gh api repos/o/r/pulls/42',
    'gh api repos/o/r/pulls/42/files',
    '# gh api repos/o/r/pulls/42/merge',
  ])('allows %s', (command) => {
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
    'skills/plot/scripts/board/plot-gate.mjs',
    './skills/plot/scripts/board/plot-gate.mjs',
    '/abs/tree/skills/plot/scripts/board/plot-gate.mjs',
    'skills/plot/scripts/board/board-server.mjs',
    'packages/domain/src/rules/role-gate.ts',
    '/abs/tree/packages/domain/src/rules/role-gate.ts',
    'packages/board/src/server/entry/gate.ts',
    '.claude/settings/fixer.json',
  ])('refuses %s', (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });

  it.each([
    'scripts/other.sh',
    'skills/plot/scripts/plot-host.sh',
    'docs/plans/x.md',
    'packages/domain/src/rules/controller-gate.ts',
    'packages/domain/src/rules/role-gate.test.ts',
    'packages/board/src/server/entry/gate.tsx',
    'skills/plot/scripts/boardroom/x.mjs',
  ])(
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

  it('refuses a commit-status write and names it', () => {
    const refusal = roleDeniesCommand('plot-host.sh commit-status main abc123 success', 'main', 'fix/x');
    expect(refusal).toContain('writes the PR review status');
  });

  it('refuses a reviewer run and names it', () => {
    const refusal = roleDeniesCommand('plot-review.mjs 42', 'main', 'fix/x');
    expect(refusal).toContain('runs the reviewer');
  });

  it('refuses a push to the default branch and names it', () => {
    const refusal = roleDeniesCommand('git push origin main', 'main', 'fix/x');
    expect(refusal).toContain('pushes the default branch');
  });

  it('refuses a commit message that closes an issue and names it', () => {
    const refusal = roleDeniesCommand('git commit -m "Fixes #123"', 'main', 'fix/x');
    expect(refusal).toContain('closes an issue');
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

describe('gateInsideTree', () => {
  it.each([
    ['/w/fix/skills/plot/scripts/board/plot-gate.mjs', '/w/fix'],
    ['/w/fix', '/w/fix'],
  ])('reads %s as inside %s', (gatePath, treeRoot) => {
    expect(gateInsideTree(gatePath, treeRoot)).toBe(true);
  });

  it.each([
    ['/var/plot/role-gate/plot-gate.mjs', '/w/fix'],
    ['/w/fix-other/plot-gate.mjs', '/w/fix'],
    ['/w/fix/plot-gate.mjs', ''],
  ])('reads %s as outside %s', (gatePath, treeRoot) => {
    expect(gateInsideTree(gatePath, treeRoot)).toBe(false);
  });

  it('names the gate path and the variable in its refusal', () => {
    const refusal = gateInsideTreeRefusal('/w/fix/skills/plot/scripts/board/plot-gate.mjs');
    expect(refusal).toContain('/w/fix/skills/plot/scripts/board/plot-gate.mjs');
    expect(refusal).toContain('PLOT_ROLE_GATE');
  });
});

describe('roleDeniesCommand on pushes', () => {
  const FIXER = 'fix/pr-head';
  const REPAIR = 'bug/main-repair-0123456789ab';
  const denied = (command: string, own: string, current = 'HEAD') =>
    roleDeniesCommand(command, 'main', current, own) !== null;

  it.each([
    ['fixer', FIXER],
    ['main-repair', REPAIR],
  ])('refuses a forced push for the %s role', (_role, own) => {
    for (const flag of ['--force', '-f', '--force-with-lease', '--force-with-lease=x:abc', '--force-if-includes']) {
      expect(denied(`git push ${flag} origin HEAD:${own}`, own)).toBe(true);
    }
    expect(denied(`git push origin +HEAD:${own}`, own)).toBe(true);
    expect(denied(`git push origin +HEAD:b`, own)).toBe(true);
  });

  it.each([
    ['fixer', FIXER],
    ['main-repair', REPAIR],
  ])('refuses a push to another branch for the %s role', (_role, own) => {
    expect(denied('git push origin HEAD:other', own)).toBe(true);
    expect(denied('git push origin other', own)).toBe(true);
    expect(denied('git push origin HEAD:refs/heads/other', own)).toBe(true);
  });

  it('refuses a bare push from a checkout of another branch', () => {
    expect(denied('git push', FIXER, 'feature/x')).toBe(true);
    expect(denied('git push origin HEAD', FIXER, 'feature/x')).toBe(true);
  });

  it.each([
    ['fixer', FIXER],
    ['main-repair', REPAIR],
  ])('refuses a branch deletion for the %s role', (_role, own) => {
    expect(denied('git push --delete origin b', own)).toBe(true);
    expect(denied('git push -d origin b', own)).toBe(true);
    expect(denied('git push origin :b', own)).toBe(true);
    expect(denied(`git push origin :${own}`, own)).toBe(true);
  });

  it.each([
    ['fixer', FIXER],
    ['main-repair', REPAIR],
  ])('allows the own push for the %s role', (_role, own) => {
    expect(denied(`git push origin HEAD:${own}`, own)).toBe(false);
    expect(denied(`git push origin HEAD:refs/heads/${own}`, own)).toBe(false);
    expect(denied(`git push origin ${own}`, own)).toBe(false);
  });

  it('judges a chained command call by call', () => {
    expect(denied(`git fetch && git push origin HEAD:${FIXER}`, FIXER)).toBe(false);
    expect(denied(`git push origin HEAD:${FIXER} && git push -f origin HEAD:${FIXER}`, FIXER)).toBe(true);
  });

  it('applies no push rule where the role names no own branch', () => {
    expect(denied('git push origin HEAD:other', '')).toBe(false);
  });

  it('does not read the raw string: a quoted flag in a message is no push', () => {
    expect(denied(`git commit -m "never git push --force"`, FIXER)).toBe(false);
  });
});

describe('roleOwnBranch', () => {
  it('returns the branch the environment names', () => {
    expect(roleOwnBranch('fix/pr-head', 'other')).toBe('fix/pr-head');
  });
  it('falls back to a checked-out main-repair branch', () => {
    expect(roleOwnBranch('', 'bug/main-repair-0123456789ab')).toBe('bug/main-repair-0123456789ab');
  });
  it('names no branch otherwise', () => {
    expect(roleOwnBranch('', 'feature/x')).toBe('');
    expect(roleOwnBranch('', 'bug/main-repair-xyz')).toBe('');
  });
});
