import { execFileSync as realExecFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gateContractFile } from '@plot-pm/domain/adapters';
import type { GateContractReader } from '@plot-pm/domain/ports/gate-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every process start made through `node:child_process`, as one command line per
 * start. A pass-through: the real function still runs, so the board behaves as
 * it does in production and the list is what it did.
 */
const starts = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const line = (command: unknown, args: unknown): string =>
    [String(command), ...(Array.isArray(args) ? args.map(String) : [])].join(' ');
  // `util.promisify(execFile)` reads a symbol property on the real function, so
  // the wrapper copies every own property, symbols included.
  const wrap = <F extends (...a: never[]) => unknown>(name: string, fn: F): F => {
    const wrapped = ((...a: unknown[]) => {
      starts.lines.push(`${name} ${line(a[0], a[1])}`);
      return (fn as unknown as (...b: unknown[]) => unknown)(...a);
    }) as unknown as F;
    for (const key of Reflect.ownKeys(fn)) {
      if (key === 'length' || key === 'name') continue;
      Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(fn, key)!);
    }
    return wrapped;
  };
  const counted = {
    ...real,
    spawn: wrap('spawn', real.spawn),
    spawnSync: wrap('spawnSync', real.spawnSync),
    execFile: wrap('execFile', real.execFile),
    execFileSync: wrap('execFileSync', real.execFileSync),
  };
  return { ...counted, default: counted };
});

import { boardAnswer } from '../../src/server/controllers/board-answer.js';
import { mockEstate, realEstate } from '../../src/server/estate.js';
import { pauseFleetRefresh, pulseFor, stopFleetRefresh } from '../../src/server/fleet.js';
import { removeTree } from '../rm-tree.mjs';

