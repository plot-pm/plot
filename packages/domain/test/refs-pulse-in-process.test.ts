import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as runScriptModule from '../src/adapters/run-script.js';
import { refsGit } from '../src/adapters/refs/refs-git.js';
import { shellContext } from '../src/adapters/scripts.js';
import { hostFixture } from '../src/adapters/host/host-fixture.js';
import { recordHostReads } from '../src/adapters/host/process-host-reads.js';
import type { Host } from '../src/ports/host.js';

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
    // One pulse per open PR runs on every idle pass: a fetch here is a fetch per PR.
    expect(started.filter((call) => call.split(' ').includes('fetch'))).toEqual([]);
    expect(pulse.ok, JSON.stringify(pulse)).toBe(true);
  });
  // Measured 2026-11-20: fleetd spent 2,425 GraphQL points an hour on this
  // pulse's PR listing — one `open` page and ten `all` pages per sprint-scope
  // read, cut at the walk's 1000-row limit, for every open PR on every pass.
  it('asks the host for no pull request and still names the plan branches', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pulse-nohost-'));
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
    fs.writeFileSync(
      path.join(repo, 'plans', '2026-11-20-one-slice.md'),
      ['# One slice', '', '## Status', '', '- **State:** Approved', '', '## Slices', '', '### One', '', '- `feature/one-slice` — the slice', ''].join('\n'),
    );
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'init');
    git(repo, 'push', '-q', 'origin', 'main');

    const asked: string[] = [];
    const fixture = hostFixture({ backend: 'github' });
    const counted = new Proxy(fixture, {
      get: (target, name, receiver) => {
        const member = Reflect.get(target, name, receiver) as unknown;
        if (typeof member !== 'function' || name === 'backend' || name === 'lastRefusal') return member;
        return (...args: unknown[]) => {
          asked.push(String(name));
          return (member as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as Host;
    recordHostReads(repo, counted);

    const scripts = path.join(__dirname, '..', '..', '..', 'skills', 'plot', 'scripts');
    const pulse = await refsGit({ repoRoot: repo, scriptDir: scripts }).pulse();

    expect(pulse.ok, JSON.stringify(pulse)).toBe(true);
    expect(asked).toEqual([]);
    expect(started.filter((call) => call.includes('plot-host.sh'))).toEqual([]);
    const branches = pulse.ok ? pulse.value.plans.flatMap((plan) => plan.slices.flatMap((slice) => slice.branches.map((b) => b.branch))) : [];
    expect(branches).toEqual(['feature/one-slice']);
  });
});
