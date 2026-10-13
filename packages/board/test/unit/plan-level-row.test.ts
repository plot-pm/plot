import { describe, it, expect } from 'vitest';
import { verificationRows } from '../../src/app/lib/agent-rows/plan-level-row.js';
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
