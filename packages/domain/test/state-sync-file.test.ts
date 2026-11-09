import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateSyncFile } from '../src/adapters/state-sync-record/state-sync-file.js';

const homes: string[] = [];
const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'plot-state-sync-file-'));
  homes.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const lock = (dir: string, holder: string, at: number): void => {
  mkdirSync(join(dir, 'plot-push-main.lock'), { recursive: true });
  writeFileSync(join(dir, 'plot-push-main.lock', 'owner'), `${holder}\t${at}\tpush\n`);
};

describe('lockHeld', () => {
  it('reads no lock directory as not held', async () => {
    expect(await stateSyncFile({ home: home() }).lockHeld(1_000)).toBe(false);
  });

  it('reads a live holder younger than the stale bound as held', async () => {
    const dir = home();
    lock(dir, '42', 1_000);
    expect(await stateSyncFile({ home: dir, alive: () => true }).lockHeld(2_000)).toBe(true);
  });

  it('reads a dead holder, and a holder older than the bound, as not held', async () => {
    const dir = home();
    lock(dir, '42', 1_000);
    expect(await stateSyncFile({ home: dir, alive: () => false }).lockHeld(2_000)).toBe(false);
    expect(await stateSyncFile({ home: dir, alive: () => true, staleSeconds: 1 }).lockHeld(5_000)).toBe(false);
  });

  it('takes the pid of a board holder from before the dot', async () => {
    const dir = home();
    lock(dir, '77.3', 1_000);
    const seen: number[] = [];
    await stateSyncFile({ home: dir, alive: (pid) => (seen.push(pid), true) }).lockHeld(2_000);
    expect(seen).toEqual([77]);
  });

  it('reads a lock with an unreadable owner as unknown', async () => {
    const dir = home();
    mkdirSync(join(dir, 'plot-push-main.lock'));
    expect(await stateSyncFile({ home: dir }).lockHeld(1_000)).toBe('unknown');
  });
});

describe('the refusal', () => {
  it('round-trips, replaces and clears', async () => {
    const file = stateSyncFile({ home: home() });
    expect(await file.refusal()).toEqual({ ok: true, value: null });
    await file.refuse({ defaultTip: 'd', stateTip: 's', files: ['docs/plans/x.md'] });
    expect(await file.refusal()).toEqual({ ok: true, value: { defaultTip: 'd', stateTip: 's', files: ['docs/plans/x.md'] } });
    await file.clear();
    expect(await file.refusal()).toEqual({ ok: true, value: null });
    expect((await file.clear()).ok).toBe(true);
  });

  it('reads a malformed file as failed, never as no refusal', async () => {
    const dir = home();
    mkdirSync(join(dir, '.plot', 'state'), { recursive: true });
    writeFileSync(join(dir, '.plot', 'state', 'state-sync-refusal.json'), '{nope');
    expect((await stateSyncFile({ home: dir }).refusal()).ok).toBe(false);
  });
});
