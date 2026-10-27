import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FleetReadingSchema } from '@plot-pm/domain/entities/fleet';
import { fleetStateFile } from '@plot-pm/domain/adapters/fleet-state/fleet-state-file';
import { ENDING_FILENAME, readEnding } from '@plot-pm/domain/entities/ending';
import { killedWorkerEnding } from '@plot-pm/domain/rules/ending-action';
import type { FleetReading } from '@plot-pm/domain';
import { run } from '../../src/server/entry/restart-command.js';
import { restartBranch, type RestartReaders } from '../../src/shared/restart-command.js';
import { continueOnDesk } from '../../src/shared/continuation.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// The restart controller with no board: its refusals come from the pulse alone,
// and its start replaces a dead worker under the desk's continue lock.

const scriptDir = path.resolve(__dirname, '../../../../skills/plot/scripts');
const monitors = { start: () => ({ ok: true, value: { agentMonitorPid: '' } }), stop: () => ({ ok: true }) } as never;
const deadWorker: RestartReaders = {
  pr: async () => ({ reachedReview: false, number: 0, state: '' }),
  worker: async () => ({ state: 'failed', pid: '', exitCode: '143', activity: 'idle' }),
};

const pulseOf = (branch: string, worktree: string): FleetReading =>
  FleetReadingSchema.parse({
    main: 'main',
    head: 'abc',
    fetch_failed: false,
    summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
    plans: [{ file: 'docs/plans/p.md', phase: 'Approved', slices: [{ name: 'S', verdict: 'eligible', branches: [{ branch, local_worktree: worktree, worker: 'failed', worker_pid: '', state: 'wip', deferred: false, claimed: '' }] }] }],
  });

describe('the restart entry', () => {
  it('exits 2 for no branch, an empty branch and an extra argument', async () => {
    const warned: string[] = [];
    const warn = (s: string) => warned.push(s);
    expect(await run([], '/nonexistent', '/nonexistent', {}, () => {}, warn)).toBe(2);
    expect(await run([''], '/nonexistent', '/nonexistent', {}, () => {}, warn)).toBe(2);
    expect(await run(['feature/x', 'extra'], '/nonexistent', '/nonexistent', {}, () => {}, warn)).toBe(2);
    expect(warned.join('')).toContain('usage: plot-restart-command.mjs <branch>');
  });
});

describe('restartBranch', () => {
  const opts = { repoRoot: '/nonexistent', scriptsDir: '/nonexistent' };

  it('refuses unknown-branch with 404 where the pulse does not list the branch and git names no desk', async () => {
    const r = await restartBranch({ opts, pulse: pulseOf('feature/other', '/w/other'), branch: 'feature/nope', unattended: false });
    expect(r).toMatchObject({ kind: 'refused', status: 404, reason: 'unknown-branch' });
  });

  it('refuses unknown-branch where there is no pulse at all', async () => {
    const r = await restartBranch({ opts, pulse: null, branch: 'feature/nope', unattended: false });
    expect(r).toMatchObject({ kind: 'refused', status: 404, reason: 'unknown-branch' });
  });

  it('refuses no-worktree with 404 where the pulse lists the branch with no desk', async () => {
    const r = await restartBranch({ opts, pulse: pulseOf('feature/no-desk', ''), branch: 'feature/no-desk', unattended: false });
    expect(r).toMatchObject({ kind: 'refused', status: 404, reason: 'no-worktree' });
  });
});

