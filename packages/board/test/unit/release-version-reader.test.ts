import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/** Every process start through `node:child_process`, as one command line each. */
const starts = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const wrap = <F extends (...a: never[]) => unknown>(fn: F): F => {
    const wrapped = ((...a: unknown[]) => {
      starts.lines.push([String(a[0]), ...(Array.isArray(a[1]) ? a[1].map(String) : [])].join(' '));
      return (fn as unknown as (...b: unknown[]) => unknown)(...a);
    }) as unknown as F;
    for (const key of Reflect.ownKeys(fn)) {
      if (key === 'length' || key === 'name') continue;
      Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(fn, key)!);
    }
    return wrapped;
  };
  const counted = { ...real, spawn: wrap(real.spawn), execFile: wrap(real.execFile) };
  return { ...counted, default: counted };
});

import { execFileSync } from 'node:child_process';
import { installObjectsReader, processObjects } from '@plot-pm/domain/adapters';

import { releaseVersions } from '../../src/server/fleet.js';
import { removeTree } from '../rm-tree.mjs';

const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
};

let repo = '';
let commonDir = '';

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-release-version-')));
  git(repo, 'init', '--quiet', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"version":"2.34.0"}\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'main');
  git(repo, 'checkout', '--quiet', '-b', 'changeset-release/main');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"version":"2.35.0"}\n');
  git(repo, 'commit', '--quiet', '-am', 'release');
  git(repo, 'checkout', '--quiet', 'main');
  git(repo, 'remote', 'add', 'origin', repo);
  git(repo, 'fetch', '--quiet', 'origin');
});

afterAll(() => {
  if (commonDir) processObjects.remove(commonDir);
  if (repo) removeTree(repo);
});

describe('the release-version read uses the object reader', () => {
  it('reads each release branch version and starts no git show with a reader installed', async () => {
    const done = await installObjectsReader(repo);
    if (!done.installed) throw new Error(done.refusal);
    commonDir = done.commonDir;
    starts.lines.length = 0;

    const versions = await releaseVersions({ repoRoot: repo, scriptsDir: path.join(repo, 'scripts') });

    expect(versions).toEqual(new Map([['changeset-release/main', '2.35.0']]));
    expect(starts.lines.filter((line) => line.startsWith('git show'))).toEqual([]);
    expect(starts.lines.filter((line) => line.startsWith('git cat-file'))).toEqual(['git cat-file --batch-command --buffer -z']);
  });
});
