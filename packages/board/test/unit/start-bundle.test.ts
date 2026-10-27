import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { failed } from '@plot-pm/domain';
import type { GateContractReader } from '@plot-pm/domain/ports/gate-contract';
import { rmTree } from '../helpers.mjs';
import { spawnContractReadingFor, startBundleFor, type BuildBoardOptions } from '../../src/server/board.js';

const temps: string[] = [];

/** A gate that answers nothing — this file asks only about the bundle. */
const silentGate: GateContractReader = { resolve: async () => failed(), spawnContract: async () => failed() };

afterEach(() => {
  for (const dir of temps.splice(0)) rmTree(dir);
});

const scratch = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(dir);
  return dir;
};

/** A repository that uses Plot as a plugin, and the plugin's `board/` directory outside it. */
const pluginSetup = (): { opts: BuildBoardOptions; here: string; artifact: string } => {
  const repoRoot = scratch('plot-board-start-repo-');
  execFileSync('git', ['-C', repoRoot, 'init', '--quiet', '-b', 'main']);
  const here = path.join(scratch('plot-board-start-plugin-'), 'board');
  fs.mkdirSync(here);
  const artifact = path.join(here, 'board-server.mjs');
  fs.writeFileSync(artifact, 'board-v1');
  return { opts: { repoRoot, scriptsDir: path.join(here, '..') }, here, artifact };
};

describe('the board records the artifact it runs', () => {
  it('hashes board-server.mjs in its own directory, in a repository with no skills/plot/', () => {
    const { opts, here, artifact } = pluginSetup();

    const start = startBundleFor(opts, here);

    expect(start.path).toBe(artifact);
    expect(start.hash).toBe(execFileSync('git', ['hash-object', artifact], { encoding: 'utf8' }).trim());
  });

  it('measures drift against the same artifact it recorded', async () => {
    const { opts, here, artifact } = pluginSetup();
    opts.startBundle = startBundleFor(opts, here);
    fs.writeFileSync(artifact, 'board-v2');

    const reading = await spawnContractReadingFor({ ...opts, gateContract: silentGate });

    expect(reading.bundlePath).toBe(artifact);
    expect(reading.bundleHash).not.toBeNull();
    expect(reading.runningBundleHash).not.toBeNull();
    expect(reading.runningBundleHash).not.toBe(reading.bundleHash);
  });
});
