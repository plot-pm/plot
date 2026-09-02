// AN AGENT SAYS WHEN IT IS FREE — the board's half.
//
// `DESIGN-agent.md:483` names the gap the process states leave: *"The process
// states do not say whether an agent is free."* Availability is a SECOND
// question, and the two words a reader reaches for are both wrong on their own.
// **`running` is not busy** — an agent between slices is running with no branch
// and is available. **`finished` is not free** — its worker exited and nothing
// marks the transition back.
//
// THE DERIVATION IS THE DOMAIN'S and is unit-tested there, with no browser and
// no live process (`packages/domain/test/free.test.ts`). What THIS file asserts
// is that the board asks it — from the registry it already reads, off the pulse
// it already publishes — so an agent between units reads free rather than
// `finished` or `unknown`.
//
// NOTHING HERE STARTS A PROCESS OR A SERVER. A manifest is a file and the free
// answer is a function of two fields in it; a test that needed a live worker to
// observe an agent BETWEEN workers would be asserting the wrong thing anyway.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readAgentRegistry, AGENT_MANIFEST_DIR, type AgentEntry } from '../../src/server/registry.js';
import { agentAvailability, agentStateStatus } from '../../src/app/lib/tuple-row.js';
import { freeAgentCount, freeAgentLabels } from '../../src/server/auto-dispatch.js';
import type { FleetReading } from '../../src/contract/schema.js';
import { rmTree } from '../helpers.mjs';

let root = '';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-free-'));
  fs.mkdirSync(path.join(root, AGENT_MANIFEST_DIR), { recursive: true });
});
afterEach(() => rmTree(root));

/**
 * A manifest exactly as `plot-worker-loop.sh` leaves it in the window between
 * finishing a slice and being handed the next: every launch fact intact, and
 * `branch` cleared to `''`.
 */
function manifest(name: string, body: Record<string, unknown>): void {
  fs.writeFileSync(path.join(root, AGENT_MANIFEST_DIR, name), JSON.stringify(body));
}

/** The liveness the pulse would have measured — injected, never spawned. */
const alive = (state: string) => () => [state];

const pulse = (merged: string[]): FleetReading => ({
  plans: [{
    file: 'docs/plans/2026-09-02-p.md', slug: 'p', title: 'P', phase: 'approved',
    slices: [{
      name: 'W', verdict: 'eligible',
      branches: merged.map((branch) => ({ branch, state: 'merged' as const })),
    }],
  }],
} as unknown as FleetReading);

describe('the registry lists an agent that holds no branch', () => {
  it('reads `branch: ""` as a value, not a gap', async () => {
    // The window the worker loop now writes. `''` is a REAL VALUE — the
    // registry has documented it as such since the agent entry existed, and
    // this slice is what makes it reachable.
    manifest('a.json', {
      session: 'sess-a', resumeId: 'sess-a', branch: '', worktree: '/tmp/desk',
      command: 'plot-worker-loop.sh', pid: '4242', startedAt: '2026-09-02T09:00:00Z',
    });
    const entries = await readAgentRegistry(root, undefined, {
      manifestDir: path.join(root, AGENT_MANIFEST_DIR),
      liveness: alive('running'),
      worktrees: () => [],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.branch).toBe('');
    expect(entries[0]!.state).toBe('running');
    // The identity and the desk survive the finish — only `branch` was cleared.
    expect(entries[0]!.session).toBe('sess-a');
    expect(entries[0]!.worktree).toBe('/tmp/desk');
  });

  it('does not lose the agent when its manifest names no branch', async () => {
    // The failure this guards: an entry filtered out for want of a branch is an
    // agent nobody can hand work to, which is the whole state the slice exists
    // to make visible.
    manifest('a.json', { session: 'sess-a', branch: '', worktree: '/tmp/desk', pid: '1' });
    manifest('b.json', { session: 'sess-b', branch: 'feature/x', worktree: '/tmp/b', pid: '2' });
    const entries = await readAgentRegistry(root, undefined, {
      manifestDir: path.join(root, AGENT_MANIFEST_DIR),
      liveness: (wts) => wts.map(() => 'running'),
      worktrees: () => [],
    });
    expect(entries.map((e) => e.session).sort()).toEqual(['sess-a', 'sess-b']);
  });
});

describe('agentAvailability — an agent between units reads free', () => {
  const between = { state: 'running', branch: '' } as Pick<AgentEntry, 'state' | 'branch'>;

  it('reads FREE for a running agent holding no branch', () => {
    // The assertion the brief asks for: between units, not `finished`, not
    // `unknown`.
    expect(agentAvailability(between, false)).toBe('free');
  });

  it('still reads `running` as its state word — both are true at once', () => {
    // Availability does not overwrite the state word. The agent IS running and
    // it IS free; a row that said only one of them would lose a fact.
    expect(agentStateStatus('running')).toBe('running');
    expect(agentAvailability(between, false)).toBe('free');
  });

  it('reads FREE for a running agent whose branch has landed', () => {
    expect(agentAvailability({ state: 'running', branch: 'feature/done' }, true)).toBe('free');
  });

  it('refuses FINISHED, whose worker exited — nothing is there to hand work to', () => {
    expect(agentAvailability({ state: 'finished', branch: '' }, true)).toBe('');
  });

  it('refuses UNKNOWN, which is the board unable to say — never a guess', () => {
    expect(agentAvailability({ state: 'unknown', branch: '' }, true)).toBe('');
  });

  it('refuses WAITING, which is live and blocked on a person', () => {
    // The block is the person, not the branch, so a merged slice does not
    // release it.
    expect(agentAvailability({ state: 'waiting', branch: 'feature/done' }, true)).toBe('');
  });

  it('refuses a running agent still holding an unlanded branch', () => {
    expect(agentAvailability({ state: 'running', branch: 'feature/x' }, false)).toBe('');
  });
});

describe('the registry entry answers the fleet directly', () => {
  it('counts an agent between units as free, read end to end from its manifest', async () => {
    // THE WHOLE PATH: the manifest the worker loop wrote, through the reader the
    // board already runs, into the rule the dispatcher already asks. Nothing was
    // added to the type — the value became reachable.
    manifest('a.json', {
      session: 'sess-a', branch: '', worktree: '/tmp/desk', pid: '4242',
      startedAt: '2026-09-02T09:00:00Z',
    });
    const entries = await readAgentRegistry(root, undefined, {
      manifestDir: path.join(root, AGENT_MANIFEST_DIR),
      liveness: alive('running'),
      worktrees: () => [],
    });
    expect(freeAgentCount(entries, pulse([]))).toBe(1);
    expect(freeAgentLabels(entries, pulse([]))).toEqual(['(between slices)']);
  });

  it('counts nothing free while the same agent still holds an unlanded branch', async () => {
    // The before picture, and the reason the slice exists: the manifest named
    // the slice the agent had just finished, so the fleet read it as busy.
    manifest('a.json', {
      session: 'sess-a', branch: 'feature/x', worktree: '/tmp/desk', pid: '4242',
      startedAt: '2026-09-02T09:00:00Z',
    });
    const entries = await readAgentRegistry(root, undefined, {
      manifestDir: path.join(root, AGENT_MANIFEST_DIR),
      liveness: alive('running'),
      worktrees: () => [],
    });
    expect(freeAgentCount(entries, pulse([]))).toBe(0);
  });
});
