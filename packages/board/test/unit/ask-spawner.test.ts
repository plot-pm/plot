// `plot-ask.mjs spawner [pid]` and `spawner --from-board`: the two CLI modes
// `plot-fleetctl.sh --status` and `plot-boardctl.sh --status` read, both
// reaching `spawnerStatus`/`bundleDriftDetected` in `@plot-pm/domain` and
// deciding nothing themselves — #2728 (docs/plans/
// 2026-10-26-a-board-or-fleetd-older-than.md).
//
// A real temp git repo stands in for the repository: `fleetdStartFile` hashes
// its bundle path with a real `git hash-object`, so a fixture with no commit
// at all would fail that call rather than exercise the drift comparison. The
// gate is exercised through the REPO-SCRIPT fallback tier — `CLAUDE_CONFIG_DIR`
// points at an empty directory so no plugin install is found, and
// `skills/plot/scripts/board/plot-gate.mjs` inside the fixture is a tiny
// script that prints a controlled number for `--spawn-contract`.
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rmTree } from '../helpers.mjs';
import { run } from '../../src/server/entry/main.js';

const temps: string[] = [];
const envKeys = ['PLOT_REPO_ROOT', 'PLOT_FLEETD_START_HOME', 'CLAUDE_CONFIG_DIR'] as const;
let prior: Partial<Record<(typeof envKeys)[number], string>> = {};

afterEach(() => {
  for (const key of envKeys) {
    if (prior[key] === undefined) delete process.env[key];
    else process.env[key] = prior[key];
  }
  for (const d of temps.splice(0)) rmTree(d);
});

const git = (dir: string, ...args: string[]): void => {
  execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
};

/** A fixture gate: a tiny `node` script that prints `number` for `--spawn-contract`. */
const writeGate = (repoRoot: string, number: number): void => {
  const gateDir = path.join(repoRoot, 'skills', 'plot', 'scripts', 'board');
  fs.mkdirSync(gateDir, { recursive: true });
  fs.writeFileSync(
    path.join(gateDir, 'plot-gate.mjs'),
    `#!/usr/bin/env node\nif (process.argv[2] === '--spawn-contract') { process.stdout.write('${number}\\n'); process.exit(0); }\nprocess.exit(1);\n`,
  );
};

/** A real repo with a committed bundle file, so `hashFilesSync` has a real blob to hash. */
const repoWithBundle = (bundleContent = 'bundle-v1'): { repoRoot: string; bundlePath: string; bundleHash: string } => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-spawner-'));
  temps.push(repoRoot);
  git(repoRoot, 'init', '--quiet', '-b', 'main');
  git(repoRoot, 'config', 'user.email', 'test@example.com');
  git(repoRoot, 'config', 'user.name', 'Test');
  const bundlePath = 'skills/plot/scripts/board/plot-fleetd.mjs';
  fs.mkdirSync(path.dirname(path.join(repoRoot, bundlePath)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, bundlePath), bundleContent);
  git(repoRoot, 'add', '-A');
  git(repoRoot, 'commit', '-qm', 'bundle');
  const bundleHash = execFileSync('git', ['-C', repoRoot, 'hash-object', bundlePath], { encoding: 'utf8' }).trim();
  return { repoRoot, bundlePath, bundleHash };
};

const writeFleetdStart = (
  repoRoot: string,
  record: { pid: number; spawnContract: number; bundlePath: string; bundleHash: string },
): void => {
  const dir = path.join(repoRoot, '.plot', 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'fleetd-start.json'),
    `${JSON.stringify({ v: 1, startedAt: 0, ...record })}\n`,
  );
  process.env.PLOT_FLEETD_START_HOME = dir;
};

/** Points the gate lookup at the repo-script fallback tier: no plugin install found. */
const useRepoScriptGate = (repoRoot: string): void => {
  const emptyPluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-spawner-plugins-'));
  temps.push(emptyPluginRoot);
  process.env.CLAUDE_CONFIG_DIR = emptyPluginRoot;
  process.env.PLOT_REPO_ROOT = repoRoot;
};

