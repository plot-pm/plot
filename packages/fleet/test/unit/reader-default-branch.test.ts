import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildFixture } from '@plot-pm/domain/adapters/build/build-fixture';
import { refsFixture } from '@plot-pm/domain/adapters/refs/refs-fixture';
import { fleetdHeartbeatIn } from '@plot-pm/domain/adapters';
import { stateHomeAtSync } from '@plot-pm/domain/adapters/main-checkout';
import { DEFAULT_BRANCH_VERSION, type DefaultBranchReading } from '@plot-pm/domain/entities/default-branch';
import { FLEETD_HEARTBEAT_VERSION, type FleetdHeartbeat } from '@plot-pm/domain/entities/fleetd-heartbeat';
import type { WorkflowShaRun } from '@plot-pm/domain/entities/build';
import type { DefaultBranchStore } from '@plot-pm/domain/ports/default-branch';
import { defaultBranchAgeMs } from '@plot-pm/domain/rules/default-branch';

import { refreshOnChange, type DefaultBranchOutcome, type DefaultBranchWorld } from '../../src/shared/default-branch-refresh.js';
import { readerMainPass } from '../../src/shared/default-branch-world.js';
import { run } from '../../src/server/entry/pr-reader.js';
import { removeTree } from '../rm-tree.mjs';

const WAIT = 3_600_000;
const T0 = Date.parse('2026-11-24T10:00:00.000Z');
/** The age of the reading measured on 2026-11-23, when the fleet had been stopped for 76 h. */
const STALE_MS = 274_665_000;

const green = (workflow: string): WorkflowShaRun =>
  ({ sha: 'a1', status: 'completed', conclusion: 'success', url: `https://ci/${workflow}`, workflow }) as WorkflowShaRun;

/** A green reading of `a1`, last answered `STALE_MS` before `T0`. */
const staleReading = (): DefaultBranchReading => {
  const old = new Date(T0 - STALE_MS).toISOString();
  return {
    v: DEFAULT_BRANCH_VERSION,
    branch: 'main',
    headSha: 'a1',
    head: 'green',
    settled: { sha: 'a1', state: 'green' },
    failingRuns: [],
    headSince: old,
    askedAt: old,
    at: old,
  } as DefaultBranchReading;
};

const fleetdBeat = (beatAt: number): FleetdHeartbeat => ({
  version: FLEETD_HEARTBEAT_VERSION, pid: 1, startedAt: beatAt - 1_000_000, beatAt, generation: 1, bridgeAt: null,
  supervised: 'none', watchesWanted: 0, watchesArmed: 0, lastEventAt: null, lastSafetyNetAt: null, loops: {},
});

/** fleetd's refresh over an in-memory file, a tip of `a1` and a CI that answers green or fails. */
const rig = (initial: DefaultBranchReading | null, ciFails = false) => {
  let file = initial;
  let asks = 0;
  const store: DefaultBranchStore = {
    read: async () => ({ ok: true, value: file }),
    write: async (reading) => {
      file = reading;
      return { ok: true, value: undefined };
    },
  };
  const world: DefaultBranchWorld = {
    branch: async () => 'main',
    refs: {
      remoteSha: async () => refsFixture({ remoteTips: { main: 'a1' } }).remoteSha('main'),
      firstParentLine: (sha, max) => refsFixture({ firstParentLine: [] }).firstParentLine(sha, max),
      firstParentCommits: (range) => refsFixture({}).firstParentCommits(range),
    },
    build: {
      system: () => 'github-actions',
      runsForSha: (branch, sha) =>
        buildFixture({
          workflowRuns: { [branch]: { a1: [green('CI')] } },
          onRunsForSha: () => {
            asks += 1;
          },
          fails: ciFails,
        }).runsForSha(branch, sha),
    },
    store,
    slot: async (call) => call(),
    now: () => T0,
    checksWaitMs: WAIT,
    checks: [],
  };
  const refresh = refreshOnChange(world, async () => null);
  return { refresh, stored: () => file, asks: () => asks };
};

