// The SPAWN half of auto-dispatch, wave 3 of approval-hands-the-work-to-agents.
//
// The pure decision (which plans, what --max) is covered exhaustively by
// auto-dispatch.test.ts. This proves the other half: that `maybeAutoDispatch`
// actually spawns `plot-dispatch.sh` with the arguments the plan named, spawns
// NOTHING when the switch is off or the budget is spent, and — the load-bearing
// cross-pulse property — that a branch left in flight from one call is charged
// against the cap on the next so two calls cannot reach 2N.
//
// It never runs the real script: a stub `plot-dispatch.sh` records its arguments
// to a marker file and exits, so no worktree is made and nothing is pushed. The
// detached spawn is settled for with a short wait.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  maybeAutoDispatch,
} from '../../src/server/auto-dispatch.js';
import { FleetPulseSchema, type FleetPulse } from '../../src/contract/schema.js';
import type { AgentEntry } from '../../src/server/registry.js';
import type { FleetControls } from '../../src/server/fleet-controls.js';

const made: string[] = [];
afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A scratch repo plus a stub scripts dir whose plot-dispatch.sh records args. */
function fixture(): { opts: { repoRoot: string; scriptsDir: string }; runs: () => string[] } {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-auto-repo-'));
  const scriptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-auto-scripts-'));
  made.push(repoRoot, scriptsDir);
  const marker = path.join(scriptsDir, 'dispatch-ran.txt');
  fs.writeFileSync(
    path.join(scriptsDir, 'plot-dispatch.sh'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(marker)}\n`,
    { mode: 0o755 },
  );
  return {
    opts: { repoRoot, scriptsDir },
    runs: () =>
      fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean) : [],
  };
}

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

const wave = (
  name: string,
  verdict: 'complete' | 'eligible' | 'blocked',
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred']>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    claimed: state === 'claimed' ? 'someone' : '',
  })),
});

const pulse = (plans: Array<[string, string, ReturnType<typeof wave>[]]>): FleetPulse =>
  FleetPulseSchema.parse({
    main: 'main',
    head: 'abc1234',
    plans: plans.map(([file, phase, waves]) => ({ file, phase, waves })),
    summary: { plans: plans.length, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  });

const on = (parallelAgents: number): FleetControls => ({ autoDispatch: true, parallelAgents });
const off = (parallelAgents: number): FleetControls => ({ autoDispatch: false, parallelAgents });

const running = (branch: string): AgentEntry => ({
  session: `s-${branch}`, branch, worktree: `/wt/${branch}`, command: '',
  startedAt: '2026-08-23T00:00:00Z', pid: '1', previousPid: '', relaunches: 0, state: 'running',
});

describe('maybeAutoDispatch — the spawn half', () => {
  it('spawns plot-dispatch.sh with --max and the slug for an eligible approved wave', async () => {
    const { opts, runs } = fixture();
    const p = pulse([['2026-08-22-ship-it.md', 'approved', [wave('W', 'eligible', [['feature/a', 'open']])]]]);
    const next = maybeAutoDispatch(opts, p, on(5), [], new Set());
    await settle();
    expect(runs()).toEqual(['--max 1 ship-it']);
    expect(next.has('feature/a')).toBe(true);
  });

  it('spawns NOTHING while the switch is off', async () => {
    const { opts, runs } = fixture();
    const p = pulse([['2026-08-22-ship-it.md', 'approved', [wave('W', 'eligible', [['feature/a', 'open']])]]]);
    const next = maybeAutoDispatch(opts, p, off(5), [], new Set());
    await settle();
    expect(runs()).toEqual([]);
    expect(next.size).toBe(0);
  });

  it('CROSS-PULSE cap: the branch from call one is charged against call two', async () => {
    // Cap 1. Call one dispatches feature/a and leaves it in flight. Call two,
    // handed that in-flight set and the SAME still-open pulse (the detached stub
    // pushed no claim), must dispatch nothing — 1 − 1 in-flight = 0. An
    // implementation passing `--max 1` every pulse would run the stub twice and
    // reach 2N.
    const { opts, runs } = fixture();
    const p = pulse([['2026-08-22-ship-it.md', 'approved', [
      wave('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']]),
    ]]]);
    const afterOne = maybeAutoDispatch(opts, p, on(1), [], new Set());
    await settle();
    expect(runs()).toEqual(['--max 1 ship-it']);

    const afterTwo = maybeAutoDispatch(opts, p, on(1), [], afterOne);
    await settle();
    expect(runs()).toEqual(['--max 1 ship-it']); // still one — call two withheld
    expect(afterTwo.has('feature/a')).toBe(true); // stays in flight until confirmed
  });

  it('lowering the cap below the live count withholds the next dispatch and kills nothing', async () => {
    // Two running workers, cap lowered to 1: the budget is negative, nothing new
    // starts, and this function has no kill path — the two are untouched.
    const { opts, runs } = fixture();
    const agents = [running('feature/x'), running('feature/y')];
    const p = pulse([['2026-08-22-ship-it.md', 'approved', [wave('W', 'eligible', [['feature/a', 'open']])]]]);
    maybeAutoDispatch(opts, p, on(1), agents, new Set());
    await settle();
    expect(runs()).toEqual([]);
  });

  it('retires an in-flight branch once a live registry entry holds it', async () => {
    // feature/a was dispatched last pulse; a running agent now holds it, so the
    // registry has caught up — the in-flight mark is retired and the slot is
    // counted through the registry, not double-charged.
    const { opts, runs } = fixture();
    const p = pulse([['2026-08-22-ship-it.md', 'approved', [wave('W', 'eligible', [['feature/a', 'wip']])]]]);
    const next = maybeAutoDispatch(opts, p, on(1), [running('feature/a')], new Set(['feature/a']));
    await settle();
    expect(runs()).toEqual([]);
    expect(next.has('feature/a')).toBe(false);
  });

  it('fans out two approved plans, splitting one budget across them', async () => {
    // Cap 3, four eligible branches over two plans → total 3, each plan capped at
    // its share in document order: plan one takes 2, plan two takes 1.
    const { opts, runs } = fixture();
    const p = pulse([
      ['2026-08-22-one.md', 'approved', [wave('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']])]],
      ['2026-08-22-two.md', 'approved', [wave('W', 'eligible', [['feature/c', 'open'], ['feature/d', 'open']])]],
    ]);
    maybeAutoDispatch(opts, p, on(3), [], new Set());
    await settle();
    expect(runs().sort()).toEqual(['--max 1 two', '--max 2 one']);
  });
});
