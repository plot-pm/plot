import { describe, it, expect } from 'vitest';
import {
  planFileForSlug,
  planLevelStatus,
  sectionCount,
  verificationRows,
} from '../../src/app/lib/agent-rows/plan-level-row.js';
import { sectionTally, tallyLabel } from '../../src/app/lib/agent-rows/sections.js';
import { VerificationStatusSchema, type VerificationStatus } from '../../src/contract/schema.js';

// A RUN THE FLEET MAKES ON A PLAN, NOT A BRANCH.
//
// `/api/fleet` has carried `verification` since PR #1635 and nothing under
// `packages/board/src/app` read it — issue #1640 (H7). `verificationRows` is
// the one function that turns the payload into rows; every row field it
// copies from the payload must stay byte-for-byte what the domain wrote,
// since the board computes no command and no reason of its own.

const row = (overrides: Partial<VerificationStatus['rows'][number]> = {}) => ({
  slug: 'alpha',
  reason: 'verification failed 3 times; the fleet stopped retrying this plan',
  log: '/r/.plot/logs/plot-verify-alpha.log',
  restart: '/plot-deliver --verify alpha',
  stopped: true,
  fleetHalted: false,
  ...overrides,
});

const verification = (overrides: Partial<VerificationStatus> = {}): VerificationStatus =>
  VerificationStatusSchema.parse({
    halted: false,
    running: [],
    refusals: {},
    rows: [],
    ...overrides,
  });

describe('verificationRows', () => {
  it('turns one verification.rows entry into one waiting row, fields copied unchanged', () => {
    const payload = verification({ rows: [row()] });
    const { waiting } = verificationRows(payload);
    expect(waiting).toEqual([
      {
        kind: 'verify',
        plan: 'alpha',
        reason: row().reason,
        log: row().log,
        restart: row().restart,
        stopped: true,
        halted: false,
      },
    ]);
  });

  it('takes halted from the row\'s own fleetHalted, not a recomputation', () => {
    const payload = verification({ halted: true, rows: [row({ fleetHalted: true })] });
    const { waiting } = verificationRows(payload);
    expect(waiting[0].halted).toBe(true);
  });

  it('turns one running slug into one working row with a fixed reason and no log or restart', () => {
    const payload = verification({ running: ['beta'] });
    const { working } = verificationRows(payload);
    expect(working).toEqual([
      { kind: 'verify', plan: 'beta', reason: 'verification running', log: null, restart: null, stopped: false, halted: false },
    ]);
  });

  describe('haltedLine', () => {
    it('is the fixed sentence when halted and no row already carries halted: true', () => {
      const payload = verification({ halted: true, rows: [row({ fleetHalted: false })] });
      const { haltedLine } = verificationRows(payload);
      expect(haltedLine).toBe('The fleet starts no verify run until a person restarts one.');
    });

    it('is null when halted but a row already carries halted: true — never double-report', () => {
      const payload = verification({ halted: true, rows: [row({ fleetHalted: true })] });
      const { haltedLine } = verificationRows(payload);
      expect(haltedLine).toBeNull();
    });

    it('is null when not halted', () => {
      const payload = verification({ halted: false, rows: [row({ fleetHalted: false })] });
      const { haltedLine } = verificationRows(payload);
      expect(haltedLine).toBeNull();
    });
  });

  it('verification: null answers zero rows and no haltedLine — not a placeholder', () => {
    expect(verificationRows(null)).toEqual({ working: [], waiting: [], haltedLine: null });
  });
});

describe('planLevelStatus', () => {
  it('answers verification for a verify row that is not stopped', () => {
    expect(planLevelStatus({ kind: 'verify', stopped: false })).toBe('verification');
  });

  it('answers stopped for a stopped row of either kind', () => {
    expect(planLevelStatus({ kind: 'verify', stopped: true })).toBe('stopped');
    expect(planLevelStatus({ kind: 'spec', stopped: true })).toBe('stopped');
  });

  it('answers design, not verification, for a spec row', () => {
    expect(planLevelStatus({ kind: 'spec', stopped: false })).toBe('design');
  });
});

describe('planFileForSlug', () => {
  const cards = [
    { slug: 'alpha', path: 'docs/plans/2026-10-01-alpha.md' },
    { slug: 'beta', path: 'docs/plans/2026-10-02-beta.md' },
  ];

  it('answers the file name of the card whose slug matches', () => {
    expect(planFileForSlug(cards, 'beta')).toBe('2026-10-02-beta.md');
  });

  it('answers an empty string where no card holds the slug', () => {
    expect(planFileForSlug(cards, 'gamma')).toBe('');
    expect(planFileForSlug([], 'alpha')).toBe('');
  });
});

describe('sectionCount', () => {
  const held = (planLevel: { working: number; waiting: number }) => ({
    branches: 2, registry: 3, broken: 1, drafts: 1, planLevel,
  });
  const payload = verification({ halted: true, running: ['beta'], rows: [row()] });
  const { working, waiting, haltedLine } = verificationRows(payload);
  const withRows = held({ working: working.length, waiting: waiting.length });
  const without = held({ working: 0, waiting: 0 });

  it('counts the running plan-level row in Working', () => {
    expect(sectionCount('working', without)).toBe(3);
    expect(sectionCount('working', withRows)).toBe(4);
  });

  it('counts the failed plan-level row in Waiting on you, and not the halted line', () => {
    expect(haltedLine).not.toBeNull();
    expect(sectionCount('waiting-on-you', without)).toBe(4);
    expect(sectionCount('waiting-on-you', withRows)).toBe(5);
  });

  it('adds the failed plan-level row to the Waiting on you heading as a plan line', () => {
    const unplanned = { tickets: 0, drafts: 1, agents: 0 };
    const plain = sectionTally([], 'waiting-on-you', [], unplanned);
    const shown = sectionTally([], 'waiting-on-you', [], { ...unplanned, planLevel: waiting.length });
    expect(shown.plans).toBe(plain.plans + 1);
    expect(tallyLabel(plain)).toBe('(1 plan)');
    expect(tallyLabel(shown)).toBe('(2 plans)');
  });

  it('counts only branch rows in every other section', () => {
    expect(sectionCount('done', withRows)).toBe(2);
  });
});