describe('the restart on a desk', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmTree(d);
  });

  const branch = 'feature/dead-desk';
  const fixture = (workerCommand: string) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-restart-desk-')));
    dirs.push(root);
    const repo = path.join(root, 'repo');
    const desk = path.join(root, 'desk');
    const manifests = path.join(root, 'manifests');
    for (const d of [repo, desk, manifests]) fs.mkdirSync(d, { recursive: true });
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
    git(repo, 'init', '-q', '-b', 'main');
    git(desk, 'init', '-q', '-b', 'main');
    git(desk, 'config', 'user.email', 't@example.com');
    git(desk, 'config', 'user.name', 'T');
    fs.mkdirSync(path.join(desk, '.plot/briefs'), { recursive: true });
    fs.writeFileSync(path.join(desk, '.plot/briefs/dead-desk.md'), '# Brief\n');
    git(desk, 'add', '-A');
    git(desk, 'commit', '-qm', 'trunk');
    git(desk, 'checkout', '-qb', branch);
    fs.writeFileSync(path.join(desk, '.plot-worker.exit'), '143');
    fs.writeFileSync(
      path.join(desk, ENDING_FILENAME),
      JSON.stringify({ reason: 'stopped', actor: 'person', branch, detail: '', refusedAssignment: '', resumeId: '' }),
    );
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `## Plot Config\n\n- **Worker command:** ${workerCommand}\n- **Agent registry:** ${manifests}\n`);
    return { repo, desk };
  };

  const waitFor = async (file: string): Promise<string> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`${file} never appeared`);
  };

  it('starts a new pid on a stopped desk whose worker exited 143', async () => {
    const { repo, desk } = fixture('true');
    const out: string[] = [];
    const warned: string[] = [];
    const code = await run([branch], repo, scriptDir, {
      pulse: () => pulseOf(branch, desk),
      readers: deadWorker,
      monitors,
      unattended: false,
    }, (s) => out.push(s), (s) => warned.push(s));
    expect(warned.join('')).toBe('');
    expect(code).toBe(0);
    const pid = /pid (\d+)/.exec(out.join(''))?.[1];
    expect(pid).toBeDefined();
    expect(fs.readFileSync(path.join(desk, '.plot-worker.pid'), 'utf8').trim()).toBe(pid);
  });

  it('refuses an unattended caller by name and starts nothing', async () => {
    const { repo, desk } = fixture('true');
    const warned: string[] = [];
    const code = await run([branch], repo, scriptDir, {
      pulse: () => pulseOf(branch, desk),
      readers: deadWorker,
      monitors,
      unattended: true,
    }, () => {}, (s) => warned.push(s));
    expect(code).toBe(1);
    expect(warned.join('')).toContain('plot-restart-command: unattended:');
    expect(fs.existsSync(path.join(desk, '.plot-worker.pid'))).toBe(false);
  });

  it('removes the stopped ending, so a restarted worker killed without one reads as killed', async () => {
    const { repo, desk } = fixture('exit 143');
    const started = await restartBranch({
      opts: { repoRoot: repo, scriptsDir: scriptDir },
      pulse: pulseOf(branch, desk),
      branch,
      unattended: false,
      readers: deadWorker,
      monitors,
    });
    expect(started.kind).toBe('started');
    expect(fs.existsSync(path.join(desk, ENDING_FILENAME))).toBe(false);
    // The previous exit record is replaced by the new worker's own: wait for it.
    const exit = await waitFor(path.join(desk, '.plot-worker.exit'));
    expect(exit.trim()).toBe('143');
    const ending = killedWorkerEnding({
      ending: readEnding(null),
      exit,
      loopAlive: false,
      branch,
    });
    expect(ending).toMatchObject({ reason: 'unreadable', actor: 'supervisor', branch });
  });

  it('serialises with a continue on one desk: both at once start one new pid', async () => {
    const { repo, desk } = fixture('sleep 5');
    fs.writeFileSync(path.join(desk, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: which adapter?');
    let open: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      open = resolve;
    });
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const opts = { repoRoot: repo, scriptsDir: scriptDir };
    const common = { opts, branch, worktree: desk, main: 'main', previousPid: '', monitors };
    // The restart takes the lock first and holds it; its precondition is the
    // rule's decision, given directly so the marker the continue needs is allowed.
    const restart = continueOnDesk({
      ...common,
      answer: 'restart',
      restart: async () => ({ ok: true }),
      onLocked: async () => {
        locked();
        await held;
      },
    });
    await isLocked;
    const cont = await continueOnDesk({ ...common, answer: 'use the shell adapter' });
    expect(cont).toMatchObject({ kind: 'refused', reason: 'loop-alive' });
    open();
    const started = await restart;
    expect(started.kind).toBe('started');
    const pids = fs.readdirSync(desk).filter((f) => f === '.plot-worker.pid');
    expect(pids).toHaveLength(1);
    const pid = fs.readFileSync(path.join(desk, '.plot-worker.pid'), 'utf8').trim();
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      /* the sleep may already be gone */
    }
  });
});