/**
 * A WARM `/api/board` REQUEST STARTS ONLY THE PROCESSES LISTED HERE.
 *
 * Issue #3017: the request waits on dozens of short processes started one after
 * another, 7.8 s to 61 s at load 6 to 9 with the board idle. This test removes no
 * start. It makes the list visible and fails on growth, so each later slice of
 * `the-board-starts-processes-on-the` proves its relief by deleting lines from
 * `WARM_STARTS`.
 *
 * The list is exact: a "count ≤ N" assertion would hide one start swapped for
 * another. It asserts no duration. A module mock counts starts, not what a
 * script starts inside itself: `plot-config.sh get` is one line here and about
 * five processes.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_SCRIPTS = path.resolve(HERE, '../../../../skills/plot/scripts');

const made: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
const setEnv = (name: string, value: string): void => {
  if (!(name in savedEnv)) savedEnv[name] = process.env[name];
  process.env[name] = value;
};

const tmp = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};

const git = (cwd: string, ...args: string[]): void => {
  realExecFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdio: 'ignore',
  });
};

const PLAN = (title: string, phase: string): string =>
  `# ${title}\n\n## Status\n\n- **Phase:** ${phase}\n- **Type:** feature\n\n## Slices\n\n- \`feature/${title.toLowerCase().replace(/\s+/g, '-')}\`\n`;

/** The real scripts, with a `plot-host.sh` that answers nothing and reaches no host. */
const scriptsWithSilentHost = (): string => {
  const dir = tmp('plot-board-starts-scripts-');
  for (const name of fs.readdirSync(REAL_SCRIPTS)) {
    if (name === 'plot-host.sh') continue;
    fs.symlinkSync(path.join(REAL_SCRIPTS, name), path.join(dir, name));
  }
  fs.writeFileSync(path.join(dir, 'plot-host.sh'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  return dir;
};

/**
 * A gate reader that reads no plugin registry: an empty registry directory and
 * a fixture gate that answers `1`. Each call builds a fresh adapter, as
 * `gateContractFor` does when the board is handed none, so the warm request
 * starts the gate exactly as production does on any machine.
 */
const fixtureGate = (): { dir: string; reader: GateContractReader } => {
  const dir = tmp('plot-board-starts-gate-');
  const gatePath = path.join(dir, 'plot-gate.mjs');
  fs.writeFileSync(gatePath, 'console.log(1);\n');
  const options = { pluginRoot: tmp('plot-board-starts-plugins-'), repoGatePath: gatePath };
  return {
    dir,
    reader: {
      resolve: (repoRoot) => gateContractFile(options).resolve(repoRoot),
      spawnContract: (gate) => gateContractFile(options).spawnContract(gate),
    },
  };
};

/** A git estate: three Delivered plans on main and one draft plan on its own branch. */
const estateRepo = (): string => {
  const home = tmp('plot-board-starts-home-');
  setEnv('PLOT_PR_INDEX_HOME', home);
  setEnv('PLOT_BUDGET_HOME', home);
  const repo = tmp('plot-board-starts-repo-');
  setEnv('PLOT_REPO_ROOT', repo);
  git(repo, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# P\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  for (const [date, title] of [['2026-10-01', 'Alpha'], ['2026-10-02', 'Beta'], ['2026-10-03', 'Gamma']]) {
    fs.writeFileSync(path.join(repo, `docs/plans/${date}-${title.toLowerCase()}.md`), PLAN(title, 'Delivered'));
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');
  git(repo, 'checkout', '-q', '-b', 'idea/draft-one');
  fs.writeFileSync(path.join(repo, 'docs/plans/2026-10-04-draft-one.md'), PLAN('Draft one', 'Draft'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'draft');
  git(repo, 'checkout', '-q', 'main');
  return repo;
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  stopFleetRefresh();
  vi.useRealTimers();
  starts.lines.length = 0;
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const dir of made.splice(0)) removeTree(dir);
});

/**
 * One start without the machine it ran on: the scripts directory, the repo and
 * the fixture gate's directory become placeholders. `/private` is the resolved
 * form macOS gives a temp directory.
 */
const normalise = (line: string, roots: Record<string, string>): string => {
  let out = line;
  for (const [name, value] of Object.entries(roots)) {
    out = out.split(`/private${value}`).join(`<${name}>`).split(value).join(`<${name}>`);
  }
  return out;
};

/**
 * The exact list a warm request starts, recorded as measured. Each later slice
 * deletes the lines it removes.
 */
const WARM_STARTS: readonly string[] = [
  "execFileSync git hash-object --stdin-paths",
  "spawn bash -c git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed \"s|^origin/||\" || git rev-parse --abbrev-ref HEAD",
  "spawn bash -c git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed \"s|^origin/||\" || git rev-parse --abbrev-ref HEAD",
  "spawn bash -c git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed \"s|^origin/||\" || git rev-parse --abbrev-ref HEAD",
  "spawn bash -c git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed \"s|^origin/||\" || git rev-parse --abbrev-ref HEAD",
  "spawn bash -c git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed \"s|^origin/||\" || git rev-parse --abbrev-ref HEAD",
  "spawn bash -c git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed \"s|^origin/||\" || git rev-parse --abbrev-ref HEAD",
  "spawn bash <scripts>/plot-config.sh get Board command ",
  "spawn bash <scripts>/plot-config.sh get Branch prefixes ",
  "spawn bash <scripts>/plot-config.sh get Interrogate command ",
  "spawn bash <scripts>/plot-config.sh get Main branch ",
  "spawn bash <scripts>/plot-config.sh get Main branch ",
  "spawn bash <scripts>/plot-config.sh get Main branch ",
  "spawn bash <scripts>/plot-config.sh get Plan directory docs/plans/",
  "spawn bash <scripts>/plot-config.sh get Plan directory docs/plans/",
  "spawn bash <scripts>/plot-config.sh get Plan directory docs/plans/",
  "spawn bash <scripts>/plot-config.sh get Release directory docs/releases/",
  "spawn bash <scripts>/plot-config.sh get Sprint directory docs/sprints/",
  "spawn bash <scripts>/plot-config.sh get Story directory docs/stories/",
  "spawn bash <scripts>/plot-config.sh get Tracker ",
  "spawn bash <scripts>/plot-config.sh get Tracker ",
  "spawn bash <scripts>/plot-config.sh get Workflow phases ",
  "spawn bash <scripts>/plot-config.sh get Workflow phases ",
  "spawn bash <scripts>/plot-plan-meta.sh <repo>/docs/plans/2026-10-01-alpha.md <repo>/docs/plans/2026-10-02-beta.md <repo>/docs/plans/2026-10-03-gamma.md",
  "spawn bash <scripts>/plot-plan-meta.sh <repo>/docs/plans/2026-10-01-alpha.md <repo>/docs/plans/2026-10-02-beta.md <repo>/docs/plans/2026-10-03-gamma.md",
  "spawn bash <scripts>/plot-plan-meta.sh <repo>/docs/plans/2026-10-01-alpha.md <repo>/docs/plans/2026-10-02-beta.md <repo>/docs/plans/2026-10-03-gamma.md",
  "spawn git --no-optional-locks -C <repo> status --porcelain --untracked-files=no",
  "spawn git for-each-ref --format=%(refname) %(objectname) refs/heads refs/remotes",
  "spawn git log -m --first-parent -U0 --format=@@%H -G^[ 	]*[-*][ 	]*\\*\\*Delivered:\\*\\* origin/ -- docs/plans/2026-10-01-alpha.md",
  "spawn git log -m --first-parent -U0 --format=@@%H -G^[ 	]*[-*][ 	]*\\*\\*Delivered:\\*\\* origin/ -- docs/plans/2026-10-02-beta.md",
  "spawn git log -m --first-parent -U0 --format=@@%H -G^[ 	]*[-*][ 	]*\\*\\*Delivered:\\*\\* origin/ -- docs/plans/2026-10-03-gamma.md",
  "spawn git log origin/main --diff-filter=AR --name-status --format=@%H	%an -- docs/plans/",
  "spawn git ls-tree -r origin/main -- docs/plans/",
  "spawn git ls-tree -r origin/main -- docs/sprints/active",
  "spawn git ls-tree -r origin/main -- docs/stories/",
  "spawn git ls-tree -r origin/main -- docs/stories/",
  "spawn git rev-parse --git-common-dir",
  "spawn git rev-parse origin/main",
  "spawn git rev-parse origin/main",
  "spawn git rev-parse origin/main^{commit}",
  "spawn node <gate>/plot-gate.mjs --spawn-contract",
];

describe('a warm /api/board request', () => {
  it('starts exactly the processes listed', async () => {
    const repoRoot = estateRepo();
    const gate = fixtureGate();
    const opts = { repoRoot, scriptsDir: scriptsWithSilentHost(), gateContract: gate.reader };
    const estate = realEstate(opts);
    // Pinned, so the 5 s and 60 s holds in `serverInfo` do not expire between
    // the two calls.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));

    const first = await boardAnswer(opts, estate, 'localhost', 7777, false);
    expect(first.columns.length).toBeGreaterThan(0);
    const cold = starts.lines.splice(0);

    // The first call also starts the refresh loop's first scan, which runs on
    // after the call returns. Wait for its pulse, then for its starts to stop,
    // so the second call does not inherit the scan's processes. Two
    // seconds of quiet, counted in 200 ms ticks, because `Date` is pinned.
    pauseFleetRefresh();
    await vi.waitFor(() => expect(pulseFor(opts)).not.toBeNull(), { timeout: 60_000, interval: 200 });
    for (let quiet = 0, seen = -1; quiet < 10; ) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      quiet = starts.lines.length === seen ? quiet + 1 : 0;
      seen = starts.lines.length;
    }
    starts.lines.length = 0;

    await boardAnswer(opts, estate, 'localhost', 7777, false);
    const warm = starts.lines.splice(0);

    // The warm call must be cheaper than the cold one. Equal lists mean the
    // seam cleared the caches and this test measures nothing.
    expect(cold.length, 'cold call started nothing').toBeGreaterThan(0);
    expect(warm.length, `warm call is not warmer than cold:\n${cold.join('\n')}`).toBeLessThan(cold.length);
    // Sorted: concurrent reads start in an order the scheduler chooses, and the
    // claim is which starts happen, each as often as listed.
    const seen = warm.map((l) => normalise(l, { scripts: opts.scriptsDir, repo: opts.repoRoot, gate: gate.dir })).sort();
    expect(seen, `warm request starts:\n${seen.join('\n')}`).toEqual([...WARM_STARTS].sort());
  });

  it('is a value a test can read without a server', async () => {
    const opts = { repoRoot: estateRepo(), scriptsDir: scriptsWithSilentHost() };
    const answer = await boardAnswer(opts, mockEstate(), 'localhost', 7777, false);
    expect(answer.interrogate).toHaveProperty('available');
  });
});
