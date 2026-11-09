import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bridgePath, fleetStateFile } from '../src/adapters/fleet-state/fleet-state-file.js';
import { mainRootOf } from '../src/adapters/main-checkout.js';
import type { BridgedPulse } from '../src/ports/fleet-state.js';

let sandbox = '';
let main = '';
let linked = '';
let plain = '';

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
};

const pulse = (at: number): BridgedPulse => ({
  at,
  pulse: {
    main: 'main',
    head: 'abc1234',
    plans: [],
    summary: { plans: 0, waves: 0, branches: 0, claimed: 0, eligible: 0, blocked: 0, deferred: 0, waiting: 0, prereq_missing: 0, host: 'unknown' as const },
  },
  ages: new Map(),
  branchUrlBase: '',
  approvedAt: new Map(),
  ideaPlans: new Map(),
  prError: null,
});

beforeAll(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'plot-bridge-main-')));
  main = join(sandbox, 'main');
  linked = join(sandbox, 'linked');
  plain = join(sandbox, 'plain');
  mkdirSync(main);
  mkdirSync(plain);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'side', linked);
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the fleet bridge at the main checkout', () => {
  it('resolves a linked worktree to the main checkout and a main checkout to itself', () => {
    expect(mainRootOf(linked)).toBe(main);
    expect(mainRootOf(main)).toBe(main);
    expect(bridgePath(linked)).toBe(join(main, '.plot', 'state', 'last-pulse.json'));
  });

  it('keeps a directory that is not a repository as its own root', () => {
    expect(mainRootOf(plain)).toBe(plain);
    expect(bridgePath(plain)).toBe(join(plain, '.plot', 'state', 'last-pulse.json'));
  });

  it('reads from a linked worktree the bridge written from the main checkout', async () => {
    const at = Date.now();
    await fleetStateFile({ repoRoot: main }).write(pulse(at));
    const read = await fleetStateFile({ repoRoot: linked }).read();
    expect(read.ok && read.value?.at).toBe(at);
  });

  it('reads from the main checkout the bridge written from a linked worktree', async () => {
    const at = Date.now() - 1_000;
    await fleetStateFile({ repoRoot: linked }).write(pulse(at));
    const read = await fleetStateFile({ repoRoot: main }).readSync();
    expect(read.ok && read.value?.at).toBe(at);
  });
});
