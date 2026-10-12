import { describe, it, expect } from 'vitest';
import { verificationPayload } from '../../src/server/fleet.js';
import { FleetShape, VerificationStatusSchema } from '../../src/contract/schema.js';

/**
 * The fleet payload carries what the verify pass wrote: the halt, the runs it
 * started, its refusal per plan, and the *Waiting on you* rows with their
 * restart command. A refusal the daemon gave and no reader shows is a silent
 * skip, which the plan's Acceptance names as the failure.
 */
describe('the fleet payload carries the verify pass', () => {
  const row = {
    slug: 'alpha',
    reason: 'verification failed 3 times; the fleet stopped retrying this plan',
    log: '/r/.plot/logs/plot-verify-alpha.log',
    restart: '/plot-deliver --verify alpha',
    stopped: true,
    fleetHalted: false,
  };

  it('copies the halt, the runs, the refusals and the rows', () => {
    const field = verificationPayload({
      halted: true,
      running: ['beta'],
      refusals: { gamma: 'no-free-agent' },
      rows: [row],
      last: { alpha: { startedAt: 1, endedAt: 2, settlement: { settle: 'failure', why: 'the run exited 1' } } },
    });
    expect(field).toEqual({ halted: true, running: ['beta'], refusals: { gamma: 'no-free-agent' }, rows: [row] });
    expect(VerificationStatusSchema.parse(field)).toEqual(field);
  });

  it('is null where the state file cannot be read, and a payload without it still parses', () => {
    expect(verificationPayload(null)).toBeNull();
    expect(FleetShape.shape.verification.parse(undefined)).toBeNull();
  });
});
