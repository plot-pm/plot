// `readPass` — does this entry gather the table's own readings in the table's
// own order, reading only what the place the pass is in calls for?
import { afterEach, describe, it, expect } from 'vitest';
import { rmTree } from '../helpers.mjs';
import {
  agentsFixture,
  buildFixture,
  deskFixture,
  hostFixture,
  processesShell,
  refsFixture,
  treesFixture,
} from '@plot-pm/domain/adapters';
import type { BoundedRun } from '@plot-pm/domain';
import {
  loopWritesOf,
  readManifestFields,
  readPass,
  readResetRefusals,
  registrationOf,
  type PassConfig,
  type PromptState,
  type WorkerLoopPorts,
} from '../../src/server/entry/worker-loop.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const noBoundedRun: BoundedRun = { run: async () => ({ ok: false, why: 'failed' }) };

const CONFIG: PassConfig = {
  boundSeconds: 28_800,
  maxStartRetries: 3,
  checksWaitSeconds: 1_800,
  correctionBudget: 2,
  sliceMaxRuns: 12,
  sliceMaxSpendUsd: null,
  base: 'origin/main',
};

const RUNNING_NONE: PromptState = { running: null, exit: null, pushedSha: '' };

const ports = (over: Partial<WorkerLoopPorts> = {}): WorkerLoopPorts => ({
  trees: treesFixture(),
  agents: agentsFixture(),
  desk: deskFixture(),
  refs: refsFixture(),
  processes: processesShell({ repoRoot: '/tmp', scriptDir: '/tmp' }),
  boundedRun: noBoundedRun,
  build: buildFixture(),
  host: hostFixture(),
  transcriptQuietSeconds: async () => 'unavailable',
  recordSpend: async () => undefined,
  recordRun: async () => null,
  recordLimits: async () => 0,
  sliceCostUsd: async () => null,
  ...over,
});

/** Every directory a test made, removed by its exact name after each test. */
const made: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmTree(dir);
});

const writeManifest = (fields: Record<string, unknown>): string => {
  const dir = tempDir('plot-worker-loop-test-');
  const file = path.join(dir, 'sess.json');
  fs.writeFileSync(file, JSON.stringify(fields, null, 2));
  return file;
};

describe('readManifestFields', () => {
  it('answers every field at its empty value for an empty manifest path', async () => {
    expect(await readManifestFields('')).toEqual({
      session: '',
      worktree: '',
      branch: '',
      attempts: 0,
      correctionAttempts: 0,
      resumeId: '',
      sliceRuns: 0,
    });
  });

  it('answers every field at its empty value for an unreadable file', async () => {
    expect(await readManifestFields('/no/such/file.json')).toEqual({
      session: '',
      worktree: '',
      branch: '',
      attempts: 0,
      correctionAttempts: 0,
      resumeId: '',
      sliceRuns: 0,
    });
  });

  it('reads the fields a manifest carries', async () => {
    const file = writeManifest({
      session: 'sess-1',
      worktree: '/tmp/desk',
      branch: 'infra/x',
      attempts: 2,
      correctionAttempts: 1,
      resumeId: 'resume-1',
    });
    expect(await readManifestFields(file)).toEqual({
      session: 'sess-1',
      worktree: '/tmp/desk',
      branch: 'infra/x',
      attempts: 2,
      correctionAttempts: 1,
      resumeId: 'resume-1',
      sliceRuns: 0,
    });
  });

  it('reads the slice runs recorded for the assigned branch, and none recorded for another', async () => {
    const mine = writeManifest({ branch: 'infra/x', sliceRuns: { branch: 'infra/x', runs: 3 } });
    expect((await readManifestFields(mine)).sliceRuns).toBe(3);
    const other = writeManifest({ branch: 'infra/y', sliceRuns: { branch: 'infra/x', runs: 3 } });
    expect((await readManifestFields(other)).sliceRuns).toBe(0);
  });
});

describe('registrationOf', () => {
  it('answers unset for a hand-started loop (no manifest path)', async () => {
    expect(await registrationOf('')).toBe('unset');
  });

  it('answers gone for a name pointing at nothing', async () => {
    expect(await registrationOf('/no/such/file.json')).toBe('gone');
  });

  it('answers registered for a name that resolves', async () => {
    const file = writeManifest({ session: 'sess-1' });
    expect(await registrationOf(file)).toBe('registered');
  });
});

describe('readResetRefusals', () => {
  it('names a blocked marker', async () => {
    const refusals = await readResetRefusals(
      ports({ trees: treesFixture({ markers: { '/tmp/desk': ['PLOT-BLOCKED.md'] } }) }),
      '/tmp/desk',
    );
    expect(refusals).toEqual(['blocked-marker']);
  });

  it('names uncommitted changes', async () => {
    const refusals = await readResetRefusals(
      ports({ trees: treesFixture({ dirty: { '/tmp/desk': ['a.txt'] } }) }),
      '/tmp/desk',
    );
    expect(refusals).toEqual(['uncommitted-changes']);
  });

  it('answers empty for a clean, unmarked, pushed desk', async () => {
    const refusals = await readResetRefusals(ports(), '/tmp/desk');
    expect(refusals).toEqual([]);
  });
});

