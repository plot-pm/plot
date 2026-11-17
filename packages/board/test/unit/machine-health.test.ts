import { describe, it, expect } from 'vitest';
import type { FleetMachine } from '../../src/contract/schema.js';
import { machineHealth } from '../../src/app/lib/agent-rows/machine-health.js';
import type { HostAnswer } from '../../src/app/lib/agent-rows/host-notes.js';

const OLD_TEXT = 'none — nothing — a machine is working';

const machine = (over: Partial<FleetMachine> = {}): FleetMachine => ({
  headroom: 'clear',
  load1: 2.1,
  cores: 10,
  host: { connector: 'github', buckets: [{ bucket: 'graphql', limit: 5000, remaining: 4210, resetAt: null }] },
  ...over,
});

describe('machineHealth', () => {
  it('shows one line and no body for a healthy machine', () => {
    const h = machineHealth(machine());
    expect(h).toEqual({ dot: 'green', word: 'healthy', line: 'load 2.1 of 10 cores · GitHub 4,210 / 5,000 left', rows: [] });
  });

  it('takes the dot from headroom, never from load', () => {
    expect(machineHealth(machine({ headroom: 'clear', load1: 14, cores: 4 })).dot).toBe('green');
    expect(machineHealth(machine({ headroom: 'starved', load1: 0.2, cores: 10 })).dot).toBe('red');
    expect(machineHealth(machine({ headroom: 'tight' })).dot).toBe('amber');
  });

  it('reads an unmeasured machine as grey "not measured", with no body', () => {
    const h = machineHealth(machine({ headroom: 'unmeasured', load1: null, cores: null }));
    expect(h.dot).toBe('grey');
    expect(h.word).toBe('not measured');
    expect(h.rows).toEqual([]);
  });

  it('reads a board that has measured nothing as not measured', () => {
    const h = machineHealth(null);
    expect([h.dot, h.word, h.rows]).toEqual(['grey', 'not measured', []]);
  });

  it('lists only the limiting resources for a strained machine', () => {
    const strained = machine({
      headroom: 'starved',
      host: { connector: 'github', buckets: [
        { bucket: 'graphql', limit: 5000, remaining: 0, resetAt: new Date(2026, 10, 17, 16, 42).getTime() },
        { bucket: 'core', limit: 5000, remaining: 4990, resetAt: null },
      ] },
    });
    const h = machineHealth(strained);
    expect(h.rows.map((r) => r.resource)).toEqual(['Machine', 'GitHub graphql']);
    expect(h.rows[1]).toEqual({ resource: 'GitHub graphql', now: '0 / 5,000, resets 16:42', effect: 'calls wait for the reset' });
    expect(h.rows.every((r) => r.effect !== '')).toBe(true);
  });

  it('gives a tight machine with no limiting host bucket one row', () => {
    expect(machineHealth(machine({ headroom: 'tight' })).rows.map((r) => r.resource)).toEqual(['Machine']);
  });

  it('keeps a spent host bucket out of the body of a healthy machine', () => {
    const h = machineHealth(machine({ host: { connector: 'github', buckets: [{ bucket: 'graphql', limit: 5000, remaining: 0, resetAt: null }] } }));
    expect(h.rows).toEqual([]);
    expect(h.line).toContain('GitHub 0 / 5,000 left');
  });

  it('names the host by the connector, not by "GitHub"', () => {
    const h = machineHealth(machine({ host: { connector: 'gitlab', buckets: [{ bucket: '', limit: 600, remaining: 590, resetAt: null }] } }));
    expect(h.line).toContain('gitlab 590 / 600 left');
    expect(h.line).not.toContain('GitHub');
  });

  it('shows a host that has not answered as not asked or as an outage, never as 0 left', () => {
    const unasked = machineHealth(machine({ host: null }), 'unasked');
    const down = machineHealth(machine({ host: null }), 'unreachable');
    expect(unasked.line).toContain('host not checked yet');
    expect(down.line).toContain('host could not reach the host');
    for (const h of [unasked, down]) expect(h.line).not.toMatch(/left|0 \//);
  });

  it('says a budget is not reported when the record has no reading', () => {
    const h = machineHealth(machine({ host: { connector: 'github', buckets: [] } }));
    expect(h.line).toContain('GitHub budget not reported');
    expect(h.line).not.toContain('0 left');
  });

  it('never yields the old text in any state', () => {
    const answers: HostAnswer[] = ['answered', 'unasked', 'unreachable'];
    const readings = [null, ...(['clear', 'tight', 'starved', 'unmeasured'] as const).map((headroom) => machine({ headroom }))];
    for (const m of readings) for (const a of answers) {
      const h = machineHealth(m, a);
      expect(JSON.stringify(h)).not.toContain('nothing — a machine is working');
      expect(h.line).not.toContain(OLD_TEXT);
    }
  });
});
