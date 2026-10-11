import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FleetReadingSchema } from '@plot-pm/domain/entities/fleet';
import { fleetStateFile } from '@plot-pm/domain/adapters/fleet-state/fleet-state-file';
import type { FleetReading } from '@plot-pm/domain';
import { run } from '../../src/server/entry/continue-command.js';
import { branchFromPulse, continueBranch } from '../../src/shared/continue-command.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

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

describe('the continue entry on a desk holding PLOT-BLOCKED', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmTree(d);
  });

  it('starts a new pid through the default bridged pulse', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-blocked-')));
    dirs.push(root);
    const repo = path.join(root, 'repo');
    const desk = path.join(root, 'desk');
    const manifests = path.join(root, 'manifests');
    for (const d of [repo, desk, manifests]) fs.mkdirSync(d, { recursive: true });
    const branch = 'feature/blocked-desk';
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
    git(repo, 'init', '-q', '-b', 'main');
    git(desk, 'init', '-q', '-b', 'main');
    git(desk, 'config', 'user.email', 't@example.com');
    git(desk, 'config', 'user.name', 'T');
    fs.mkdirSync(path.join(desk, '.plot/briefs'), { recursive: true });
    fs.writeFileSync(path.join(desk, '.plot/briefs/blocked-desk.md'), '# Brief\n');
    git(desk, 'add', '-A');
    git(desk, 'commit', '-qm', 'trunk');
    git(desk, 'checkout', '-qb', branch);
    fs.writeFileSync(path.join(desk, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which adapter?');
    fs.writeFileSync(path.join(desk, '.plot-worker.pid'), '424242');
    fs.writeFileSync(path.join(manifests, 'sess.json'), JSON.stringify({ session: 'sess', branch, worktree: desk, pid: '424242' }));
    fs.mkdirSync(path.join(repo, '.plot'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `## Plot Config\n\n- **Worker command:** true\n- **Agent registry:** ${manifests}\n`);
    const reading = FleetReadingSchema.parse({
      main: 'main',
      head: 'abc',
      fetch_failed: false,
      summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
      plans: [{ file: 'docs/plans/p.md', phase: 'Approved', slices: [{ name: 'S', verdict: 'eligible', branches: [{ branch, local_worktree: desk, worker: 'waiting', worker_pid: '424242', state: 'wip', deferred: false, claimed: '' }] }] }],
    });
    const wrote = await fleetStateFile({ repoRoot: repo }).write({
      at: Date.now(),
      pulse: reading,
      ages: new Map(),
      branchUrlBase: '',
      approvedAt: new Map(),
      ideaPlans: new Map(),
    });
    expect(wrote.ok).toBe(true);
    const out: string[] = [];
    const warned: string[] = [];
    // No `pulse` dep: the default bridged-pulse reader is under test.
    const code = await run([branch, 'use the shell adapter'], repo, path.resolve(__dirname, '../../../../skills/plot/scripts'), {
      monitors: { start: () => ({ ok: true, value: { agentMonitorPid: '' } }), stop: () => ({ ok: true }) } as never,
    }, (s) => out.push(s), (s) => warned.push(s));
    expect(warned.join('')).toBe('');
    expect(code).toBe(0);
    const pid = /pid (\d+)/.exec(out.join(''))?.[1];
    expect(pid).toBeDefined();
    expect(pid).not.toBe('424242');
  });
});
