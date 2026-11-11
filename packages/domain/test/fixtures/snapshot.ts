import type { PlanEntry, PlansValue, RepoSnapshot } from '../../src/entities/snapshot.js';

/** A `plans` value at `ref` holding `records`, with no author and no Delivered plan. */
export const plansOf = (records: readonly PlanEntry[], ref = 'origin/main'): PlansValue => ({
  ref,
  resolved: ref === 'worktree' ? '' : 'a'.repeat(40),
  records,
  authors: { state: 'read', value: {} },
  delivered: { state: 'read', value: {} },
});

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
    plans: {
      state: 'read',
      readAt: 1,
      value: {
        ref: 'origin/main',
        resolved: 'a'.repeat(40),
        records: [],
        authors: { state: 'read', value: { 'docs/plans/2026-01-01-x.md': 'Jan Wloka' } },
        delivered: { state: 'failed', reason: 'the delivery commits could not be read' },
      },
    },
    registry: { state: 'read', readAt: 1, value: [] },
    prs: {
      state: 'read',
      readAt: 1,
      value: [{ number: 7, head: 'feature/x', state: 'OPEN', draft: false, checks: 'pass', review: '', url: 'u' }],
    },
    issues: { state: 'read', readAt: 1, value: [{ number: '3', title: 't', url: 'u' }] },
    defaultBranch: { state: 'failed', readAt: 1, reason: 'host refused' },
    config: { state: 'read', readAt: 1, value: { 'Plan directory': 'docs/plans/' } },
    walk: {
      state: 'read',
      readAt: 1,
      value: {
        header: {
          main: 'main',
          readRef: 'aaaaaaa',
          localHead: 'aaaaaaa',
          fetchFailed: false,
          fetchError: '',
          planDir: 'docs/plans/',
          mergeDetect: 'unaskable',
          nowSeconds: 1,
        },
        estate: { mainSha: 'a'.repeat(40), source: 'ref', blobs: [], indexes: [], dangling: [] },
        branches: { mainSha: 'a'.repeat(40), backend: 'github', origin: '', hostReach: 'ok', merges: [], added: {}, branches: [] },
        desks: { mainSha: 'a'.repeat(40), desks: [] },
        conflicts: {},
      },
    },
    branchDates: { state: 'read', readAt: 1, value: [{ branch: 'feature/x', committedAt: 1 }] },
    ideaPlans: { state: 'read', readAt: 1, value: {} },
    releaseVersions: { state: 'read', readAt: 1, value: {} },
    unmerged: { state: 'read', readAt: 1, value: { branches: ['feature/x'], claimOnly: [] } },
    questions: { state: 'read', readAt: 1, value: { 'feature/x': { firstLine: 'which?', askedAt: '2026-11-08T10:00:00Z' } } },
    branchPlans: { state: 'read', readAt: 1, value: [] },
    sprints: {
      state: 'read',
      readAt: 1,
      value: [
        {
          path: 'docs/sprints/active/2026-W45-s.md',
          sprint: {
            slug: 's',
            title: 'S',
            phase: 'Active',
            release: '2.35.0',
            goal: 'g',
            start: '2026-11-02',
            end: '2026-11-13',
            members: [{ slug: 'x', text: '', tier: 'must', checked: false }],
          },
        },
      ],
    },
    stories: { state: 'unread' },
  },
});