const askSpawner = async (argv: string[]): Promise<{ code: number; body: Record<string, unknown> }> => {
  const lines: string[] = [];
  const code = await run(argv, '/nonexistent', (line) => lines.push(line));
  return { code, body: JSON.parse(lines.join('')) };
};

describe('plot-ask spawner [pid]', () => {
  it('reads current when the record, the live pid and the gate all agree', async () => {
    const { repoRoot, bundlePath, bundleHash } = repoWithBundle();
    writeGate(repoRoot, 7);
    useRepoScriptGate(repoRoot);
    writeFleetdStart(repoRoot, { pid: 4242, spawnContract: 7, bundlePath, bundleHash });

    const { code, body } = await askSpawner(['spawner', '4242']);
    expect(code).toBe(0);
    expect(body.status).toBe('current');
    expect(body.bundleDrift).toBe(false);
  });

  it('reads stale with both numbers when the record is behind the gate', async () => {
    const { repoRoot, bundlePath, bundleHash } = repoWithBundle();
    writeGate(repoRoot, 9);
    useRepoScriptGate(repoRoot);
    writeFleetdStart(repoRoot, { pid: 4242, spawnContract: 7, bundlePath, bundleHash });

    const { code, body } = await askSpawner(['spawner', '4242']);
    expect(code).toBe(0);
    expect(body.status).toBe('stale: spawn contract 7, gate expects 9');
  });

  it('reads stale with both numbers when the record is ahead of the gate', async () => {
    const { repoRoot, bundlePath, bundleHash } = repoWithBundle();
    writeGate(repoRoot, 5);
    useRepoScriptGate(repoRoot);
    writeFleetdStart(repoRoot, { pid: 4242, spawnContract: 7, bundlePath, bundleHash });

    const { code, body } = await askSpawner(['spawner', '4242']);
    expect(code).toBe(0);
    expect(body.status).toBe('stale: spawn contract 7, gate expects 5');
  });

  it('reads unknown when the live pid does not match the record', async () => {
    const { repoRoot, bundlePath, bundleHash } = repoWithBundle();
    writeGate(repoRoot, 7);
    useRepoScriptGate(repoRoot);
    writeFleetdStart(repoRoot, { pid: 4242, spawnContract: 7, bundlePath, bundleHash });

    const { code, body } = await askSpawner(['spawner', '9999']);
    expect(code).toBe(0);
    expect(body.status).toBe('unknown');
  });

  it('reads unknown when no record has been written', async () => {
    const { repoRoot } = repoWithBundle();
    writeGate(repoRoot, 7);
    useRepoScriptGate(repoRoot);
    process.env.PLOT_FLEETD_START_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-ask-spawner-empty-'));
    temps.push(process.env.PLOT_FLEETD_START_HOME);

    const { code, body } = await askSpawner(['spawner', '4242']);
    expect(code).toBe(0);
    expect(body.status).toBe('unknown');
  });

  it('reads unknown when the gate answers nothing', async () => {
    const { repoRoot, bundlePath, bundleHash } = repoWithBundle();
    // A gate file that exists but exits nonzero for --spawn-contract.
    const gateDir = path.join(repoRoot, 'skills', 'plot', 'scripts', 'board');
    fs.mkdirSync(gateDir, { recursive: true });
    fs.writeFileSync(path.join(gateDir, 'plot-gate.mjs'), '#!/usr/bin/env node\nprocess.exit(1);\n');
    useRepoScriptGate(repoRoot);
    writeFleetdStart(repoRoot, { pid: 4242, spawnContract: 7, bundlePath, bundleHash });

    const { code, body } = await askSpawner(['spawner', '4242']);
    expect(code).toBe(0);
    expect(body.status).toBe('unknown');
  });

  it('reports bundle drift as separate evidence, never as stale, when the numbers agree', async () => {
    const { repoRoot, bundlePath, bundleHash } = repoWithBundle('bundle-v1');
    writeGate(repoRoot, 7);
    useRepoScriptGate(repoRoot);
    // Record a hash that does not match the committed bundle content.
    writeFleetdStart(repoRoot, { pid: 4242, spawnContract: 7, bundlePath, bundleHash: `${bundleHash}stale` });

    const { code, body } = await askSpawner(['spawner', '4242']);
    expect(code).toBe(0);
    expect(body.status).toBe('current');
    expect(body.bundleDrift).toBe(true);
    expect(body.bundleDriftText).toContain(bundlePath);
  });

  it('reports no bundle drift when the recorded hash matches the bundle on disk', async () => {
    const { repoRoot, bundlePath, bundleHash } = repoWithBundle();
    writeGate(repoRoot, 7);
    useRepoScriptGate(repoRoot);
    writeFleetdStart(repoRoot, { pid: 4242, spawnContract: 7, bundlePath, bundleHash });

    const { code, body } = await askSpawner(['spawner', '4242']);
    expect(code).toBe(0);
    expect(body.bundleDrift).toBe(false);
    expect(body.bundleDriftText).toBeNull();
  });
});

