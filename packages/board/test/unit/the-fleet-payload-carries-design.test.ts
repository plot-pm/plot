import { describe, it, expect } from 'vitest';
import { designPayload } from '../../src/server/fleet.js';
import { FleetShape, DesignStatusSchema } from '../../src/contract/schema.js';

/**
 * The fleet payload carries what the spec pass wrote: the halt, the runs it
 * started, its refusal per plan, and the *Waiting on you* rows with their
 * restart command. A refusal the daemon gave and no reader shows is a silent
 * skip, which the plan's Acceptance names as the failure.
 */
describe('the fleet payload carries the spec pass', () => {
  const row = {
    kind: 'spec' as const,
    plan: 'alpha',
    reason: 'spec writing failed 3 times; the fleet stopped retrying this plan',
    log: '/r/.plot/logs/plot-design-alpha.log',
    restart: 'plot-design.mjs restart alpha',
    stopped: true,
    halted: false,
  };

  it('copies the halt, the runs, the refusals and the rows', () => {
    const field = designPayload({
      halted: true,
      running: ['beta'],
      refusals: { gamma: 'no-free-agent' },
      rows: [row],
    });
    expect(field).toEqual({ halted: true, running: ['beta'], refusals: { gamma: 'no-free-agent' }, rows: [row] });
    expect(DesignStatusSchema.parse(field)).toEqual(field);
  });

  it('is null where the state file cannot be read, and a payload without it still parses', () => {
    expect(designPayload(null)).toBeNull();
    expect(FleetShape.shape.design.parse(undefined)).toBeNull();
  });
});
