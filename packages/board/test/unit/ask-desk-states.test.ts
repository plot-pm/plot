// `plot-ask.mjs desk-states <desk>...`: the board's state of each desk, one
// line per argument, for `plot-fleetctl.sh --status` to print beside its own.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { run } from '../../src/server/entry/main.js';
import { removeTree } from '../rm-tree.mjs';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../skills/plot/scripts');

describe('plot-ask desk-states', () => {
  let root = '';
  let live: ChildProcess | null = null;
  const env = { repo: process.env.PLOT_REPO_ROOT, scripts: process.env.PLOT_SCRIPTS_DIR, dir: process.env.PLOT_MANIFEST_DIR };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-desk-states-'));
    fs.mkdirSync(path.join(root, '.plot', 'agents'), { recursive: true });
    process.env.PLOT_REPO_ROOT = root;
    process.env.PLOT_SCRIPTS_DIR = SCRIPTS;
    process.env.PLOT_MANIFEST_DIR = path.join(root, '.plot', 'agents');
  });

  afterEach(() => {
    if (live?.pid) {
      try {
        process.kill(live.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    live = null;
    for (const [key, value] of [['PLOT_REPO_ROOT', env.repo], ['PLOT_SCRIPTS_DIR', env.scripts], ['PLOT_MANIFEST_DIR', env.dir]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    removeTree(root);
  });

  it('prints one tab-separated state per desk, in argument order', async () => {
    live = spawn('sleep', ['60'], { stdio: 'ignore' });
    const running = path.join(root, 'desk-running');
    fs.mkdirSync(running);
    fs.writeFileSync(path.join(running, '.plot-worker.pid'), `${live.pid}\n`);
    const failed = path.join(root, 'desk-failed');
    fs.mkdirSync(failed);
    fs.writeFileSync(path.join(failed, '.plot-worker.pid'), '999993\n');
    fs.writeFileSync(path.join(failed, '.plot-worker.exit'), '3\n');
    const absent = path.join(root, 'desk-absent');

    const lines: string[] = [];
    expect(await run(['desk-states', running, failed, absent], path.join(SCRIPTS, 'board'), (s) => lines.push(s))).toBe(0);
    expect(lines.join('')).toBe(`${running}\trunning\n${failed}\tfailed\n${absent}\tnone\n`);
  });

  it('prints nothing for no desks', async () => {
    const lines: string[] = [];
    expect(await run(['desk-states'], path.join(SCRIPTS, 'board'), (s) => lines.push(s))).toBe(0);
    expect(lines).toEqual([]);
  });
});
