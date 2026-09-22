import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

vi.mock('../../src/server/entry/registryd.js', async (orig) => {
  const actual = await orig<typeof import('../../src/server/entry/registryd.js')>();
  return { ...actual, tick: vi.fn() };
});

import { run } from '../../src/server/entry/registryd-main.js';
import { tick } from '../../src/server/entry/registryd.js';
const mockTick = tick as unknown as ReturnType<typeof vi.fn>;

let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'probe2-'));
  mkdirSync(join(sandbox, '.plot', 'agents'), { recursive: true });
  process.env.PLOT_REPO_ROOT = sandbox;
  mockTick.mockReset();
});

describe('probe2 - harder seams', () => {
  it('Q: is the interval actually waited on a failure (not a spin)?', async () => {
    mockTick.mockRejectedValue(new Error('boom'));
    const waits: number[] = [];
    let ticks = 0;
    await run(['--interval', '7'], join(sandbox, 'scripts', 'board'),
      () => {}, async (ms) => { waits.push(ms); }, () => { ticks += 1; return ticks > 2; }, () => {});
    expect(waits).toEqual([7000, 7000]);
  });

  it('Q: can a test see the stderr/stdout SPLIT?', async () => {
    mockTick.mockRejectedValue(new Error('split-me'));
    const out: string[] = []; const err: string[] = [];
    await run(['--once'], join(sandbox, 'scripts', 'board'),
      (s) => out.push(s), async () => {}, () => false, (s) => err.push(s));
    expect(err.join('')).toContain('split-me');
    expect(out.join('')).not.toContain('split-me');
  });

  it('Q: can a THROW FROM reportTick be pinned through run? (round 1 defect)', async () => {
    // reportTick is called as a module-local binding inside run, NOT imported.
    // Probe whether it is reachable for a stub at all.
    const mod = await import('../../src/server/entry/registryd-main.js');
    let threw = false;
    try {
      // @ts-expect-error probing mutability of the export binding
      mod.reportTick = () => { throw new Error('report boom'); };
    } catch { threw = true; }
    expect(threw).toBe(true); // ESM bindings are read-only -> cannot stub
  });

  it('Q: is the entry .catch reachable at all from a unit test?', () => {
    // The guard requires import.meta.url === file://process.argv[1].
    // A unit test importing the module never satisfies it. Prove by grep.
    const src = execFileSync('grep', ['-c', 'import.meta.url === `file://${process.argv\\[1\\]}`',
      'src/server/entry/registryd-main.ts'], { encoding: 'utf8' });
    expect(Number(src.trim())).toBe(1);
  });
});
