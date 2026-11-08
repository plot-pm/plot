import type { RepoSnapshot } from '../../src/entities/snapshot.js';

/** A snapshot with every key read, as plain JSON: the shape the channel will carry. */
export const fullSnapshot = (): RepoSnapshot => ({
  generation: 10,
  readings: {
    refs: {
      state: 'read',
      readAt: 1,
      value: {
        entries: [
          { ref: 'refs/heads/main', sha: 'a'.repeat(40), head: true },
          { ref: 'refs/remotes/origin/main', sha: 'a'.repeat(40) },
        ],
        digest: `refs/heads/main=${'a'.repeat(40)}\nrefs/remotes/origin/main=${'a'.repeat(40)}`,
      },
    },
    desks: {
      state: 'read',
      readAt: 1,
      value: [
        {
          path: '/repo',
          branch: 'main',
          detached: false,
          isMain: true,
          clean: true,
          agentSession: null,
          prunable: false,
          head: 'a'.repeat(40),
        },
      ],
    },
    deskFiles: {
      state: 'read',
      readAt: 1,
      value: { '/repo/.worktrees/x': { question: 'which?', markers: ['PLOT-BLOCKED.md'], pid: '42', exit: null } },
    },
    workers: {
      state: 'read',
      readAt: 1,
      value: { '/repo/.worktrees/x': { state: 'waiting', pid: '42', exitCode: '0', activity: '' } },
    },
    plans: { state: 'read', readAt: 1, value: { ref: 'origin/main', records: [] } },
    registry: { state: 'read', readAt: 1, value: [] },
    prs: {
      state: 'read',
      readAt: 1,
      value: [{ number: 7, head: 'feature/x', state: 'OPEN', draft: false, checks: 'pass', review: '', url: 'u' }],
    },
    issues: { state: 'read', readAt: 1, value: [{ number: '3', title: 't', url: 'u' }] },
    defaultBranch: { state: 'failed', readAt: 1, reason: 'host refused' },
    config: { state: 'read', readAt: 1, value: { 'Plan directory': 'docs/plans/' } },
  },
});
