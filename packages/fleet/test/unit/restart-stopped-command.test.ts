import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fleetStoppedFile } from '@plot-pm/domain/adapters/fleet-stopped/fleet-stopped-file';
import { FLEET_STOPPED_VERSION } from '@plot-pm/domain/entities/fleet-stopped';
import { FleetReadingSchema } from '@plot-pm/domain/entities/fleet';
import type { FleetReading } from '@plot-pm/domain';
import { run } from '../../src/server/entry/restart-stopped-command.js';
import type { RestartBranchInput } from '../../src/shared/restart-command.js';
import type { DeskContinuation } from '../../src/shared/continuation.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// `plot-fleetctl.sh --stop` records the branches it stopped, with `--record`;
// `--start` restarts exactly that list through the same restart controller
// wave 1 shipped, then clears the record. These tests exercise `run()`
// directly — the shell wiring is covered by `test/reconcile/fleetctl.test.mjs`.

const pulseOf = (branch: string, worktree: string): FleetReading =>
  FleetReadingSchema.parse({
    main: 'main',
    head: 'abc',
    fetch_failed: false,
    summary: { plans: 1, waves: 1, branches: 1, claimed: 0, eligible: 1, blocked: 0, deferred: 0 },
    plans: [{ file: 'docs/plans/p.md', phase: 'Approved', slices: [{ name: 'S', verdict: 'eligible', branches: [{ branch, local_worktree: worktree, worker: 'failed', worker_pid: '', state: 'wip', deferred: false, claimed: '' }] }] }],
  });

describe('the restart-stopped entry — argument handling', () => {
  it('refuses more than one argument, and any argument other than --record', async () => {
    const warned: string[] = [];
    const warn = (s: string) => warned.push(s);
    expect(await run(['--record', 'extra'], '/nonexistent', '/nonexistent', '', () => {}, warn)).toBe(2);
    expect(await run(['--bogus'], '/nonexistent', '/nonexistent', '', () => {}, warn)).toBe(2);
    expect(warned.join('')).toContain('usage: plot-restart-stopped-command.mjs [--record]');
  });

  it('refuses from outside a git repository', async () => {
    const warned: string[] = [];
    const code = await run([], os.tmpdir(), '/nonexistent', '', () => {}, (s) => warned.push(s));
    expect(code).toBe(1);
    expect(warned.join('')).toContain('not a git repository');
  });
});

