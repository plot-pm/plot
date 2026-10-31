import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentRun, AgentRunRequest } from '@plot-pm/domain/ports/agent-run';
import type { PortResult } from '@plot-pm/domain';

import { repairRoleOf, type RepairRoleDeps } from '../../src/shared/repair-role.js';
import { removeTree } from '../rm-tree.mjs';

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });
const failed = <T>(): PortResult<T> => ({ ok: false, why: 'failed' });

const DEFINITION = '---\ndescription: Repairs a red default branch.\nmodel: opus\n---\nYou repair a red default branch.\n';
const BRANCH = 'bug/main-repair-abcdef123456';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) removeTree(root);
  roots = [];
});

const rig = (over: { trees?: string[]; fetch?: boolean; files?: boolean; alive?: boolean } = {}) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'repair-role-'));
  roots.push(repoRoot);
  const calls: string[] = [];
  const requests: AgentRunRequest[] = [];
  const fragments: string[] = [];
  let finish: () => void = () => undefined;
  const deps: RepairRoleDeps = {
    repoRoot,
    scriptsDir: '/plugin/scripts',
    trees: {
      list: async () => answered((over.trees ?? []).map((branch) => ({ path: `/desk/${branch}`, branch }) as never)),
      fetch: async () => {
        calls.push('fetch');
        return over.fetch === false ? failed() : answered(undefined);
      },
      addBranch: async (_path, _branch, start) => {
        calls.push(`add ${start}`);
        return answered(undefined);
      },
    },
    refs: {
      defaultBranch: async () => answered('main'),
      showFile: async (_ref, path) =>
        over.files === false ? failed() : answered(path.endsWith('.md') ? DEFINITION : '{"hooks":{}}'),
    },
    runnerOf: (fragment): AgentRun => {
      fragments.push(fragment);
      return {
        run: async (request) => {
          calls.push('run');
          requests.push(request);
          request.onStarted?.(4242);
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return failed();
        },
      };
    },
    deskPath: (branch) => `/desk/${branch}`,
    boundSeconds: 3600,
    pidAlive: (pid) => pid === 4242 && over.alive !== false,
    now: () => 1000,
    warn: () => undefined,
  };
  return { deps, calls, requests, fragments, repoRoot, finish: () => finish() };
};

describe('repairRoleOf', () => {
  it('fetches, creates the desk, writes the role files outside it and records the pid', async () => {
    const r = rig();
    const world = repairRoleOf(r.deps);
    expect(await world.startRole(BRANCH)).toBe('started');
    expect(r.calls).toEqual(['fetch', `add origin/${BRANCH}`, 'run']);
    expect(r.requests[0]).toMatchObject({
      worktree: `/desk/${BRANCH}`,
      boundSeconds: 3600,
      role: 'main-repair',
      env: { PLOT_ROLE_GATE: '/plugin/scripts/board/plot-gate.mjs' },
    });
    expect(r.fragments[0]).toContain('--agent main-repair');
    const agents = JSON.parse(readFileSync(r.requests[0]!.roleAgent!.agentsFile, 'utf8'));
    expect(agents['main-repair'].prompt).toBe('You repair a red default branch.');
    expect(world.roleRun(BRANCH, 0)).toBe('alive');
    expect(world.roleRun('bug/other', 0)).toBe('none');
    r.finish();
  });

  it('writes the ending record when the run ends, and reads the run as ended', async () => {
    const r = rig();
    const world = repairRoleOf(r.deps);
    expect(await world.startRole(BRANCH)).toBe('started');
    r.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const recorded = JSON.parse(readFileSync(join(r.repoRoot, '.plot', 'state', 'main-repair', 'run.json'), 'utf8'));
    expect(recorded).toEqual({ branch: BRANCH, pid: 4242, startedAt: 1000, endedAt: 1000 });
    expect(world.roleRun(BRANCH, 0)).toBe('ended');
  });

  it('reads a dead pid with no ending record as crashed', async () => {
    const r = rig({ alive: false });
    const world = repairRoleOf(r.deps);
    expect(await world.startRole(BRANCH)).toBe('started');
    expect(world.roleRun(BRANCH, 0)).toBe('crashed');
    r.finish();
  });

  it('reads a run started before the episode as no run', async () => {
    const r = rig();
    const world = repairRoleOf(r.deps);
    expect(await world.startRole(BRANCH)).toBe('started');
    expect(world.roleRun(BRANCH, 1001)).toBe('none');
    r.finish();
  });

  it('keeps an existing desk and fetches nothing', async () => {
    const r = rig({ trees: [BRANCH] });
    const world = repairRoleOf(r.deps);
    expect(await world.hasDesk(BRANCH)).toBe(true);
    expect(await world.startRole(BRANCH)).toBe('started');
    expect(r.calls).toEqual(['run']);
  });

  it('starts nothing where the branch cannot be fetched', async () => {
    const r = rig({ fetch: false });
    expect(await repairRoleOf(r.deps).startRole(BRANCH)).toBe('failed');
    expect(r.calls).toEqual(['fetch']);
  });

  it('starts nothing where the role files are not on the default branch', async () => {
    const r = rig({ files: false });
    expect(await repairRoleOf(r.deps).startRole(BRANCH)).toBe('failed');
    expect(r.calls).not.toContain('run');
  });

  it('reads no run record as no run', () => {
    const r = rig();
    expect(repairRoleOf(r.deps).roleRun(BRANCH, 0)).toBe('none');
  });
});
