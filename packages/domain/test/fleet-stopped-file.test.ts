import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fleetStoppedFile, fleetStoppedPath } from '../src/adapters/fleet-stopped/fleet-stopped-file.js';
import { FLEET_STOPPED_VERSION, type FleetStopped } from '../src/entities/fleet-stopped.js';

const record: FleetStopped = {
  v: FLEET_STOPPED_VERSION,
  branches: ['feature/a', 'feature/b'],
  at: '2026-10-27T10:00:00.000Z',
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fleet-stopped-file-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('fleetStoppedFile', () => {
  it('reads a missing file as no record', async () => {
    expect(await fleetStoppedFile(root).read()).toEqual({ ok: true, value: null });
  });

  it('round-trips a record under .plot/state/fleet-stopped.json', async () => {
    const store = fleetStoppedFile(root);
    expect((await store.write(record)).ok).toBe(true);
    expect(fleetStoppedPath(root)).toBe(join(root, '.plot', 'state', 'fleet-stopped.json'));
    expect(await store.read()).toEqual({ ok: true, value: record });
  });

  it('reads a file with another v as no record', async () => {
    mkdirSync(dirname(fleetStoppedPath(root)), { recursive: true });
    writeFileSync(fleetStoppedPath(root), JSON.stringify({ ...record, v: 2 }));
    expect(await fleetStoppedFile(root).read()).toEqual({ ok: true, value: null });
  });

  it('reads an unparseable file as no record', async () => {
    mkdirSync(dirname(fleetStoppedPath(root)), { recursive: true });
    writeFileSync(fleetStoppedPath(root), '{ not json');
    expect(await fleetStoppedFile(root).read()).toEqual({ ok: true, value: null });
  });

  it('leaves no temporary file after a write', async () => {
    await fleetStoppedFile(root).write(record);
    expect(readdirSync(dirname(fleetStoppedPath(root)))).toEqual(['fleet-stopped.json']);
    expect(existsSync(fleetStoppedPath(root))).toBe(true);
  });

  it('clear removes the file, and clearing an already-missing file still answers ok', async () => {
    const store = fleetStoppedFile(root);
    await store.write(record);
    expect((await store.clear()).ok).toBe(true);
    expect(existsSync(fleetStoppedPath(root))).toBe(false);
    expect((await store.clear()).ok).toBe(true);
  });
});
