import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fleetdBundlePath, fleetdStartRecord } from '../../src/server/entry/registryd-main.js';
import { removeTree } from '../rm-tree.mjs';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) removeTree(dir);
});

const scratch = (prefix: string): string => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(dir);
  return dir;
};

/** A repository that uses Plot as a plugin: a git checkout with no `skills/plot/` of its own. */
const pluginRepo = (): string => {
  const repoRoot = scratch('plot-fleetd-start-repo-');
  execFileSync('git', ['-C', repoRoot, 'init', '--quiet', '-b', 'main']);
  return repoRoot;
};

/** The plugin install: a `board/` directory outside the repository that holds the artifact fleetd runs. */
const pluginInstall = (content = 'fleetd-v1'): string => {
  const here = path.join(scratch('plot-fleetd-start-plugin-'), 'board');
  fs.mkdirSync(here);
  fs.writeFileSync(path.join(here, 'plot-fleetd.mjs'), content);
  return here;
};

describe('fleetd records the artifact it runs', () => {
  it('writes a start record in a repository with no skills/plot/, naming the artifact outside it', () => {
    const repoRoot = pluginRepo();
    const here = pluginInstall();
    expect(fs.existsSync(path.join(repoRoot, 'skills'))).toBe(false);

    const record = fleetdStartRecord(repoRoot, here, path.join(here, '..'), 4242, 1000);

    const artifact = path.join(here, 'plot-fleetd.mjs');
    expect(record).not.toBeNull();
    expect(record?.bundlePath).toBe(artifact);
    expect(record?.bundleHash).toBe(execFileSync('git', ['hash-object', artifact], { encoding: 'utf8' }).trim());
    expect(record?.pid).toBe(4242);
  });

  it('names the absolute path of plot-fleetd.mjs in its own directory', () => {
    expect(fleetdBundlePath('/opt/plugin/skills/plot/scripts/board')).toBe('/opt/plugin/skills/plot/scripts/board/plot-fleetd.mjs');
  });

  it('writes no record when the artifact it runs is gone', () => {
    const repoRoot = pluginRepo();
    const here = path.join(scratch('plot-fleetd-start-empty-'), 'board');
    fs.mkdirSync(here);

    expect(fleetdStartRecord(repoRoot, here, path.join(here, '..'), 4242, 1000)).toBeNull();
  });
});
