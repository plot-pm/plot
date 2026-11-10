import { describe, it, expect } from 'vitest';
import { rowsFromPulse } from '../../src/server/fleet.js';
import type { PrRecord } from '../../src/server/fleet.js';
import { WaitingGroupSchema, type AgentRow, type FleetReading } from '../../src/contract/schema.js';
import { rowsBySection } from '../../src/app/lib/agent-rows/sections.js';
import { claimedWithoutWorkerRows } from '../../src/app/lib/agent-rows/working-agents.js';

// EVERY BRANCH ROW IS DRAWN IN ONE SECTION.
//
// WORKING draws from the registry, and a claimed or `wip` branch no registry
// entry names reaches it as a `no-known-worker` row. The section a row is
// filed under is its `group`; the extra drawer for WORKING is
// `claimedWithoutWorkerRows`. A row selected by two drawers shows twice, and a
// row selected by none is invisible.

const QUIET = 30;

const pulse: FleetReading = {
  main: 'main',
  head: 'abc1234',
  plans: [{
    file: '2026-11-04-example-plan.md',
    phase: 'approved',
    slices: [{
      name: 'Implementation',
      verdict: 'eligible',
      branches: [
        { branch: 'feature/claimed-fresh', state: 'claimed', deferred: false, claimed: 'someone' },
        { branch: 'feature/wip-fresh', state: 'wip', deferred: false, claimed: '' },
      ],
    }],
  }],
  summary: { plans: 1, waves: 1, branches: 2, claimed: 1, eligible: 1, blocked: 0, deferred: 0 },
};

const ages = new Map<string, number | null>([
  ['feature/claimed-fresh', 5],
  ['feature/wip-fresh', 5],
  ['bug/commits-only', 5],
]);

const prs = new Map<string, PrRecord>();
const unmerged = new Set(['feature/claimed-fresh', 'feature/wip-fresh', 'bug/commits-only']);

const build = (): AgentRow[] => rowsFromPulse(
  pulse, ages, 'plot', QUIET, prs, '', null, Date.now(), null, null, null, null, null, '', null,
  unmerged,
);

/** The sections whose drawers select `row`, WORKING's claimed drawer included. */
const drawnIn = (row: AgentRow, all: AgentRow[]): string[] => WaitingGroupSchema.options
  .map((key) => key)
  .filter((key) => (key === 'working'
    ? claimedWithoutWorkerRows(all).includes(row)
    : all.some((r) => r === row && r.group === key)));

describe('a claimed or wip branch with no known worker is drawn once', () => {
  it('reads working with startability no-known-worker, for a claim and for wip', () => {
    const rows = build();
    for (const branch of ['feature/claimed-fresh', 'feature/wip-fresh']) {
      const row = rows.find((r) => r.branch === branch)!;
      expect(row.group).toBe('working');
      expect(row.startability).toBe('no-known-worker');
    }
  });

  it('is selected by exactly one drawer after the section pass', () => {
    const sectioned = rowsBySection(build());
    for (const row of sectioned.filter((r) => r.startability === 'no-known-worker')) {
      expect(drawnIn(row, sectioned)).toEqual(['working']);
    }
  });

  it('files a ref-only wip branch no plan names in QUIET alone, with no startability', () => {
    const sectioned = rowsBySection(build());
    const row = sectioned.find((r) => r.branch === 'bug/commits-only')!;
    expect(row.group).toBe('quiet');
    expect(row.quietKind).toBe('abandoned');
    expect(row.startability).toBeNull();
    expect(claimedWithoutWorkerRows(sectioned)).not.toContain(row);
    expect(drawnIn(row, sectioned)).toEqual(['quiet']);
  });
});
