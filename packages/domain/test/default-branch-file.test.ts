import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { baseBranchFile, baseBranchNames, baseBranchPath, removeBaseBranch, baseRepairPath, removeBaseRepair, validBase, defaultBranchFile, defaultBranchPath } from '../src/adapters/default-branch/default-branch-file.js';
import { baseRepairFile } from '../src/adapters/repair-record/repair-record-file.js';
import { REPAIR_RECORD_VERSION, type RepairRecord } from '../src/entities/repair-record.js';
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

describe('baseBranchNames and removeBaseBranch', () => {
  it('lists the written bases, and removes one file while keeping its directory', async () => {
    const store = baseBranchFile(root, 'sprint/x');
    await store.write({ ...reading, branch: 'sprint/x' });
    await baseBranchFile(root, 'sprint/y').write({ ...reading, branch: 'sprint/y' });
    expect(await baseBranchNames(root)).toEqual({ ok: true, value: expect.arrayContaining(['sprint/x', 'sprint/y']) });
    expect(await removeBaseBranch(root, 'sprint/x')).toEqual({ ok: true, value: undefined });
    expect(existsSync(baseBranchPath(root, 'sprint/x'))).toBe(false);
    expect(existsSync(baseBranchPath(root, 'sprint/y'))).toBe(true);
  });

  it('lists nothing where no directory exists, and refuses a `..` base', async () => {
    expect(await baseBranchNames(root)).toEqual({ ok: true, value: [] });
    expect((await removeBaseBranch(root, 'sprint/../x')).ok).toBe(false);
  });

  it('refuses to write a base with a `..` segment', async () => {
    expect((await baseBranchFile(root, 'sprint/../x').write({ ...reading, branch: 'sprint/../x' })).ok).toBe(false);
  });
});

describe('the base repair record file', () => {
  const rec = (branch: string): RepairRecord => ({
    v: REPAIR_RECORD_VERSION, branch, state: 'idle', lastGreenSha: 'g'.repeat(40), firstRedSha: 'r'.repeat(40),
    redSince: reading.at, candidates: [], rerun: 'none', preRevertRerun: 'none', at: reading.at,
  });

  it('lives beside the reading as <base>.repair.json and is not listed as a base', async () => {
    expect(baseRepairPath(root, 'sprint/x')).toBe(`${baseBranchPath(root, 'sprint/x')}`.replace(/\.json$/, '.repair.json'));
    await baseBranchFile(root, 'sprint/x').write(reading);
    expect((await baseRepairFile(root, 'sprint/x').write(rec('sprint/x'))).ok).toBe(true);
    expect(existsSync(baseRepairPath(root, 'sprint/x'))).toBe(true);
    expect(await baseBranchNames(root)).toEqual({ ok: true, value: ['sprint/x'] });
  });

  it('refuses a base whose last segment ends in .repair', async () => {
    expect(validBase('sprint/x.repair')).toBe(false);
    expect(validBase('sprint/x')).toBe(true);
    expect((await baseRepairFile(root, 'sprint/x.repair').write(rec('sprint/x.repair'))).ok).toBe(false);
  });

  it('reads null for a file whose branch is not the base, and round-trips its own', async () => {
    const store = baseRepairFile(root, 'sprint/x');
    expect(await store.read()).toEqual({ ok: true, value: null });
    await store.write(rec('sprint/y'));
    expect(await store.read()).toEqual({ ok: true, value: null });
    await store.write(rec('sprint/x'));
    expect(await store.read()).toEqual({ ok: true, value: rec('sprint/x') });
  });

  it('removeBaseRepair deletes the record only, and tolerates a missing one', async () => {
    await baseBranchFile(root, 'sprint/x').write(reading);
    await baseRepairFile(root, 'sprint/x').write(rec('sprint/x'));
    expect(await removeBaseRepair(root, 'sprint/x')).toEqual({ ok: true, value: undefined });
    expect(existsSync(baseRepairPath(root, 'sprint/x'))).toBe(false);
    expect(existsSync(baseBranchPath(root, 'sprint/x'))).toBe(true);
    expect(await removeBaseRepair(root, 'sprint/x')).toEqual({ ok: true, value: undefined });
  });
});
