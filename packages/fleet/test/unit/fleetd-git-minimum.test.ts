import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { run } from '../../src/server/entry/registryd-main.js';
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

/** Runs `body` with a `git` on `PATH` that answers `--version` with `version` and runs the real git otherwise. */
const withGitVersion = async <T>(version: string, body: () => Promise<T>): Promise<T> => {
  const bin = scratch('plot-fleetd-git-');
  const real = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(
    path.join(bin, 'git'),
    `#!/bin/sh\n[ "$1" = "--version" ] && { echo "git version ${version}"; exit 0; }\nexec "${real}" "$@"\n`,
    { mode: 0o755 },
  );
  const before = process.env.PATH;
  process.env.PATH = `${bin}:${before ?? ''}`;
  try {
    return await body();
  } finally {
    process.env.PATH = before;
  }
};

/** Starts fleetd's loop in a fresh repository and stops it before its first tick. */
const start = async (): Promise<{ code: number; warnings: string[] }> => {
  const repo = scratch('plot-fleetd-git-repo-');
  execFileSync('git', ['-C', repo, 'init', '--quiet', '-b', 'main']);
  const warnings: string[] = [];
  const code = await run([], repo, () => {}, async () => {}, () => true, (s) => warnings.push(s), repo);
  return { code, warnings };
};

describe('fleetd refuses a git older than 2.42', () => {
  it('refuses the start on git 2.41.0, naming 2.42 and the version found', async () => {
    const { code, warnings } = await withGitVersion('2.41.0', start);

    expect(code).toBe(1);
    expect(warnings).toEqual(['plot-fleetd: plot needs git 2.42 or later for its object reader; found git 2.41.0\n']);
  });

  it('starts on git 2.42.0', async () => {
    const { code, warnings } = await withGitVersion('2.42.0', start);

    expect(code).toBe(0);
    expect(warnings.filter((w) => w.includes('git 2.42'))).toEqual([]);
  });
});
