import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../src/server/entry/reap.js';

const scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');
const DAY_S = 24 * 60 * 60;

let base: string;
let tmpRoot: string;
const saved = { TMPDIR: process.env.TMPDIR, HOME: process.env.HOME, PLOT_BUDGET_HOME: process.env.PLOT_BUDGET_HOME };

const age = (p: string, days: number): void => {
  const t = Date.now() / 1000 - days * DAY_S;
  utimesSync(p, t, t);
};

const sweep = async (args: string[]): Promise<string> => {
  const lines: string[] = [];
  await run(['--sweep-temp', ...args], base, scriptDir, (s) => lines.push(s), (s) => lines.push(s));
  return lines.join('');
};

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), 'reap-sweep-'));
  tmpRoot = path.join(base, 'tmp');
  mkdirSync(tmpRoot);
  process.env.TMPDIR = tmpRoot;
  process.env.HOME = path.join(base, 'home');
  process.env.PLOT_BUDGET_HOME = '';
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(base, { recursive: true, force: true });
});

describe('--sweep-temp', () => {
  it('removes a stale plot-* directory and leaves a fresh one and a foreign name', async () => {
    const stale = path.join(tmpRoot, 'plot-stale');
    const fresh = path.join(tmpRoot, 'plot-fresh');
    const foreign = path.join(tmpRoot, 'other-stale');
    for (const dir of [stale, fresh, foreign]) mkdirSync(dir);
    age(stale, 3);
    age(foreign, 3);

    await sweep(['--yes']);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(foreign)).toBe(true);
  });

  it('judges a symlink by itself and not by the old directory it points at', async () => {
    const target = path.join(base, 'elsewhere');
    mkdirSync(target);
    age(target, 3);
    const link = path.join(tmpRoot, 'plot-link');
    symlinkSync(target, link);

    await sweep(['--yes']);

    expect(existsSync(link)).toBe(true);
    expect(existsSync(target)).toBe(true);
  });

  it('falls back to HOME/.plot/state when PLOT_BUDGET_HOME is empty', async () => {
    const memo = path.join(base, 'home', '.plot/state/memo/999999999');
    mkdirSync(memo, { recursive: true });
    age(memo, 3);

    const out = await sweep(['--yes']);

    expect(out).toContain(`removed ${memo}`);
    expect(existsSync(memo)).toBe(false);
  });
});