describe('readPass — ROWS 1-3, no assignment', () => {
  it('reads the free wait, incrementing across calls through one shared clock', async () => {
    const file = writeManifest({ session: 'sess-1', branch: '' });
    const clock = { since: null as number | null };
    const first = await readPass(ports(), file, RUNNING_NONE, CONFIG, clock);
    expect(first.assignedBranch).toBe('');
    expect(first.waitedSeconds).toBe(0);
    expect(clock.since).not.toBeNull();
  });

  it('answers gone registration for a manifest file that has vanished', async () => {
    const clock = { since: null as number | null };
    const readings = await readPass(ports(), '/no/such/manifest.json', RUNNING_NONE, CONFIG, clock);
    expect(readings.registration).toBe('gone');
  });

  it('clears the wait clock once an assignment is read', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const clock = { since: Date.now() - 5_000 };
    await readPass(ports(), file, RUNNING_NONE, CONFIG, clock);
    expect(clock.since).toBeNull();
  });
});

describe('readPass — the SDK runner readings', () => {
  it('reads no hand-back, no local checks and no recorded run, and carries Slice max runs from the config', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const readings = await readPass(ports(), file, RUNNING_NONE, { ...CONFIG, sliceMaxRuns: 7 }, { since: null });
    expect(readings).toMatchObject({
      handBack: null,
      checksResumeId: '',
      handBackSummary: '',
      localChecks: null,
      sliceRuns: 0,
      sliceMaxRuns: 7,
    });
  });
});

describe('readPass — ROW 4, take-up', () => {
  it('reads reset refusals and the marker text when the desk holds unlanded work', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const clock = { since: null as number | null };
    const readings = await readPass(
      ports({ trees: treesFixture({ markers: { '/tmp/desk': ['PLOT-BLOCKED.md'] } }) }),
      file,
      RUNNING_NONE,
      CONFIG,
      clock,
    );
    expect(readings.resetRefusals).toEqual(['blocked-marker']);
  });

  it('reads no refusals for a clean desk, ready for the claim', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const clock = { since: null as number | null };
    const readings = await readPass(ports(), file, RUNNING_NONE, CONFIG, clock);
    expect(readings.resetRefusals).toEqual([]);
    expect(readings.base).toBe('origin/main');
  });
});

describe('readPass — ROWS 5-6, a prompt is running', () => {
  it('carries the caller-supplied running reading straight through', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const clock = { since: null as number | null };
    const running: PromptState = {
      running: { verdict: 'idle', transcriptReadable: true },
      exit: null,
      pushedSha: '',
    };
    const readings = await readPass(ports(), file, running, CONFIG, clock);
    expect(readings.running).toEqual({ verdict: 'idle', transcriptReadable: true });
  });
});

describe('readPass — ROWS 7-9, an exit that is not ran', () => {
  it('reads nothing further for unstarted', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk', attempts: 1 });
    const clock = { since: null as number | null };
    const prompt: PromptState = { running: null, exit: { answer: 'unstarted' }, pushedSha: '' };
    const readings = await readPass(ports(), file, prompt, CONFIG, clock);
    expect(readings.exit).toEqual({ answer: 'unstarted' });
    expect(readings.startRetries).toBe(1);
  });
});

describe('readPass — ROW 10, the agent wrote its own marker', () => {
  it('reads the marker text off the worktree root', async () => {
    const dir = tempDir('plot-worker-loop-desk-');
    fs.writeFileSync(path.join(dir, 'PLOT-BLOCKED.md'), 'PLOT-BLOCKED: a question\n\nmore text\n');
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: dir });
    const clock = { since: null as number | null };
    const prompt: PromptState = { running: null, exit: { answer: 'ran' }, pushedSha: '' };
    const readings = await readPass(ports(), file, prompt, CONFIG, clock);
    expect(readings.markerWritten).toBe(true);
    expect(readings.markerText).toBe('PLOT-BLOCKED: a question');
  });
});

describe('readPass — ROW 11, unlanded work with no marker', () => {
  it('reads the reset refusals, not sealed', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const clock = { since: null as number | null };
    const prompt: PromptState = { running: null, exit: { answer: 'ran' }, pushedSha: '' };
    const readings = await readPass(
      ports({ trees: treesFixture({ dirty: { '/tmp/desk': ['a.txt'] } }) }),
      file,
      prompt,
      CONFIG,
      clock,
    );
    expect(readings.resetRefusals).toEqual(['uncommitted-changes']);
  });
});

