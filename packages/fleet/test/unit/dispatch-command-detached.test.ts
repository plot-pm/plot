import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { parseRunMarker } from '../../src/shared/board-run.js';
import { implementStatePath } from '../../src/shared/implement-run.js';
import { removeTree as rmTree } from '../rm-tree.mjs';

// The real detached path: the entry is bundled from source and run as a
// process, so `launchSelf` and the `--foreground` switch execute. Every other
// `runDetached` test injects `deps.launch`.
//
// A launch without `--foreground` makes each child call `runDetached` again, a
// chain of detached processes. The test fails on that: the parent never sees a
// state file naming its child, and exits 1 after its 30 s wait.

const SLUG = 'a-plan-the-fleet-dispatches';
const SCRIPT_DIR = path.resolve(__dirname, '../../../../skills/plot/scripts');
const ENTRY = path.resolve(__dirname, '../../src/server/entry/dispatch-command.ts');

let tmp: string;
let bundle: string;
let repo: string;
let started: string;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-bundle-'));
  bundle = path.join(dir, 'plot-dispatch-command.mjs');
  await build({ entryPoints: [ENTRY], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: bundle, logLevel: 'silent' });
}, 60_000);

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-dispatch-detached-')));
  repo = path.join(tmp, 'repo');
  started = path.join(tmp, 'started');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  // The implement records each start, sleeps, and fails, so no dispatch script follows it.
  fs.writeFileSync(
    path.join(repo, 'CLAUDE.md'),
    `# Sandbox\n\n## Plot Config\n\n- **Implement command:** sh -c 'echo started >> ${started}; sleep 2; exit 1'\n`,
  );
});

afterEach(() => {
  rmTree(tmp);
});

afterAll(() => {
  rmTree(path.dirname(bundle));
});

const environment = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('PLOT_')) env[key] = value;
  return { ...env, PLOT_SCRIPTS_DIR: SCRIPT_DIR };
};

const waitFor = async (what: string, read: () => boolean, ms: number): Promise<void> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (read()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('the detached dispatch entry as a process', () => {
  it('exits 0 once the implement runs, and starts exactly one implement', async () => {
    const parent = spawn(process.execPath, [bundle, SLUG], { cwd: repo, env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
    let said = '';
    parent.stdout.on('data', (d) => (said += d));
    parent.stderr.on('data', (d) => (said += d));
    const code = await new Promise<number | null>((resolve) => parent.on('exit', resolve));
    expect(code, said).toBe(0);
    expect(said).toContain(`implement started for ${SLUG}`);
    const marker = parseRunMarker(fs.readFileSync(implementStatePath(repo, SLUG), 'utf8').trim());
    expect(marker?.pid).toBeGreaterThan(0);
    // The implement ends on its own; the detached process records `1` and exits.
    await waitFor('the implement to end', () => fs.readFileSync(implementStatePath(repo, SLUG), 'utf8').trim() === '1', 20_000);
    await waitFor('the detached process to exit', () => !alive(marker?.pid ?? 0), 20_000);
    expect(fs.readFileSync(started, 'utf8').trim().split('\n')).toEqual(['started']);
  }, 60_000);
});
