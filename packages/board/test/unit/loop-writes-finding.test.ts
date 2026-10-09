// THE ONE CROSS-PACKAGE ASSERTION loop-writes.test.ts cannot make from
// `@plot-pm/fleet`: that a `worker-finding` write lands a line the BOARD'S OWN
// reader parses as a finding. `performLoopWrites` moved to
// `@plot-pm/fleet/server/entry/loop-writes` with the rest of the fleet's
// entries (#1414); `findingsInLog`/`MONITOR_LOGS` stayed here, in
// `../../src/server/findings.ts`, deliberately scoped to the board's own file
// read. Fleet does not and must not depend on `@plot-pm/board`, so this one
// assertion — unlike its 23 siblings, which stayed in fleet's own
// `test/unit/loop-writes.test.ts` and never touch a board import — reads
// through the package boundary instead: `performLoopWrites` from fleet,
// `findingsInLog`/`FindingSchema` from board.
import { describe, it, expect } from 'vitest';
import { deskFs, treesFixture } from '@plot-pm/domain/adapters';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performLoopWrites, type LoopWrite, type LoopWritePorts } from '@plot-pm/fleet/server/entry/loop-writes';
import { agentsFixture, deskFixture, refsFixture, refusedSlicesFixture } from '@plot-pm/domain/adapters';
import { findingsInLog, MONITOR_LOGS } from '../../src/server/findings.js';
import { FindingSchema } from '../../src/contract/index.js';
import { rmTree } from '../helpers.mjs';

const noProcesses = {
  isAlive: async () => ({ ok: true as const, value: false }),
  workerState: async () => ({ ok: false as const, why: 'failed' as const }),
  startedAt: async () => ({ ok: false as const, why: 'failed' as const }),
  uptimeSeconds: async () => ({ ok: false as const, why: 'failed' as const }),
  childrenOf: async () => ({ ok: true as const, value: [] }),
};
const noBoundedRun = { boundedSince: async () => ({ ok: true as const, value: null }) };

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
