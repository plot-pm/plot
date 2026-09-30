import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { tempSweepDue, TEMP_SWEEP_EVERY_MS } from '../src/rules/temp-sweep.js';
import { tempSweepShell, TEMP_SWEEP_MARKER } from '../src/adapters/temp-sweep/temp-sweep-shell.js';

describe('tempSweepDue', () => {
  it('is due when no sweep has run', () => {
    expect(tempSweepDue(null, 0)).toBe(true);
  });

  it('is due an hour after the last sweep and not before', () => {
    expect(tempSweepDue(1000, 1000 + TEMP_SWEEP_EVERY_MS - 1)).toBe(false);
    expect(tempSweepDue(1000, 1000 + TEMP_SWEEP_EVERY_MS)).toBe(true);
  });
});

describe('tempSweepShell', () => {
  const fixture = (reapBody: string) => {
    const box = mkdtempSync(join(tmpdir(), 'plot-tempsweep-'));
    const scripts = join(box, 'scripts');
    mkdirSync(scripts);
    writeFileSync(join(scripts, 'plot-reap.sh'), reapBody);
    chmodSync(join(scripts, 'plot-reap.sh'), 0o755);
    return { box, sweep: tempSweepShell({ repoRoot: box, scriptDir: scripts }) };
  };

  it('reads no last run before the first sweep, and the marker time after it', async () => {
    const f = fixture('echo "args: $*"; echo "temp-summary: swept=0 removed=0"\n');
    expect(await f.sweep.lastAt()).toBeNull();
    const result = await f.sweep.sweep();
    expect(result).toEqual({ ok: true, value: 'temp-summary: swept=0 removed=0' });
    const at = await f.sweep.lastAt();
    expect(at).toBe(statSync(join(f.box, TEMP_SWEEP_MARKER)).mtimeMs);
    rmSync(f.box, { recursive: true, force: true });
  });

  it('passes --sweep-temp --yes, and answers failed on a non-zero exit with the marker still written', async () => {
    const f = fixture('[ "$*" = "--sweep-temp --yes" ] || exit 9; exit 3\n');
    expect((await f.sweep.sweep()).ok).toBe(false);
    expect(await f.sweep.lastAt()).not.toBeNull();
    rmSync(f.box, { recursive: true, force: true });
  });
});
