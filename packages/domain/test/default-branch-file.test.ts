import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { baseBranchFile, baseBranchPath, defaultBranchFile, defaultBranchPath } from '../src/adapters/default-branch/default-branch-file.js';
import { DEFAULT_BRANCH_VERSION, type DefaultBranchReading } from '../src/entities/default-branch.js';

const reading: DefaultBranchReading = {
  v: DEFAULT_BRANCH_VERSION,
  branch: 'main',
  headSha: 'a1',
  head: 'pending',
  settled: { sha: '9f', state: 'red' },
  failingRuns: [{ workflow: 'ci', conclusion: 'failure', url: 'https://x/1' }],
  headSince: '2026-10-10T10:00:00.000Z',
  askedAt: '2026-10-10T10:00:00.000Z',
  at: '2026-10-10T10:00:00.000Z',
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'default-branch-file-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('defaultBranchFile', () => {
  it('reads a missing file as no reading', async () => {
    expect(await defaultBranchFile(root).read()).toEqual({ ok: true, value: null });
  });

  it('round-trips a reading under .plot/state/default-branch.json', async () => {
    const store = defaultBranchFile(root);
    expect((await store.write(reading)).ok).toBe(true);
    expect(defaultBranchPath(root)).toBe(join(root, '.plot', 'state', 'default-branch.json'));
    expect(await store.read()).toEqual({ ok: true, value: reading });
  });

  it('reads a file with another v as no reading', async () => {
    mkdirSync(dirname(defaultBranchPath(root)), { recursive: true });
    writeFileSync(defaultBranchPath(root), JSON.stringify({ ...reading, v: 2 }));
    expect(await defaultBranchFile(root).read()).toEqual({ ok: true, value: null });
  });

  it('reads an unparseable file as no reading', async () => {
    mkdirSync(dirname(defaultBranchPath(root)), { recursive: true });
    writeFileSync(defaultBranchPath(root), '{ not json');
    expect(await defaultBranchFile(root).read()).toEqual({ ok: true, value: null });
  });

  it('leaves no temporary file after a write', async () => {
    await defaultBranchFile(root).write(reading);
    expect(readdirSync(dirname(defaultBranchPath(root)))).toEqual(['default-branch.json']);
    expect(existsSync(defaultBranchPath(root))).toBe(true);
  });
});

describe('baseBranchFile', () => {
  const sprint: DefaultBranchReading = { ...reading, branch: 'sprint/x' };

  it('reads a missing file as no reading and round-trips under .plot/state/base-branches', async () => {
    const store = baseBranchFile(root, 'sprint/x');
    expect(await store.read()).toEqual({ ok: true, value: null });
    expect((await store.write(sprint)).ok).toBe(true);
    expect(baseBranchPath(root, 'sprint/x')).toBe(join(root, '.plot', 'state', 'base-branches', 'sprint', 'x.json'));
    expect(await store.read()).toEqual({ ok: true, value: sprint });
  });

  it('reads a file whose branch is not the base as no reading', async () => {
    const store = baseBranchFile(root, 'sprint/x');
    mkdirSync(dirname(baseBranchPath(root, 'sprint/x')), { recursive: true });
    writeFileSync(baseBranchPath(root, 'sprint/x'), JSON.stringify({ ...sprint, branch: 'sprint/y' }));
    expect(await store.read()).toEqual({ ok: true, value: null });
  });

  it('reads an empty or .. base as no reading and refuses a write', async () => {
    for (const base of ['', '..', '../x', 'sprint/../x', 'a//b']) {
      const store = baseBranchFile(root, base);
      expect(await store.read()).toEqual({ ok: true, value: null });
      expect((await store.write({ ...reading, branch: base })).ok).toBe(false);
    }
    expect(existsSync(join(root, '.plot'))).toBe(false);
  });

  it('answers failed where the read fails other than by a missing file', async () => {
    mkdirSync(baseBranchPath(root, 'sprint/x'), { recursive: true });
    expect((await baseBranchFile(root, 'sprint/x').read()).ok).toBe(false);
  });
});
