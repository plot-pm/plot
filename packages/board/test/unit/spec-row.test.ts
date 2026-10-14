import { describe, it, expect } from 'vitest';
import { specRows } from '../../src/app/lib/agent-rows/spec-row.js';
import { DesignStatusSchema, type DesignStatus } from '../../src/contract/schema.js';

// A SPEC RUN THE FLEET MAKES ON A PLAN, NOT A BRANCH.
//
// `/api/fleet` has carried `design` since the-fleet-reads-design-work and
// nothing under `packages/board/src/app` read it — the schema's own comment
// said so. `specRows` is the one function that turns the payload into rows;
// every row field it copies from the payload must stay byte-for-byte what the
// domain's `specRow` already wrote, since the board computes no command and
// no reason of its own. The mapping is near-identity: `design.rows` is
// already shaped `{ kind: 'spec', plan, reason, log, restart, stopped,
// halted }`, field-for-field the same as `PlanLevelRow`.

const row = (overrides: Partial<DesignStatus['rows'][number]> = {}) => ({
  kind: 'spec' as const,
  plan: 'alpha',
  reason: 'the spec run failed 3 times; the fleet stopped retrying this plan',
  log: '/r/.plot/logs/plot-design-alpha.log',
  restart: 'plot-design.mjs restart alpha',
  stopped: true,
  halted: false,
  ...overrides,
});

const design = (overrides: Partial<DesignStatus> = {}): DesignStatus =>
  DesignStatusSchema.parse({
    halted: false,
    running: [],
    refusals: {},
    rows: [],
    ...overrides,
  });

describe('specRows', () => {
  it('turns one design.rows entry into one waiting row, fields copied unchanged', () => {
    const payload = design({ rows: [row()] });
    const { waiting } = specRows(payload);
    expect(waiting).toEqual([
      {
        kind: 'spec',
        plan: 'alpha',
        reason: row().reason,
        log: row().log,
        restart: row().restart,
        stopped: true,
        halted: false,
      },
    ]);
  });

  it('takes halted from the row\'s own halted, not a recomputation', () => {
    const payload = design({ halted: true, rows: [row({ halted: true })] });
    const { waiting } = specRows(payload);
    expect(waiting[0].halted).toBe(true);
  });

  it('turns one running slug into one working row with a fixed reason and no log or restart', () => {
    const payload = design({ running: ['beta'] });
    const { working } = specRows(payload);
    expect(working).toEqual([
      { kind: 'spec', plan: 'beta', reason: 'spec run running', log: null, restart: null, stopped: false, halted: false },
    ]);
  });

  it('shows a going plan once, in working, when it is also in rows with empty fields', () => {
    const payload = design({
      running: ['beta'],
      rows: [row({ plan: 'beta', reason: '', log: '', restart: '', stopped: false }), row()],
    });
    const { working, waiting } = specRows(payload);
    expect(working.map((r) => r.plan)).toEqual(['beta']);
    expect(waiting.map((r) => r.plan)).toEqual(['alpha']);
  });

  describe('haltedLine', () => {
    it('is the fixed sentence when halted and no row already carries halted: true', () => {
      const payload = design({ halted: true, rows: [row({ halted: false })] });
      const { haltedLine } = specRows(payload);
      expect(haltedLine).toBe('The fleet starts no spec run until a person restarts one.');
    });

    it('is null when halted but a row already carries halted: true — never double-report', () => {
      const payload = design({ halted: true, rows: [row({ halted: true })] });
      const { haltedLine } = specRows(payload);
      expect(haltedLine).toBeNull();
    });

    it('is null when not halted', () => {
      const payload = design({ halted: false, rows: [row({ halted: false })] });
      const { haltedLine } = specRows(payload);
      expect(haltedLine).toBeNull();
    });
  });

  it('design: null answers zero rows and no haltedLine — not a placeholder', () => {
    expect(specRows(null)).toEqual({ working: [], waiting: [], haltedLine: null });
  });
});
