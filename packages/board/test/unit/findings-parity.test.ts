import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deskFs } from '@plot-pm/domain/adapters';
import { findingsFor } from '../../src/server/findings.js';
import { rmTree } from '../helpers.mjs';

let desk = '';
beforeAll(() => {
  desk = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-findings-parity-'));
});
afterAll(() => rmTree(desk));

describe('the board and the relay read one parser', () => {
  it('return equal findings for one fixture log', async () => {
    const line = (o: object) =>
      JSON.stringify({
        monitor: 'AgentMonitor',
        branch: 'feature/one',
        worktree: desk,
        finding: 'owes a review',
        since: '2026-10-10T09:00:00Z',
        evidence: 'e',
        measuredAt: '2026-10-10T09:00:00Z',
        ...o,
      });
    fs.writeFileSync(
      path.join(desk, '.plot-worker.monitor.agent.jsonl'),
      [line({ evidence: 'old' }), 'garbage', line({ evidence: 'new' }), line({ branch: 'feature/b' }), line({ branch: 'feature/b', finding: 'clear' }), '{"trunc'].join('\n'),
    );
    const relay = await deskFs({} as never).readFindings(desk);
    expect(relay.ok).toBe(true);
    expect(findingsFor(desk, 'feature/one')).toEqual(relay.ok ? relay.value.filter((f) => f.branch === 'feature/one') : []);
    expect(findingsFor(desk, 'feature/one')).toHaveLength(1);
  });
});
