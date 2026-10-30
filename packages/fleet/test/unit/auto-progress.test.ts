// An approved plan's merged-slice count reaches its issue comment.
//
// The fake Scripts records every call, so each test asserts what the pass asked
// of `plot-plan-state.sh` and, for the no-`Issue:` case, that the script (which
// owns the tracker call) is the only thing asked.
import { describe, expect, it } from 'vitest';
import type { FleetReading } from '@plot-pm/domain';
import type { Scripts } from '@plot-pm/domain/ports/scripts';
import { runAutoProgressPass } from '../../src/shared/auto-progress.js';

const BASE = '2026-10-29-x.md';

const branch = (name: string, state: string) => ({
  branch: name, state, deferred: state === 'deferred', deferred_reason: '', claimed: '', local_dirty: false, local_worktree: '',
});

const pulseOf = (phase: string, merged: number, total: number): FleetReading =>
  ({
    main: 'main',
    head: 'abc1234',
    plans: [
      {
        file: BASE,
        phase,
        unreadBranchItems: [],
        slices: Array.from({ length: total }, (_, i) => ({
          name: `s${i}`,
          verdict: i < merged ? 'complete' : 'eligible',
          branches: [branch(`feature/b${i}`, i < merged ? 'merged' : 'open')],
        })),
      },
    ],
    summary: { plans: 1, waves: total, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  }) as unknown as FleetReading;

const world = () => {
  const calls: Array<{ script: string; args: readonly string[] }> = [];
  const scripts = {
    config: async () => ({ ok: true, value: 'docs/plans/' }),
    awaited: async (script: string, args: readonly string[]) => {
      calls.push({ script, args });
      return { stdout: 'summary: tracker=written\n', stderr: '', code: 0 };
    },
  } as unknown as Scripts;
  return { calls, opts: { repoRoot: '/repo', scriptsDir: '/s', scripts } };
};

describe('the merged-slice count write', () => {
  it('sends the count of an approved plan, comment-only, with the plan link', async () => {
    const { calls, opts } = world();
    await runAutoProgressPass(opts, pulseOf('approved', 1, 2));
    expect(calls).toEqual([
      {
        script: 'plot-plan-state.sh',
        args: ['/repo/docs/plans/' + BASE, '--phase', 'approved', '--plan-link', 'docs/plans/' + BASE, '--slice-progress', '1 of 2 slices merged'],
      },
    ]);
  });

  it('sends nothing for a plan that is not approved', async () => {
    const { calls, opts } = world();
    await runAutoProgressPass(opts, pulseOf('delivered', 2, 2));
    await runAutoProgressPass(opts, pulseOf('draft', 0, 2));
    expect(calls).toEqual([]);
  });

  it('sends nothing without a pulse', async () => {
    const { calls, opts } = world();
    await runAutoProgressPass(opts, null);
    expect(calls).toEqual([]);
  });

  it('sends a count once, and again when a merge changes it', async () => {
    const { calls, opts } = world();
    const sent = new Map<string, string>();
    await runAutoProgressPass(opts, pulseOf('approved', 1, 2), sent);
    await runAutoProgressPass(opts, pulseOf('approved', 1, 2), sent);
    expect(calls).toHaveLength(1);
    await runAutoProgressPass(opts, pulseOf('approved', 2, 2), sent);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args.at(-1)).toBe('2 of 2 slices merged');
  });

  it('retries a count whose write failed', async () => {
    const { calls, opts } = world();
    const failing = { ...opts, scripts: { ...opts.scripts, awaited: async () => ({ stdout: 'summary: tracker=failed\n', stderr: '', code: 0 }) } as unknown as Scripts };
    const sent = new Map<string, string>();
    await runAutoProgressPass(failing, pulseOf('approved', 1, 2), sent);
    expect(sent.size).toBe(0);
    await runAutoProgressPass(opts, pulseOf('approved', 1, 2), sent);
    expect(calls).toHaveLength(1);
  });
});
