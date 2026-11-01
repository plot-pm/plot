import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as runScriptModule from '../src/adapters/run-script.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext } from '../src/adapters/scripts.js';

/** Every argv the adapter layer started, as one string per call. */
const started: string[] = [];

vi.mock('../src/adapters/run-script.js', async (importOriginal) => {
  const real = await importOriginal<typeof runScriptModule>();
  const note = (command: string, args: readonly string[]): void => {
    started.push([command, ...args].join(' '));
  };
  return {
    ...real,
    runProcess: (command: string, args: readonly string[], ...rest: unknown[]) => {
      note(command, args);
      return (real.runProcess as (...a: unknown[]) => unknown)(command, args, ...rest);
    },
    runScript: (command: string, args: readonly string[], ...rest: unknown[]) => {
      note(command, args);
      return (real.runScript as (...a: unknown[]) => unknown)(command, args, ...rest);
    },
  };
});

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Refs.pulse runs the plan walk in process', () => {
  beforeEach(() => {
    started.length = 0;
  });

  it('starts no plot-fleet-scan.sh process and still answers a pulse', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pulse-inproc-'));
    dirs.push(root);
    const origin = path.join(root, 'origin.git');
    const repo = path.join(root, 'repo');
    const git = (cwd: string, ...args: string[]): void => {
      execFileSync('git', args, { cwd, stdio: 'ignore' });
    };
    git(root, 'init', '--bare', '-q', '-b', 'main', origin);
    git(root, 'clone', '-q', origin, repo);
    git(repo, 'config', 'user.email', 'test@example.invalid');
    git(repo, 'config', 'user.name', 'Plot Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# F\n\n## Plot Config\n\n- **Plan directory:** plans/\n');
    fs.mkdirSync(path.join(repo, 'plans'));
    fs.writeFileSync(path.join(repo, 'plans', '.keep'), '');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'init');
    git(repo, 'push', '-q', 'origin', 'main');

    // The config script is the repository's own; link the shipped helpers in.
    const scripts = path.join(__dirname, '..', '..', '..', 'skills', 'plot', 'scripts');
    const context = { repoRoot: repo, scriptDir: scripts };
    expect(shellContext(repo).repoRoot).toBe(repo);

    const pulse = await refsGit(context).pulse();

    expect(started.filter((call) => call.includes('plot-fleet-scan.sh'))).toEqual([]);
    expect(pulse.ok, JSON.stringify(pulse)).toBe(true);
  });
});
