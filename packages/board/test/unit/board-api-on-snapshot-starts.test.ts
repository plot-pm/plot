import { execFileSync as realExecFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fleetdHeartbeatFile, gateContractFile } from '@plot-pm/domain/adapters';
import { FLEETD_HEARTBEAT_VERSION } from '@plot-pm/domain';
import type { GateContractReader } from '@plot-pm/domain/ports/gate-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Every process start made through `node:child_process`, as one command line
 * per start. Every adapter behind `Scripts`, `Refs`, `Trees`, `Host` and
 * `Processes` starts its processes through this module, so the list covers
 * them all.
 */
const starts = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const line = (command: unknown, args: unknown): string =>
    [String(command), ...(Array.isArray(args) ? args.map(String) : [])].join(' ');
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
    exec: wrap('exec', real.exec),
    execSync: wrap('execSync', real.execSync),
    execFile: wrap('execFile', real.execFile),
    execFileSync: wrap('execFileSync', real.execFileSync),
    fork: wrap('fork', real.fork),
  };
  return { ...counted, default: counted };
});

import { boardAnswer } from '../../src/server/controllers/board-answer.js';
import { realEstate } from '../../src/server/estate.js';
import { ensureCache, pauseFleetRefresh, stopFleetRefresh } from '../../src/server/fleet.js';
import { removeTree } from '../rm-tree.mjs';
import { servedSnapshotOf } from './served-snapshot.js';

// THE ROUTE'S SPAWN INVENTORY, plan `board-api-starts-nothing`, slices Readings
// and Serve. fleetd's heartbeat is live and the channel holds the snapshot
// fleetd's walk records, so the board's source is `snapshot`; ten warm
// `GET /api/board` requests are measured and every start they make is printed
// with its argv.

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
  `# ${title}\n\n## Status\n\n- **State:** ${phase}\n- **Type:** feature\n- **Issue:** #3\n\n## Slices\n\n### One\n\n- \`feature/${title.toLowerCase().replace(/\s+/g, '-')}\`\n`;

