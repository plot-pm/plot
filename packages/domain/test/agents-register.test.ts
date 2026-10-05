import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { agentsFs } from '../src/adapters/agents/agents-fs.js';
import { agentsFixture } from '../src/adapters/agents/agents-fixture.js';

const made: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-agents-register-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  while (made.length > 0) rmSync(made.pop() as string, { recursive: true, force: true });
});

const AGENT = { session: 'abc-123', branch: 'feature/x', worktree: '/estate/.worktrees/x', command: 'loop.sh' };
const NOW = new Date('2026-10-05T12:00:00.123Z');

describe('agentsFs register and deregister', () => {
  it('writes <session>.json with the dispatcher fields, creating the directory', async () => {
    const dir = join(scratch(), 'agents');
    const agents = agentsFs({ repoRoot: dir, scriptDir: '/nonexistent' }, { manifestDir: dir, now: () => NOW });
    const written = await agents.register(AGENT);
    expect(written).toEqual({ ok: true, value: join(dir, 'abc-123.json') });
    expect(JSON.parse(readFileSync(join(dir, 'abc-123.json'), 'utf8'))).toEqual({
      session: 'abc-123',
      resumeId: 'abc-123',
      branch: 'feature/x',
      worktree: '/estate/.worktrees/x',
      command: 'loop.sh',
      pid: '',
      attempts: 0,
      startedAt: '2026-10-05T12:00:00Z',
    });
    expect(existsSync(join(dir, 'abc-123.json.plot-tmp'))).toBe(false);
  });

  it('stamps startedAt from the current time where no clock is given', async () => {
    const dir = scratch();
    const agents = agentsFs({ repoRoot: dir, scriptDir: '/nonexistent' }, { manifestDir: dir });
    await agents.register(AGENT);
    expect(JSON.parse(readFileSync(join(dir, 'abc-123.json'), 'utf8')).startedAt).toMatch(/Z$/);
  });

  it('the manifest it writes is one the registry reads back', async () => {
    const dir = scratch();
    const agents = agentsFs({ repoRoot: dir, scriptDir: '/nonexistent' }, { manifestDir: dir, now: () => NOW });
    await agents.register(AGENT);
    const declared = await agents.declaration('abc-123');
    expect(declared.ok && declared.value).toMatchObject({ session: 'abc-123', branch: 'feature/x', pid: '' });
  });

  it('answers failed, and leaves no temp file, where the manifest cannot be written', async () => {
    const dir = scratch();
    // A DIRECTORY AT THE MANIFEST'S PATH: the rename onto it fails.
    mkdirSync(join(dir, 'abc-123.json'));
    const agents = agentsFs({ repoRoot: dir, scriptDir: '/nonexistent' }, { manifestDir: dir });
    expect((await agents.register(AGENT)).ok).toBe(false);
    expect(existsSync(join(dir, 'abc-123.json.plot-tmp'))).toBe(false);
  });

  it('answers failed where the directory cannot be created', async () => {
    const dir = scratch();
    writeFileSync(join(dir, 'blocker'), 'x');
    const agents = agentsFs({ repoRoot: dir, scriptDir: '/nonexistent' }, { manifestDir: join(dir, 'blocker', 'agents') });
    expect((await agents.register(AGENT)).ok).toBe(false);
  });

  it('deregister removes the manifest and treats an absent one as done', async () => {
    const dir = scratch();
    const agents = agentsFs({ repoRoot: dir, scriptDir: '/nonexistent' }, { manifestDir: dir });
    await agents.register(AGENT);
    expect((await agents.deregister('abc-123')).ok).toBe(true);
    expect(existsSync(join(dir, 'abc-123.json'))).toBe(false);
    expect((await agents.deregister('abc-123')).ok).toBe(true);
  });

  it('deregister answers failed where the removal itself fails', async () => {
    const dir = scratch();
    // A non-empty DIRECTORY at the path: rmSync without `recursive` throws.
    mkdirSync(join(dir, 'abc-123.json'));
    writeFileSync(join(dir, 'abc-123.json', 'x'), 'x');
    const agents = agentsFs({ repoRoot: dir, scriptDir: '/nonexistent' }, { manifestDir: dir });
    expect((await agents.deregister('abc-123')).ok).toBe(false);
  });
});

describe('agentsFixture register and deregister', () => {
  it('records the calls', async () => {
    const calls = { attempts: [], corrections: [], clearedAssignments: [], registered: [], deregistered: [] };
    const agents = agentsFixture({ calls });
    await agents.register(AGENT);
    await agents.deregister('abc-123');
    expect(calls.registered).toEqual([AGENT]);
    expect(calls.deregistered).toEqual(['abc-123']);
  });

  it('answers failed where told to, recording nothing', async () => {
    const calls = { attempts: [], corrections: [], clearedAssignments: [], registered: [], deregistered: [] };
    const agents = agentsFixture({ calls, registerFails: true });
    expect((await agents.register(AGENT)).ok).toBe(false);
    expect(calls.registered).toEqual([]);
  });
});