describe('readPass — ROW 12a, nothing pushed or no PR open', () => {
  it('reads pushed false when the remote head is absent', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const clock = { since: null as number | null };
    const prompt: PromptState = { running: null, exit: { answer: 'ran' }, pushedSha: 'abc123' };
    const readings = await readPass(
      ports({ refs: refsFixture({ branches: [], remoteBranches: [] }) }),
      file,
      prompt,
      CONFIG,
      clock,
    );
    expect(readings.pushed).toBe(false);
    expect(readings.checks).toBeNull();
  });

  it('reads prOpen false when the host has no PR for the branch', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const clock = { since: null as number | null };
    const prompt: PromptState = { running: null, exit: { answer: 'ran' }, pushedSha: 'abc123' };
    const readings = await readPass(
      ports({ refs: refsFixture({ remoteBranches: ['infra/x'] }), host: hostFixture({ prs: [] }) }),
      file,
      prompt,
      CONFIG,
      clock,
    );
    expect(readings.pushed).toBe(true);
    expect(readings.prOpen).toBe(false);
    expect(readings.checks).toBeNull();
  });
});

describe('readPass — ROWS 12-18, the CI wait', () => {
  const OPEN_PR = {
    number: 7,
    repo: '',
    head: 'infra/x',
    state: 'OPEN' as const,
    mergedAt: null,
    mergeCommit: '',
    draft: false,
    mergeable: 'unknown' as const,
    review: '' as const,
    checks: 'unknown' as const,
    failingChecks: [],
    url: '',
  };

  const pushedPorts = (over: Partial<WorkerLoopPorts> = {}) =>
    ports({
      refs: refsFixture({ remoteBranches: ['infra/x'], remoteTips: { 'infra/x': 'abc123' } }),
      host: hostFixture({ prs: [OPEN_PR] }),
      ...over,
    });

  it('answers none when Checks wait is disabled', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const clock = { since: null as number | null };
    const prompt: PromptState = { running: null, exit: { answer: 'ran' }, pushedSha: 'abc123' };
    const readings = await readPass(pushedPorts(), file, prompt, { ...CONFIG, checksWaitSeconds: 0 }, clock);
    expect(readings.checks).toBe('none');
  });

  it('answers tip-moved when the remote tip is another commit, naming the branch', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const clock = { since: null as number | null };
    const prompt: PromptState = { running: null, exit: { answer: 'ran' }, pushedSha: 'abc123' };
    const readings = await readPass(
      pushedPorts({ refs: refsFixture({ remoteBranches: ['infra/x'], remoteTips: { 'infra/x': 'def456' } }) }),
      file,
      prompt,
      CONFIG,
      clock,
    );
    expect(readings.tip).toBe('other');
    expect(readings.checks).toBe('tip-moved');
  });

  it('keeps waiting on an unreadable tip', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const clock = { since: null as number | null };
    const prompt: PromptState = { running: null, exit: { answer: 'ran' }, pushedSha: 'abc123' };
    const readings = await readPass(
      pushedPorts({ refs: refsFixture({ remoteBranches: ['infra/x'], remoteTips: {} }) }),
      file,
      prompt,
      CONFIG,
      clock,
    );
    expect(readings.tip).toBe('unknown');
    expect(readings.checks).toBe('wait');
  });

  it('answers settled with the run conclusion once the build connector has one', async () => {
    const file = writeManifest({ session: 'sess-1', branch: 'infra/x', worktree: '/tmp/desk' });
    const clock = { since: null as number | null };
    const prompt: PromptState = { running: null, exit: { answer: 'ran' }, pushedSha: 'abc123' };
    const readings = await readPass(
      pushedPorts({
        build: buildFixture({
          shaRuns: { 'infra/x': [{ sha: 'abc123', status: 'completed', conclusion: 'failure', url: '', startedAt: '' }] },
        }),
      }),
      file,
      prompt,
      CONFIG,
      clock,
    );
    expect(readings.checks).toBe('settled');
    expect(readings.checksPassed).toBe(false);
  });
});

describe('loopWritesOf', () => {
  it('answers the writes unchanged where none is checks', () => {
    const writes = [{ kind: 'assignment-clear', session: 's' }] as const;
    expect(loopWritesOf(writes)).toEqual(writes);
  });

  it('leaves a checks write out where the SDK runner runs the checks', () => {
    expect(
      loopWritesOf(
        [
          { kind: 'checks', branch: 'infra/x', worktree: '/w', resumeId: 'r', summary: 's' },
          { kind: 'assignment-clear', session: 's' },
        ],
        true,
      ),
    ).toEqual([{ kind: 'assignment-clear', session: 's' }]);
  });

  it('refuses a checks write without the SDK runner, naming its branch', () => {
    expect(() =>
      loopWritesOf([{ kind: 'checks', branch: 'infra/x', worktree: '/w', resumeId: 'r', summary: 's' }]),
    ).toThrow('a checks write on infra/x without the SDK runner');
  });
});
