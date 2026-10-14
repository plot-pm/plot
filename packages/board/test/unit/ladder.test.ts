import { describe, it, expect } from 'vitest';
import { hostFixture } from '@plot-pm/domain/adapters/host/host-fixture';
import type { CommitStatusWrite } from '@plot-pm/domain/ports/host';
import type { PortResult } from '@plot-pm/domain';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import type { Trees } from '@plot-pm/domain/ports/trees';
import { commitAndPush, type LadderContext } from '../../src/server/entry/ladder.js';

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });
const CREATED_HEAD = 'c'.repeat(40);
const RIVAL_HEAD = 'd'.repeat(40);

/** A `Trees` stub: staged changes exist, the commit succeeds, and the direct
 * push is always rejected — forcing the micro-PR fallback this test targets. */
const treesStub = (): Trees => ({
  hasStagedChanges: async () => answered(true),
  commitAs: async () => answered(undefined),
  push: async () => answered(undefined),
} as unknown as Trees);

/** A `Scripts` stub: the direct push fails (code 1), and `pr-merge` succeeds. */
const scriptsStub = (calls: string[][]): Scripts => ({
  awaited: async () => ({ stdout: '', stderr: '', code: 1 }),
  host: async (args) => {
    calls.push([...args]);
    return answered('');
  },
} as unknown as Scripts);

describe('commitAndPush — micro-PR fallback status write', () => {
  it('writes plot/review on the PR it just created, not a rival open PR with a different head', async () => {
    const statuses: CommitStatusWrite[] = [];
    const calls: string[][] = [];
    let prStateAsks = 0;
    const hostBase = hostFixture({
      // A rival PR this estate also holds — not the one `prCreate` makes —
      // with a DIFFERENT head. If the ladder's status write ever resolved
      // the wrong PR (e.g. by re-listing opens rather than reading the
      // number `prCreate` itself returned), it would write this head instead.
      prs: [{
        number: 99, repo: '', head: 'idea/some-other-plan', state: 'OPEN', mergedAt: null,
        mergeCommit: '', draft: false, mergeable: 'mergeable', review: 'none', checks: 'passing',
        failingChecks: [], url: '', author: '', headSha: RIVAL_HEAD,
      }],
      commitStatuses: statuses,
    });
    const host = {
      ...hostBase,
      prState: async (ref: string | number) => {
        prStateAsks += 1;
        // The PR `prCreate` just made: number '1' (fixture's first `opened` slot).
        if (String(ref) === '1') {
          return answered({
            number: 1, state: 'OPEN' as const, draft: false, headSha: CREATED_HEAD, mergeCommit: '',
          });
        }
        return hostBase.prState(ref);
      },
    };
    const ctx: LadderContext = {
      repoRoot: '/repo',
      host,
      scripts: scriptsStub(calls),
      trees: treesStub(),
    };

    const result = await commitAndPush(
      ctx, '/repo/.worktrees/tmp', 'plot/approve-a-plan', 'main', 'jwloka',
      'plot: approve a-plan', 'plot: approve a-plan', 'body', 'approval',
      'nothing to commit', () => {},
    );

    expect(result).toEqual({ pushed: 'micro-pr' });
    expect(prStateAsks).toBeGreaterThanOrEqual(1);
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ sha: CREATED_HEAD, state: 'success', context: 'plot/review' });
    expect(statuses[0]!.sha).not.toBe(RIVAL_HEAD);

    const mergeCall = calls.find((args) => args[0] === 'pr-merge');
    expect(mergeCall).toContain('1');
  });
});
