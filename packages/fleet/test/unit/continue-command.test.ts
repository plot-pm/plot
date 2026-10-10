import { describe, expect, it } from 'vitest';
import type { FleetReading } from '@plot-pm/domain';
import { run } from '../../src/server/entry/continue-command.js';
import { branchFromPulse, continueBranch } from '../../src/shared/continue-command.js';

// The refusals the continue controller keeps, with no board: they are answered
// from the pulse value alone, before any agent starts.

const pulse = {
  main: 'abc',
  plans: [
    {
      file: 'docs/plans/p.md',
      slices: [
        {
          name: 'one',
          branches: [
            { branch: 'feature/has-desk', local_worktree: '/w/has-desk', worker: 'waiting', worker_pid: '41' },
            { branch: 'feature/no-desk', local_worktree: '', worker: 'elsewhere', worker_pid: '' },
          ],
        },
      ],
    },
  ],
} as unknown as FleetReading;

const opts = { repoRoot: '/nonexistent', scriptsDir: '/nonexistent' };

describe('continueBranch', () => {
  it('refuses unknown-branch with 404 where the pulse does not list the branch', async () => {
    const r = await continueBranch({ opts, pulse, branch: 'feature/nope', answer: 'yes' });
    expect(r).toMatchObject({ kind: 'refused', status: 404, reason: 'unknown-branch' });
  });

  it('refuses unknown-branch where there is no pulse at all', async () => {
    const r = await continueBranch({ opts, pulse: null, branch: 'feature/has-desk', answer: 'yes' });
    expect(r).toMatchObject({ kind: 'refused', status: 404, reason: 'unknown-branch' });
  });

  it('refuses no-worktree with 404 where the branch holds no desk on this machine', async () => {
    const r = await continueBranch({ opts, pulse, branch: 'feature/no-desk', answer: 'yes' });
    expect(r).toMatchObject({ kind: 'refused', status: 404, reason: 'no-worktree' });
  });

  it('finds a branch by the pulse record and returns its desk', () => {
    expect(branchFromPulse(pulse, 'feature/has-desk')).toMatchObject({ worktree: '/w/has-desk', pid: '41' });
  });
});

describe('the continue entry', () => {
  it('exits 2 for missing arguments and for an empty answer', async () => {
    const warned: string[] = [];
    expect(await run([], '/nonexistent', '/nonexistent', {}, () => {}, (s) => warned.push(s))).toBe(2);
    expect(await run(['feature/x', ''], '/nonexistent', '/nonexistent', {}, () => {}, (s) => warned.push(s))).toBe(2);
    expect(warned.join('')).toContain('usage: plot-continue-command.mjs');
  });
});