describe('the board reader writes the default-branch reading while no fleetd runs', () => {
  it('replaces a reading 274665 s old with one asked now, when no fleetd heartbeat exists and the reader holds the lock', async () => {
    const r = rig(staleReading());
    const pass = readerMainPass(r.refresh, { fleetd: () => null, holdsLock: async () => true, now: () => T0 });
    expect(await pass()).toBe('asked');
    expect(r.asks()).toBe(1);
    expect(r.stored()).toMatchObject({ headSha: 'a1', head: 'green', askedAt: new Date(T0).toISOString() });
    expect(defaultBranchAgeMs(r.stored()!, T0)).toBe(0);
  });

  it('writes nothing and asks no CI while fleetd\'s heartbeat reads live', async () => {
    const r = rig(staleReading());
    const pass = readerMainPass(r.refresh, { fleetd: () => fleetdBeat(T0 - 1_000), holdsLock: async () => true, now: () => T0 });
    expect(await pass()).toBe('yielded');
    expect(r.asks()).toBe(0);
    expect(r.stored()).toEqual(staleReading());
  });

  it('writes again once fleetd\'s heartbeat has gone stale', async () => {
    const r = rig(staleReading());
    const pass = readerMainPass(r.refresh, { fleetd: () => fleetdBeat(T0 - 600_000), holdsLock: async () => true, now: () => T0 });
    expect(await pass()).toBe('asked');
    expect(r.stored()?.askedAt).toBe(new Date(T0).toISOString());
  });

  it('writes nothing where another process holds the reader lock', async () => {
    const r = rig(staleReading());
    const pass = readerMainPass(r.refresh, { fleetd: () => null, holdsLock: async () => false, now: () => T0 });
    expect(await pass()).toBe('yielded');
    expect(r.asks()).toBe(0);
    expect(r.stored()).toEqual(staleReading());
  });

  it('keeps askedAt where the CI ask fails, and moves only at', async () => {
    const r = rig(staleReading(), true);
    const pass = readerMainPass(r.refresh, { fleetd: () => null, holdsLock: async () => true, now: () => T0 });
    expect(await pass()).toBe('asked');
    expect(r.stored()).toMatchObject({
      head: 'unknown',
      askedAt: staleReading().askedAt,
      at: new Date(T0).toISOString(),
    });
  });
});

describe('run — the reader runs the default-branch pass after its PR pass', () => {
  const sandbox = (beat: boolean) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-pr-reader-main-'));
    const repo = path.join(root, 'repo');
    const scripts = path.join(root, 'installed-scripts');
    const lockDir = path.join(root, 'index');
    fs.mkdirSync(repo);
    fs.mkdirSync(scripts);
    fs.mkdirSync(lockDir);
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    fs.writeFileSync(path.join(scripts, 'plot-host.sh'), '#!/usr/bin/env bash\ncase "$1" in\n  backend) echo github ;;\nesac\nexit 0\n');
    fs.chmodSync(path.join(scripts, 'plot-host.sh'), 0o755);
    fs.writeFileSync(path.join(scripts, 'plot-config.sh'), `#!/usr/bin/env bash\nprintf '%s\\n' "$3"\n`);
    fs.chmodSync(path.join(scripts, 'plot-config.sh'), 0o755);
    return { root, repo, scripts, lockDir, beat };
  };

  const once = async (beat: boolean): Promise<number> => {
    const box = sandbox(beat);
    let refreshes = 0;
    const before = process.env.PLOT_PR_INDEX_HOME;
    process.env.PLOT_PR_INDEX_HOME = box.lockDir;
    try {
      if (beat) await fleetdHeartbeatIn(stateHomeAtSync(box.repo)).write(fleetdBeat(Date.now()));
      const composeMain = async (): Promise<() => Promise<DefaultBranchOutcome>> => async () => {
        refreshes += 1;
        return 'asked';
      };
      expect(
        await run(
          { lockDir: box.lockDir, connector: 'github' },
          box.repo,
          box.scripts,
          () => undefined,
          () => false,
          () => false,
          () => true,
          undefined,
          undefined,
          composeMain,
        ),
      ).toBe(0);
      return refreshes;
    } finally {
      if (before === undefined) delete process.env.PLOT_PR_INDEX_HOME;
      else process.env.PLOT_PR_INDEX_HOME = before;
      removeTree(box.root);
    }
  };

  it('refreshes the default branch once on its one pass when no fleetd runs', async () => {
    expect(await once(false)).toBe(1);
  }, 15_000);

  it('does not refresh the default branch when fleetd\'s heartbeat is live', async () => {
    expect(await once(true)).toBe(0);
  }, 15_000);
});