describe('the restart-stopped entry — on a repository', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmTree(d);
  });

  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
  const repoFixture = () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-restart-stopped-')));
    dirs.push(root);
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 't@example.com');
    git(root, 'config', 'user.name', 'T');
    fs.writeFileSync(path.join(root, 'f'), '1');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'init');
    return root;
  };

  it('--record replaces the store with exactly the branches given on stdin, skipping blank lines', async () => {
    const repo = repoFixture();
    const code = await run(['--record'], repo, '/nonexistent', 'feature/a\n\nfeature/b\n', () => {}, () => {});
    expect(code).toBe(0);
    const read = await fleetStoppedFile(repo).read();
    expect(read).toMatchObject({ ok: true, value: { v: FLEET_STOPPED_VERSION, branches: ['feature/a', 'feature/b'] } });
  });

  it('--record keeps the desk path given after a tab, keyed by branch', async () => {
    const repo = repoFixture();
    const code = await run(['--record'], repo, '/nonexistent', 'feature/a\t/desks/feature-a\nfeature/b\n', () => {}, () => {});
    expect(code).toBe(0);
    const read = await fleetStoppedFile(repo).read();
    expect(read).toMatchObject({
      ok: true,
      value: { branches: ['feature/a', 'feature/b'], worktrees: { 'feature/a': '/desks/feature-a' } },
    });
  });

  it('--record with no branches on stdin writes an empty list, not no file', async () => {
    const repo = repoFixture();
    const code = await run(['--record'], repo, '/nonexistent', '', () => {}, () => {});
    expect(code).toBe(0);
    const read = await fleetStoppedFile(repo).read();
    expect(read).toMatchObject({ ok: true, value: { branches: [] } });
  });

  it('restarts nothing and exits 0 where no record was ever written', async () => {
    const repo = repoFixture();
    const written: string[] = [];
    const code = await run([], repo, '/nonexistent', '', (s) => written.push(s), () => {});
    expect(code).toBe(0);
    expect(written.join('')).toContain('no stopped branches recorded');
  });

  it('restarts nothing and exits 0 where the record lists no branches, and leaves no record behind', async () => {
    const repo = repoFixture();
    await fleetStoppedFile(repo).write({ v: FLEET_STOPPED_VERSION, branches: [], at: '2026-10-27T00:00:00.000Z' });
    const written: string[] = [];
    const code = await run([], repo, '/nonexistent', '', (s) => written.push(s), () => {});
    expect(code).toBe(0);
    expect(written.join('')).toContain('no stopped branches recorded');
  });

  it('restarts a branch the record names, reports it, and clears the record', async () => {
    const repo = repoFixture();
    const desk = path.join(repo, '..', 'desk');
    fs.mkdirSync(desk, { recursive: true });
    dirs.push(desk);
    await fleetStoppedFile(repo).write({ v: FLEET_STOPPED_VERSION, branches: ['feature/a'], at: '2026-10-27T00:00:00.000Z' });

    const started: DeskContinuation = { kind: 'started', pid: '4242', previousPid: '', prompt: '', log: '' };
    const calls: RestartBranchInput[] = [];
    const written: string[] = [];
    const code = await run(
      [],
      repo,
      '/nonexistent',
      '',
      (s) => written.push(s),
      () => {},
      { pulse: pulseOf('feature/a', desk), unattended: false, restartBranch: async (input) => { calls.push(input); return started; } },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ branch: 'feature/a' });
    expect(written.join('')).toContain('feature/a: restarted pid 4242');
    const read = await fleetStoppedFile(repo).read();
    expect(read).toMatchObject({ ok: true, value: null });
  });

  it('passes a recorded desk path to the controller, so a branch restarts with no fresh pulse', async () => {
    // --stop unloads the supervisor, so the bridged pulse goes stale and reads
    // null. The recorded desk path is then the only way to the worktree.
    const repo = repoFixture();
    await fleetStoppedFile(repo).write({
      v: FLEET_STOPPED_VERSION,
      branches: ['feature/a', 'feature/old'],
      worktrees: { 'feature/a': '/desks/feature-a' },
      at: '2026-10-27T00:00:00.000Z',
    });
    const started: DeskContinuation = { kind: 'started', pid: '4242', previousPid: '', prompt: '', log: '' };
    const calls: RestartBranchInput[] = [];
    const code = await run([], repo, '/nonexistent', '', () => {}, () => {}, {
      pulse: null,
      unattended: false,
      restartBranch: async (input) => { calls.push(input); return started; },
    });
    expect(code).toBe(0);
    expect(calls.map((c) => [c.branch, c.pulse, c.worktree])).toEqual([
      ['feature/a', null, '/desks/feature-a'],
      ['feature/old', null, undefined],
    ]);
  });

  it('surfaces a refusal by name per branch, rather than skipping or silently succeeding, and still clears the record', async () => {
    const repo = repoFixture();
    await fleetStoppedFile(repo).write({
      v: FLEET_STOPPED_VERSION,
      branches: ['feature/live', 'feature/also'],
      at: '2026-10-27T00:00:00.000Z',
    });

    const refusal: DeskContinuation = { kind: 'refused', status: 409, reason: 'loop-alive', detail: 'pid 123 is already running in this worktree' };
    const started: DeskContinuation = { kind: 'started', pid: '555', previousPid: '', prompt: '', log: '' };
    const seen: string[] = [];
    const warned: string[] = [];
    const written: string[] = [];
    const code = await run(
      [],
      repo,
      '/nonexistent',
      '',
      (s) => written.push(s),
      (s) => warned.push(s),
      {
        pulse: null,
        unattended: false,
        restartBranch: async (input) => {
          seen.push(input.branch);
          return input.branch === 'feature/live' ? refusal : started;
        },
      },
    );
    expect(code).toBe(0);
    expect(seen).toEqual(['feature/live', 'feature/also']);
    expect(warned.join('')).toContain('feature/live: refused loop-alive: pid 123 is already running in this worktree');
    expect(written.join('')).toContain('feature/also: restarted pid 555');
    const read = await fleetStoppedFile(repo).read();
    expect(read).toMatchObject({ ok: true, value: null });
  });
});
