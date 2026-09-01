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
import { afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  maybeAutoDispatch,
} from '../../src/server/auto-dispatch.js';
import { FleetReadingSchema, type FleetReading } from '../../src/contract/schema.js';
import type { AgentEntry } from '../../src/server/registry.js';
import type { FleetSettings } from '../../src/server/fleet-settings.js';
import { rmTree } from '../helpers.mjs';

const made: string[] = [];
afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) rmTree(dir);
  }
});

/** A scratch repo plus a stub scripts dir whose plot-dispatch.sh records args.
 * Now initializes as a real git repo with origin/main containing briefs for
 * the branches the tests use — see `a-worker-starts-with-its-brief.md` for
 * why auto-dispatch reads briefs from git, not the filesystem.
 */
function fixture(briefBranches: string[] = []): {
  opts: { repoRoot: string; scriptsDir: string };
  runs: () => string[];
} {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-auto-repo-'));
  const scriptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-auto-scripts-'));
  made.push(repoRoot, scriptsDir);

  // Initialize git repo and create briefs on origin/main.
  // Auto-dispatch reads briefs from `origin/main:.plot/briefs/<slug>.md`, so
  // the test must set up real git refs — not just files in the working tree.
  const { execSync } = require('node:child_process');
  execSync('git init --initial-branch=main', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git config user.email "test@test.local"', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: 'ignore' });

  // Create briefs for the branches auto-dispatch should be allowed to start.
  const briefsDir = path.join(repoRoot, '.plot/briefs');
  fs.mkdirSync(briefsDir, { recursive: true });
  for (const branch of briefBranches) {
    const slug = branch.split('/').pop() ?? branch;
    fs.writeFileSync(path.join(briefsDir, `${slug}.md`), `# Brief for ${branch}\n`);
  }
  if (briefBranches.length > 0) {
    execSync('git add .plot/briefs', { cwd: repoRoot, stdio: 'ignore' });
  }

  // Initial commit + set up origin/main ref pointing to the same commit.
  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Test\n');
  execSync('git add README.md', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git update-ref refs/remotes/origin/main HEAD', { cwd: repoRoot, stdio: 'ignore' });

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

/**
 * One wave, in the FleetReading branch shape.
 *
 * Each branch is [name, state, ref_held?]. When `ref_held` is not given, it
 * defaults to false — but a `wip` state implies a ref (the scan derives `wip`
 * by walking one), so the fallback in `refBlocksClaim` still catches it.
 */
const wave = (
  name: string,
  verdict: 'complete' | 'eligible' | 'blocked',
  branches: Array<[string, 'open' | 'wip' | 'merged' | 'claimed' | 'deferred', boolean?]>,
) => ({
  name,
  verdict,
  branches: branches.map(([branch, state, ref_held]) => ({
    branch,
    state,
    deferred: state === 'deferred',
    claimed: state === 'claimed' ? 'someone' : '',
    ref_held: ref_held ?? false,
  })),
});

const pulse = (plans: Array<[string, string, ReturnType<typeof wave>[]]>): FleetReading =>
  FleetReadingSchema.parse({
    main: 'main',
    head: 'abc1234',
    plans: plans.map(([file, phase, waves]) => ({ file, phase, slices: waves })),
    summary: { plans: plans.length, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0 },
  });

const on = (parallelAgents: number): FleetSettings =>
  ({ autoDispatch: true, parallelAgents, machineOverride: false });
const off = (parallelAgents: number): FleetSettings =>
  ({ autoDispatch: false, parallelAgents, machineOverride: false });

const running = (branch: string): AgentEntry => ({
  session: `s-${branch}`, branch, worktree: `/wt/${branch}`, command: '',
  startedAt: '2026-08-23T00:00:00Z', pid: '1', previousPid: '', relaunches: 0, state: 'running',
});

describe('maybeAutoDispatch — the spawn half', () => {
  it('spawns plot-dispatch.sh with --max and the slug for an eligible approved wave', async () => {
    // With brief for feature/a on origin/main.
    const { opts, runs } = fixture(['feature/a']);
    const p = pulse([['2026-08-22-ship-it.md', 'approved', [wave('W', 'eligible', [['feature/a', 'open']])]]]);
    const next = maybeAutoDispatch(opts, p, on(5), [], new Set());
    await settle();
    expect(runs()).toEqual(['--max 1 ship-it']);
    expect(next.has('feature/a')).toBe(true);
  });

  it('spawns NOTHING while the switch is off', async () => {
    const { opts, runs } = fixture(['feature/a']);
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
    const { opts, runs } = fixture(['feature/a', 'feature/b']);
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
    const { opts, runs } = fixture(['feature/a']);
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
    const { opts, runs } = fixture(['feature/a']);
    const p = pulse([['2026-08-22-ship-it.md', 'approved', [wave('W', 'eligible', [['feature/a', 'wip']])]]]);
    const next = maybeAutoDispatch(opts, p, on(1), [running('feature/a')], new Set(['feature/a']));
    await settle();
    expect(runs()).toEqual([]);
    expect(next.has('feature/a')).toBe(false);
  });

  it('names a wip branch it skipped, once per pulse, and dispatches the open one', async () => {
    // Item 4 of the plan: the refusal that removed the budget must be visible.
    // Replaying the planner by hand against the pulse JSON is how this defect
    // was found; nobody should need to. The name is logged AT MOST ONCE per
    // pulse — a line repeated every 5 s is noise, not a diagnostic.
    // Note: feature/stale is wip (has a ref), so no brief is needed. feature/fresh needs one.
    const { opts, runs } = fixture(['feature/fresh']);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const p = pulse([
      ['2026-07-25-stale.md', 'approved', [wave('W', 'eligible', [['feature/stale', 'wip']])]],
      ['2026-08-25-fresh.md', 'approved', [wave('W', 'eligible', [['feature/fresh', 'open']])]],
    ]);
    maybeAutoDispatch(opts, p, on(1), [], new Set());
    await settle();
    // The budget landed on the open branch, not the wip one it skipped.
    expect(runs()).toEqual(['--max 1 fresh']);
    const skipLines = log.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes('feature/stale'));
    expect(skipLines).toHaveLength(1);
    expect(skipLines[0]).toContain('feature/stale');
    log.mockRestore();
  });

  it('fans out two approved plans, splitting one budget across them', async () => {
    // Cap 3, four eligible branches over two plans → total 3, each plan capped at
    // its share in document order: plan one takes 2, plan two takes 1.
    const { opts, runs } = fixture(['feature/a', 'feature/b', 'feature/c', 'feature/d']);
    const p = pulse([
      ['2026-08-22-one.md', 'approved', [wave('W', 'eligible', [['feature/a', 'open'], ['feature/b', 'open']])]],
      ['2026-08-22-two.md', 'approved', [wave('W', 'eligible', [['feature/c', 'open'], ['feature/d', 'open']])]],
    ]);
    maybeAutoDispatch(opts, p, on(3), [], new Set());
    await settle();
    expect(runs().sort()).toEqual(['--max 1 two', '--max 2 one']);
  });
});