/** The real scripts, with a `plot-host.sh` that answers nothing and reaches no host. */
const scriptsWithSilentHost = (): string => {
  const dir = tmp('plot-api-snapshot-scripts-');
  for (const name of fs.readdirSync(REAL_SCRIPTS)) {
    if (name === 'plot-host.sh') continue;
    fs.symlinkSync(path.join(REAL_SCRIPTS, name), path.join(dir, name));
  }
  fs.writeFileSync(path.join(dir, 'plot-host.sh'), '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(path.join(dir, 'plot-host.sh'), 0o755);
  return dir;
};

/** A gate reader over an empty plugin registry and a fixture gate. */
const fixtureGate = (): { dir: string; reader: GateContractReader } => {
  const dir = tmp('plot-api-snapshot-gate-');
  const gatePath = path.join(dir, 'plot-gate.mjs');
  fs.writeFileSync(gatePath, 'console.log(1);\n');
  const options = { pluginRoot: tmp('plot-api-snapshot-plugins-'), repoGatePath: gatePath };
  // ONE READER FOR THE PROCESS, as the board holds one: its answer is cached by the gate file's stat.
  return { dir, reader: gateContractFile(options) };
};

/** A git estate: one Delivered and one Approved plan on main, a sprint, a story, and a draft plan on its own branch. */
const estateRepo = (): string => {
  const home = tmp('plot-api-snapshot-home-');
  setEnv('PLOT_PR_INDEX_HOME', home);
  setEnv('PLOT_BUDGET_HOME', home);
  const repo = tmp('plot-api-snapshot-repo-');
  setEnv('PLOT_REPO_ROOT', repo);
  git(repo, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(repo, 'docs/plans'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs/sprints/active'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs/stories/s'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# P\n\n## Plot Config\n\n- **Plan directory:** docs/plans/\n');
  fs.writeFileSync(path.join(repo, 'docs/plans/2026-10-01-alpha.md'), PLAN('Alpha', 'Delivered'));
  fs.writeFileSync(path.join(repo, 'docs/plans/2026-10-02-beta.md'), PLAN('Beta', 'Approved'));
  fs.writeFileSync(path.join(repo, 'docs/sprints/active/2026-W45-s.md'), '# Sprint: S\n\n## Status\n\n- **State:** Active\n\n### Must Have\n\n- [ ] [beta]\n');
  fs.writeFileSync(path.join(repo, 'docs/stories/s/STORY-s.md'), '---\ntitle: S\nstatus: active\n---\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'plans');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git(repo, 'checkout', '-q', '-b', 'idea/draft-one');
  fs.writeFileSync(path.join(repo, 'docs/plans/2026-10-04-draft-one.md'), PLAN('Draft one', 'Draft'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'draft');
  git(repo, 'update-ref', 'refs/remotes/origin/idea/draft-one', 'HEAD');
  git(repo, 'checkout', '-q', 'main');
  return repo;
};

afterEach(() => {
  stopFleetRefresh();
  starts.lines.length = 0;
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const dir of made.splice(0)) removeTree(dir);
});

const normalise = (line: string, roots: Record<string, string>): string => {
  let out = line;
  for (const [name, value] of Object.entries(roots)) {
    out = out.split(`/private${value}`).join(`<${name}>`).split(value).join(`<${name}>`);
  }
  return out.replace(/(?:\/private)?\/\S*?plot-board-plans-[^/\s]+/g, '<stage>');
};

const quiet = async (): Promise<void> => {
  for (let still = 0, seen = -1; still < 10; ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    still = starts.lines.length === seen ? still + 1 : 0;
    seen = starts.lines.length;
  }
};

describe('GET /api/board while fleetd serves its snapshot', () => {
  it('starts no process on 10 warm requests (the inventory prints each start)', async () => {
    const repoRoot = estateRepo();
    const gate = fixtureGate();
    const scriptsDir = scriptsWithSilentHost();
    const snapshot = await servedSnapshotOf(repoRoot, scriptsDir);
    const unread = Object.entries(snapshot.readings).filter(([key, r]) => ['refs', 'plans', 'branchPlans', 'sprints', 'stories'].includes(key) && r.state !== 'read');
    expect(unread).toEqual([]);
    const now = Date.now();
    await fleetdHeartbeatFile({ repoRoot }).write({
      version: FLEETD_HEARTBEAT_VERSION,
      pid: process.pid,
      startedAt: now - 600_000,
      beatAt: now,
      generation: 1,
      bridgeAt: null,
      supervised: 'launchd',
      watchesWanted: 0,
      watchesArmed: 0,
      lastEventAt: null,
      lastSafetyNetAt: null,
      loops: {},
    });
    const opts = {
      repoRoot,
      scriptsDir,
      gateContract: gate.reader,
      // The bundle a running board hashes; the fixture repository has none of its own.
      startBundle: { path: path.join(gate.dir, 'plot-gate.mjs'), hash: null },
      channelSnapshot: () => ({ link: { state: 'current' as const, epoch: 'e1', generation: 1 }, held: { epoch: 'e1', snapshot } }),
    };
    ensureCache(opts).clients = 1;
    const estate = realEstate(opts);

    await boardAnswer(opts, estate, 'localhost', 7777, false);
    pauseFleetRefresh();
    await quiet();
    // One request after the wait reads the checkout's branch, whose 5 s TTL
    // the wait outlasts (`refs-from-files` moves that read to a file); the
    // ten after it are the ones measured.
    await boardAnswer(opts, estate, 'localhost', 7777, false);
    starts.lines.length = 0;

    for (let i = 0; i < 10; i += 1) await boardAnswer(opts, estate, 'localhost', 7777, false);
    const warm = starts.lines
      .splice(0)
      .map((l) => normalise(l, { scripts: scriptsDir, repo: repoRoot, gate: gate.dir }))
      .sort();
    console.log(`10 GET /api/board on snapshot start ${warm.length}:\n${warm.join('\n')}`);
    expect(warm).toEqual([]);
  }, 120_000);
});
