// A `worker-finding` write from the fleet's loop lands a line the board's own
// reader parses as a finding. The writer is `@plot-pm/fleet`'s
// `performLoopWrites` and the reader is the board's `findingsInLog`, so this
// assertion lives in the board: the fleet does not import the board. The other
// write kinds are tested in packages/fleet/test/unit/loop-writes.test.ts.
import { describe, it, expect } from 'vitest';
import {
  agentsFixture,
  deskFixture,
  deskFs,
  refsFixture,
  treesFixture,
  refusedSlicesFixture,
} from '@plot-pm/domain/adapters';
import type { BoundedRun } from '@plot-pm/domain';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performLoopWrites, type LoopWrite, type LoopWritePorts } from '@plot-pm/fleet/server/entry/loop-writes';
import { findingsInLog, MONITOR_LOGS } from '../../src/server/findings.js';
import { FindingSchema } from '../../src/contract/index.js';
import { rmTree } from '../helpers.mjs';

/** A `Processes` double that answers nothing — unused by this write kind. */
const noProcesses = {
  isAlive: async () => ({ ok: true as const, value: false }),
  workerState: async () => ({ ok: false as const, why: 'failed' as const }),
  startedAt: async () => ({ ok: false as const, why: 'failed' as const }),
  uptimeSeconds: async () => ({ ok: true as const, value: null }),
  childrenOf: async () => ({ ok: true as const, value: [] }),
};

/** A `BoundedRun` double that is never called by `performLoopWrites`. */
const noBoundedRun: BoundedRun = {
  run: async () => ({ ok: false, why: 'failed' }),
};

const ports = (over: Partial<LoopWritePorts> = {}): LoopWritePorts => ({
  trees: treesFixture(),
  agents: agentsFixture(),
  desk: deskFixture(),
  refs: refsFixture(),
  processes: noProcesses,
  boundedRun: noBoundedRun,
  refusedSlices: refusedSlicesFixture(),
  ...over,
});

describe('performLoopWrites — the finding the board reads back', () => {
  it('worker-finding lands a line the board reads as a finding', async () => {
    const desk = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-loop-writes-finding-'));
    try {
      const write: LoopWrite = {
        kind: 'worker-finding',
        worktree: desk,
        branch: 'infra/x',
        finding: 'gone',
        since: '2026-10-05T10:00:00.000Z',
        evidence: 'the prompt exceeded the 28800s bound',
      };
      const [{ result }] = await performLoopWrites([write], ports({ desk: deskFs(treesFixture()) }), desk);
      expect(result.ok).toBe(true);
      const read = MONITOR_LOGS.flatMap((name) => findingsInLog(path.join(desk, name)));
      expect(read).toHaveLength(1);
      expect(FindingSchema.parse(read[0])).toMatchObject({
        monitor: 'WorkerMonitor',
        branch: 'infra/x',
        worktree: desk,
        finding: 'gone',
        since: '2026-10-05T10:00:00.000Z',
      });
    } finally {
      rmTree(desk);
    }
  });
});
