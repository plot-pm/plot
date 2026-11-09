// `startImplement` with `detached`: the pid the lock holds, and where the exit lands.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  heldImplementLock,
  implementBranchStatePath,
  implementLogPath,
  implementRunning,
  implementStatePath,
  startImplement,
} from '@plot-pm/fleet/shared/implement-run';
import { endHeldRuns, parseRunMarker, readRunState } from '../../src/server/board-run.js';
import { rmTree } from '../helpers.mjs';

const SCRIPTS = path.resolve(__dirname, '../../../../skills/plot/scripts');
const made: string[] = [];
afterEach(() => {
  while (made.length) {
    const d = made.pop();
    if (d) rmTree(d);
  }
});

const waitFor = async (done: () => boolean, ms = 10_000): Promise<void> => {
  for (const end = Date.now() + ms; Date.now() < end && !done(); ) await new Promise((r) => setTimeout(r, 50));
};

describe('startImplement, detached', () => {
  it('holds the lock under the run, books the exit in both state files, and frees the lock', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-implement-detached-'));
    made.push(parent);
    const repoRoot = path.join(parent, 'repo');
    fs.mkdirSync(repoRoot, { recursive: true });
    const slug = 'a-detached-implement';
    const branch = 'feature/a-detached-implement-one';
    const readCfg = (_o: unknown, key: string, fallback: string): string =>
      key === 'Agent runner' ? 'command' : fallback;
    const started = startImplement(
      { repoRoot, scriptsDir: SCRIPTS },
      slug,
      'echo ran; sleep 4; exit 4 #',
      undefined,
      readCfg,
      branch,
      {},
      true,
    );
    assert.ok('log' in started, JSON.stringify(started));
    const statePath = implementStatePath(repoRoot, slug);
    const branchState = implementBranchStatePath(repoRoot, slug, branch);
    await waitFor(() => (parseRunMarker(fs.readFileSync(statePath, 'utf8'))?.detached ?? false));
    const pid = parseRunMarker(fs.readFileSync(statePath, 'utf8'))!.pid;
    await waitFor(() => heldImplementLock(repoRoot, slug)?.pid === pid);

    // The lock names the run, not the board: a second start reads it as held.
    assert.equal(heldImplementLock(repoRoot, slug)?.pid, pid);
    assert.equal(implementRunning(repoRoot, slug), true);
    const second = startImplement({ repoRoot, scriptsDir: SCRIPTS }, slug, 'true', undefined, readCfg, branch, {}, true);
    assert.ok('failure' in second && second.failure.running === true, JSON.stringify(second));

    // A board stop must not overwrite what the launcher owns.
    endHeldRuns(143);
    await waitFor(() => /^\d+$/.test(fs.readFileSync(statePath, 'utf8').trim()));
    await waitFor(() => /^\d+$/.test(fs.readFileSync(branchState, 'utf8').trim()));
    assert.equal(fs.readFileSync(statePath, 'utf8').trim(), '4');
    assert.equal(fs.readFileSync(branchState, 'utf8').trim(), '4');
    assert.deepEqual(readRunState(statePath, implementLogPath(repoRoot, slug)).state, 'failed');
    await waitFor(() => !implementRunning(repoRoot, slug));
    assert.equal(implementRunning(repoRoot, slug), false);
  });
});
