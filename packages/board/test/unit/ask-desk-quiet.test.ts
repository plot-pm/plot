// `plot-ask.mjs desk-quiet <desk>...`: seconds since each desk's newest live
// signal, one line per argument, for `plot-fleetctl.sh --status` to print.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '../../src/server/entry/main.js';
import { removeTree } from '../rm-tree.mjs';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');

const ageFile = (file: string, seconds: number): void => {
  fs.writeFileSync(file, 'x\n');
  const at = new Date(Date.now() - seconds * 1000);
  fs.utimesSync(file, at, at);
};

describe('plot-ask desk-quiet', () => {
  let root = '';
  const env = { repo: process.env.PLOT_REPO_ROOT, scripts: process.env.PLOT_SCRIPTS_DIR };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-desk-quiet-'));
    process.env.PLOT_REPO_ROOT = root;
    process.env.PLOT_SCRIPTS_DIR = SCRIPTS;
  });

  afterEach(() => {
    for (const [key, value] of [['PLOT_REPO_ROOT', env.repo], ['PLOT_SCRIPTS_DIR', env.scripts]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    removeTree(root);
  });

  it('prints the newest signal per desk in argument order, and an empty field for an unreadable desk', async () => {
    const fresh = path.join(root, 'desk-fresh');
    fs.mkdirSync(fresh);
    ageFile(path.join(fresh, '.plot-worker.log'), 7200);
    ageFile(path.join(fresh, '.plot-worker.pass'), 60);
    const stale = path.join(root, 'desk-stale');
    fs.mkdirSync(stale);
    ageFile(path.join(stale, '.plot-worker.log'), 600);
    const absent = path.join(root, 'desk-absent');

    const lines: string[] = [];
    expect(await run(['desk-quiet', stale, absent, fresh], path.join(SCRIPTS, 'board'), (s) => lines.push(s))).toBe(0);
    const rows = lines.join('').split('\n').filter(Boolean).map((line) => line.split('\t'));
    expect(rows.map(([desk]) => desk)).toEqual([stale, absent, fresh]);
    expect(Number(rows[0][1])).toBeGreaterThanOrEqual(600);
    expect(Number(rows[0][1])).toBeLessThan(660);
    expect(rows[1]).toEqual([absent, '']);
    expect(Number(rows[2][1])).toBeGreaterThanOrEqual(60);
    expect(Number(rows[2][1])).toBeLessThan(120);
  });

  it('prints nothing for no desks', async () => {
    const lines: string[] = [];
    expect(await run(['desk-quiet'], path.join(SCRIPTS, 'board'), (s) => lines.push(s))).toBe(0);
    expect(lines).toEqual([]);
  });
});
