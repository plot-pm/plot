import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { reapRecordFile } from '../src/adapters/reap-record/reap-record-file.js';
import type { ReapRecordSnapshot } from '../src/ports/reap-record.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-reap-record-'));
  made.push(dir);
  return dir;
};

const snapshot = (overrides: Partial<ReapRecordSnapshot> = {}): ReapRecordSnapshot => ({
  repoIdentity: '/repo/.git',
  defaultBranch: 'main',
  defaultBranchSha: 'abc1234',
  at: '2026-10-28T12:00:00.000Z',
  rows: [{ kind: 'branch', identity: 'bug/one', tipSha: 'def5678', reason: 'pr merged' }],
  ...overrides,
});

describe('reapRecordFile', () => {
  it('answers null when no record has been written', async () => {
    const record = reapRecordFile({ home: home() });
    expect(await record.read()).toEqual({ ok: true, value: null });
  });

  it('reads back exactly what it wrote', async () => {
    const record = reapRecordFile({ home: home() });
    const snap = snapshot();
    expect(await record.write(snap)).toEqual({ ok: true, value: undefined });
    expect(await record.read()).toEqual({ ok: true, value: snap });
  });

  it('overwrites rather than appends on a second write', async () => {
    const record = reapRecordFile({ home: home() });
    await record.write(snapshot({ rows: [] }));
    const second = snapshot({ at: '2026-10-28T13:00:00.000Z' });
    await record.write(second);
    expect(await record.read()).toEqual({ ok: true, value: second });
  });

  it('fails to read a record that is not valid JSON', async () => {
    const dir = home();
    const record = reapRecordFile({ home: dir });
    await record.write(snapshot());
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'reap-dry-run.json'), 'not json');
    expect(await record.read()).toEqual({ ok: false, why: 'failed' });
  });

  it('fails to read a record missing required fields', async () => {
    const dir = home();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'reap-dry-run.json'), JSON.stringify({ repoIdentity: '/repo' }));
    const record = reapRecordFile({ home: dir });
    expect(await record.read()).toEqual({ ok: false, why: 'failed' });
  });
});
