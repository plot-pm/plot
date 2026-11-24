import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decodeReleaseFinishRecord,
  encodeReleaseFinishRecord,
  lastFinishOf,
  RELEASE_FINISH_RECORD_VERSION,
  validVersion,
  type ReleaseFinishRecord,
} from '../src/entities/release-finish-record.js';
import {
  releaseFinishRecordFile,
  releaseFinishRecordPath,
} from '../src/adapters/release-finish-record/release-finish-record-file.js';
import type { StateHome } from '../src/entities/state-home.js';

const record = (over: Partial<ReleaseFinishRecord> = {}): ReleaseFinishRecord => ({
  v: RELEASE_FINISH_RECORD_VERSION,
  version: 'v2.36.0',
  at: '2026-11-24T10:00:00.000Z',
  caller: 'person',
  outcome: 'booked',
  reason: '',
  booked: ['alpha', 'beta'],
  notes: ['a note'],
  sprintClosed: '2026-W47-s',
  ...over,
});

describe('the release-finish record', () => {
  it('round-trips through encode and decode', () => {
    const original = record();
    expect(decodeReleaseFinishRecord(encodeReleaseFinishRecord(original))).toEqual(original);
    const refused = record({ outcome: 'refused', reason: 'tag-absent', booked: [], notes: [], sprintClosed: null });
    expect(decodeReleaseFinishRecord(encodeReleaseFinishRecord(refused))).toEqual(refused);
  });

  it('reads another v as null', () => {
    expect(decodeReleaseFinishRecord(JSON.stringify({ ...record(), v: 2 }))).toBeNull();
  });

  it('reads unparseable or empty text as null', () => {
    expect(decodeReleaseFinishRecord('{not json')).toBeNull();
    expect(decodeReleaseFinishRecord('')).toBeNull();
  });

  it('accepts only the vN.N.N tag spelling as a version', () => {
    expect(validVersion('v2.36.0')).toBe(true);
    expect(validVersion('../x')).toBe(false);
    expect(validVersion('2.36.0')).toBe(false);
    expect(validVersion('')).toBe(false);
    expect(validVersion('v2.36.0/../x')).toBe(false);
  });

  it('gives the row the time, outcome and reason, and null for no record', () => {
    expect(lastFinishOf(record({ outcome: 'refused', reason: 'tag-absent' }))).toEqual({
      at: '2026-11-24T10:00:00.000Z',
      outcome: 'refused',
      reason: 'tag-absent',
    });
    expect(lastFinishOf(null)).toBeNull();
  });
});

describe('the release-finish record file', () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });
  const home = (): StateHome => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-release-finish-record-'));
    homes.push(dir);
    return dir as StateHome;
  };

  it('answers null where no file exists', async () => {
    expect(await releaseFinishRecordFile(home()).read('v2.36.0')).toEqual({ ok: true, value: null });
  });

  it('reads back what it wrote, at .plot/state/release-finish/<version>.json', async () => {
    const h = home();
    const store = releaseFinishRecordFile(h);
    expect((await store.write(record())).ok).toBe(true);
    expect(await store.read('v2.36.0')).toEqual({ ok: true, value: record() });
    expect(releaseFinishRecordPath(h, 'v2.36.0')).toBe(join(h, '.plot', 'state', 'release-finish', 'v2.36.0.json'));
  });

  it('replaces an earlier record of the same version whole', async () => {
    const store = releaseFinishRecordFile(home());
    await store.write(record({ outcome: 'refused', reason: 'tag-absent', booked: [] }));
    await store.write(record({ outcome: 'already-released' }));
    const read = await store.read('v2.36.0');
    expect(read.ok && read.value?.outcome).toBe('already-released');
  });

  it('does not read a leftover temp file as a record', async () => {
    const h = home();
    const path = releaseFinishRecordPath(h, 'v2.36.0');
    mkdirSync(join(h, '.plot', 'state', 'release-finish'), { recursive: true });
    writeFileSync(`${path}.12345.tmp`, encodeReleaseFinishRecord(record()));
    expect(await releaseFinishRecordFile(h).read('v2.36.0')).toEqual({ ok: true, value: null });
  });

  it('refuses a write and answers null for a version that is not vN.N.N', async () => {
    const store = releaseFinishRecordFile(home());
    expect((await store.write(record({ version: '../x' }))).ok).toBe(false);
    expect(await store.read('../x')).toEqual({ ok: true, value: null });
  });

  it('reads a file whose version is not the one asked as no record', async () => {
    const h = home();
    mkdirSync(join(h, '.plot', 'state', 'release-finish'), { recursive: true });
    writeFileSync(releaseFinishRecordPath(h, 'v1.0.0'), encodeReleaseFinishRecord(record()));
    expect(await releaseFinishRecordFile(h).read('v1.0.0')).toEqual({ ok: true, value: null });
  });
});
