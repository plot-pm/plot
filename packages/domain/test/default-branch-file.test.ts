import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultBranchFile, defaultBranchPath } from '../src/adapters/default-branch/default-branch-file.js';
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