describe('plot-ask spawner --from-board', () => {
  // `main.ts` reads fd 0 SYNCHRONOUSLY via `readFileSync(0, ...)`. Vitest's own
  // stdin is not a pipe a synchronous read can serve, so this mode is
  // exercised through a real child process with a real piped stdin — the same
  // shape `test/reconcile/plan-hints.test.mjs` uses for `plangate`, which reads
  // stdin the same way. It runs against the SHIPPED bundle rather than this
  // source file directly, so it needs a local rebuild first; CI's own
  // `test:board` step rebuilds before running anything under `test/`.
  const ask = path.resolve(__dirname, '../../../../skills/plot/scripts/board/plot-ask.mjs');

  const askFromBoard = (payload: Record<string, unknown>): { code: number; body: Record<string, unknown> } => {
    const result = execFileSync('node', [ask, 'spawner', '--from-board'], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
    return { code: 0, body: JSON.parse(result) };
  };

  it('reads current with no stale-process case, by construction', async () => {
    const { code, body } = askFromBoard({
      spawnContract: 7,
      bundlePath: 'skills/plot/scripts/board/board-server.mjs',
      bundleHash: 'abc',
      runningBundleHash: 'abc',
      gateNumber: 7,
      gatePath: '/repo/skills/plot/scripts/board/plot-gate.mjs',
    });
    expect(code).toBe(0);
    expect(body.status).toBe('current');
    expect(body.bundleDrift).toBe(false);
  });

  it('reads stale with both numbers when the board and the gate disagree', async () => {
    const { code, body } = askFromBoard({
      spawnContract: 7,
      bundlePath: 'skills/plot/scripts/board/board-server.mjs',
      bundleHash: 'abc',
      runningBundleHash: 'abc',
      gateNumber: 9,
      gatePath: '/repo/skills/plot/scripts/board/plot-gate.mjs',
    });
    expect(code).toBe(0);
    expect(body.status).toBe('stale: spawn contract 7, gate expects 9');
  });

  it('reads unknown when the gate carries no number', async () => {
    const { code, body } = askFromBoard({
      spawnContract: 7,
      bundlePath: 'skills/plot/scripts/board/board-server.mjs',
      bundleHash: 'abc',
      runningBundleHash: 'abc',
      gateNumber: null,
      gatePath: '/repo/skills/plot/scripts/board/plot-gate.mjs',
    });
    expect(code).toBe(0);
    expect(body.status).toBe('unknown');
  });

  it('reports bundle drift as separate evidence when the running hash differs', async () => {
    const { code, body } = askFromBoard({
      spawnContract: 7,
      bundlePath: 'skills/plot/scripts/board/board-server.mjs',
      bundleHash: 'abc',
      runningBundleHash: 'def',
      gateNumber: 7,
      gatePath: '/repo/skills/plot/scripts/board/plot-gate.mjs',
    });
    expect(code).toBe(0);
    expect(body.status).toBe('current');
    expect(body.bundleDrift).toBe(true);
  });
});
