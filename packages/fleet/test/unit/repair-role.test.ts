import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentRun, AgentRunRequest } from '@plot-pm/domain/ports/agent-run';
import type { PortResult } from '@plot-pm/domain';

import { repairRoleOf, type RepairRoleDeps } from '../../src/shared/repair-role.js';

const answered = <T>(value: T): PortResult<T> => ({ ok: true, value });
const failed = <T>(): PortResult<T> => ({ ok: false, why: 'failed' });

const DEFINITION = '---\ndescription: Repairs a red default branch.\nmodel: opus\n---\nYou repair a red default branch.\n';
const BRANCH = 'bug/main-repair-abcdef123456';

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

const rig = (over: { trees?: string[]; fetch?: boolean; files?: boolean } = {}) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'repair-role-'));
  roots.push(repoRoot);
  const calls: string[] = [];
  const requests: AgentRunRequest[] = [];
  const fragments: string[] = [];
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
    agentRunFor: (fragment): AgentRun => {
      fragments.push(fragment);
      return {
        run: async (request) => {
          calls.push('run');
          requests.push(request);
          request.onStarted?.(4242);
          return failed();
        },
      };
    },
    deskPath: (branch) => `/desk/${branch}`,
    boundSeconds: 3600,
    pidAlive: (pid) => pid === 4242,
    now: () => 1000,
    warn: () => undefined,
  };
  return { deps, calls, requests, fragments, repoRoot };
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
      env: { PLOT_UNATTENDED: '1', PLOT_ROLE_GATE: '/plugin/scripts/board/plot-gate.mjs' },
    });
    expect(r.fragments[0]).toContain('--agent main-repair');
    const agents = JSON.parse(readFileSync(r.requests[0]!.roleAgent!.agentsFile, 'utf8'));
    expect(agents['main-repair'].prompt).toBe('You repair a red default branch.');
    expect(world.roleAlive(BRANCH)).toBe(true);
    expect(world.roleAlive('bug/other')).toBe(false);
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

  it('reads no run as not alive', () => {
    expect(repairRoleOf(rig().deps).roleAlive(BRANCH)).toBe(false);
  });
});
