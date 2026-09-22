import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// PROBE: can a unit test make `tick` throw and drive `run`?
vi.mock('../../src/server/entry/registryd.js', async (orig) => {
  const actual = await orig<typeof import('../../src/server/entry/registryd.js')>();
  return { ...actual, tick: vi.fn() };
});

import { run } from '../../src/server/entry/registryd-main.js';
import { tick } from '../../src/server/entry/registryd.js';

const mockTick = tick as unknown as ReturnType<typeof vi.fn>;

let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'probe-'));
  mkdirSync(join(sandbox, '.plot', 'agents'), { recursive: true });
  process.env.PLOT_REPO_ROOT = sandbox;
  mockTick.mockReset();
});

describe('probe', () => {
  it('PIN 1+3: --once returns non-zero on a throwing tick', async () => {
    mockTick.mockRejectedValue(new Error('boom'));
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['--once'], join(sandbox, 'scripts', 'board'),
      (s) => out.push(s), async () => {}, () => false, (s) => err.push(s));
    expect(code).toBe(1);
    expect(err.join('')).toContain('tick failed: boom');
  });

  it('PIN 1+2: the loop survives and the next tick is attempted', async () => {
    let n = 0;
    mockTick.mockImplementation(async () => { n += 1; throw new Error(`boom ${n}`); });
    const err: string[] = [];
    let ticks = 0;
    const code = await run([], join(sandbox, 'scripts', 'board'),
      () => {}, async () => {}, () => { ticks += 1; return ticks > 3; }, (s) => err.push(s));
    expect(code).toBe(0);
    expect(n).toBe(3);
    expect(err.join('')).toContain('boom 3');
  });

  it('PIN 4: the report is empty rather than partial', async () => {
    mockTick.mockRejectedValue(new Error('boom'));
    const out: string[] = [];
    await run(['--once'], join(sandbox, 'scripts', 'board'),
      (s) => out.push(s), async () => {}, () => false, () => {});
    // Only the banner, no tick line
    expect(out.join('')).toContain('supervising');
    expect(out.join('')).not.toContain('agents=');
  });

  it('CONTROL: a healthy tick still reports', async () => {
    const actual = await vi.importActual<typeof import('../../src/server/entry/registryd.js')>('../../src/server/entry/registryd.js');
    mockTick.mockImplementation(actual.tick as never);
    const out: string[] = [];
    const code = await run(['--once'], join(sandbox, 'scripts', 'board'),
      (s) => out.push(s), async () => {}, () => false, () => {});
    expect(code).toBe(0);
    expect(out.join('')).toContain('agents=');
  });
});
