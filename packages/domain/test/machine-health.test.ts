import { describe, expect, it } from 'vitest';

import { HOST_ANSWER_HINT, hostAnswer, machineHealth, type HostAnswer, type MachineReading } from '../src/rules/machine-health.js';

const OLD_TEXT = 'none — nothing — a machine is working';

const RESET = new Date(2026, 10, 19, 13, 47).getTime();

const machine = (over: Partial<MachineReading> = {}): MachineReading => ({
  headroom: 'clear',
  load1: 2.1,
  cores: 10,
  host: {
    connector: 'github',
    buckets: [
      { bucket: 'graphql', limit: 5000, remaining: 4210, resetAt: null },
      { bucket: 'core', limit: 5000, remaining: 3812, resetAt: null },
    ],
  },
  ...over,
});

const github = (...buckets: NonNullable<MachineReading['host']>['buckets']): MachineReading['host'] => ({ connector: 'github', buckets });

describe('hostAnswer', () => {
  it('reads landed PR data as answered, however the last call went', () => {
    expect(hostAnswer({ prAgeSeconds: 30, prError: 'GraphQL: API rate limit already exceeded for user ID 870334.' })).toBe('answered');
  });

  it('reads no call and no error as unasked', () => {
    expect(hostAnswer({ prAgeSeconds: null, prError: null })).toBe('unasked');
  });

  it('reads a first call refused on a spent quota or a burst as rate-limited (measured 2026-11-19)', () => {
    expect(hostAnswer({ prAgeSeconds: null, prError: 'GraphQL: API rate limit already exceeded for user ID 870334.' })).toBe('rate-limited');
    expect(hostAnswer({ prAgeSeconds: null, prError: 'You have exceeded a secondary rate limit' })).toBe('rate-limited');
  });

  it('keeps a real outage an outage', () => {
    expect(hostAnswer({ prAgeSeconds: null, prError: 'gh: 503' })).toBe('unreachable');
    expect(HOST_ANSWER_HINT.unreachable).toBe('could not reach the host');
  });
});

describe('machineHealth — the healthy line', () => {
  it('shows one line with load and each GitHub bucket, and no body', () => {
    expect(machineHealth(machine())).toEqual({
      dot: 'green',
      word: 'healthy',
      line: 'load 2.1 of 10 cores · GitHub GraphQL 4,210 / 5,000 left · REST 3,812 / 5,000 left',
      rows: [],
    });
  });

  it('names the GitHub bucket the record does not hold, rather than asking for it', () => {
    const h = machineHealth(machine({ host: github({ bucket: 'core', limit: 5000, remaining: 3812, resetAt: null }) }));
    expect(h.line).toBe('load 2.1 of 10 cores · GitHub REST 3,812 / 5,000 left · GraphQL not recorded');
  });

  it('names a host by the connector, with one pool and no bucket label', () => {
    const h = machineHealth(machine({ host: { connector: 'gitlab', buckets: [{ bucket: '', limit: 600, remaining: 590, resetAt: null }] } }));
    expect(h.line).toBe('load 2.1 of 10 cores · gitlab 590 / 600 left');
  });

  it('says a budget is not reported when the record has no reading', () => {
    const h = machineHealth(machine({ host: github() }));
    expect(h.line).toContain('GitHub budget not reported');
    expect(h.line).not.toContain('0 left');
  });
});

describe('machineHealth — a strained host budget', () => {
  it('turns an exhausted GraphQL budget amber and lists it with its reset and effect', () => {
    const exhausted = machine({
      host: github(
        { bucket: 'graphql', limit: 5000, remaining: 0, resetAt: RESET },
        { bucket: 'core', limit: 5000, remaining: 3812, resetAt: null },
      ),
    });
    for (const answer of ['answered', 'rate-limited'] as const) {
      const h = machineHealth(exhausted, answer);
      expect([h.dot, h.word]).toEqual(['amber', 'strained']);
      expect(h.line).toBe('load 2.1 of 10 cores · GitHub GraphQL 0 / 5,000 left · REST 3,812 / 5,000 left');
      expect(h.rows).toEqual([{ resource: 'GitHub GraphQL', now: '0 / 5,000, resets 13:47', effect: 'PR listings wait for the reset' }]);
    }
  });

  it('lists a low but non-zero bucket at or under a tenth of its limit, and not one above it', () => {
    const low = machineHealth(machine({ host: github({ bucket: 'core', limit: 5000, remaining: 500, resetAt: null }, { bucket: 'graphql', limit: 5000, remaining: 501, resetAt: null }) }));
    expect([low.dot, low.word]).toEqual(['amber', 'strained']);
    expect(low.rows).toEqual([{ resource: 'GitHub REST', now: '500 / 5,000', effect: 'calls may be refused before the reset' }]);
  });

  it('keeps the machine verdict where the machine is itself strained, and lists both', () => {
    const h = machineHealth(machine({ headroom: 'starved', host: github({ bucket: 'graphql', limit: 5000, remaining: 0, resetAt: RESET }) }));
    expect([h.dot, h.word]).toEqual(['red', 'starved']);
    expect(h.rows.map((r) => r.resource)).toEqual(['Machine', 'GitHub GraphQL']);
  });

  it('shows a rate-limited host with no budget record as rate-limited, never as unreachable', () => {
    const h = machineHealth(machine({ host: null }), 'rate-limited');
    expect(h.line).toBe('load 2.1 of 10 cores · host rate-limited');
    expect(h.line).not.toContain('could not reach');
  });
});

describe('machineHealth — a host that has not answered', () => {
  const spent = machine({ host: github({ bucket: 'graphql', limit: 5000, remaining: 0, resetAt: RESET }) });

  it('reads unasked as not checked yet, lists no bucket and stays healthy', () => {
    const h = machineHealth(spent, 'unasked');
    expect(h.line).toBe('load 2.1 of 10 cores · host not checked yet');
    expect([h.dot, h.rows]).toEqual(['green', []]);
  });

  it('reads an outage as an outage, lists no bucket and never reads 0 left', () => {
    const h = machineHealth(spent, 'unreachable');
    expect(h.line).toBe('load 2.1 of 10 cores · host could not reach the host');
    expect(h.rows).toEqual([]);
    expect(h.line).not.toMatch(/left|0 \//);
  });
});

describe('machineHealth — the machine verdict', () => {
  it('takes the dot from headroom, never from load', () => {
    expect(machineHealth(machine({ headroom: 'clear', load1: 14, cores: 4 })).dot).toBe('green');
    expect(machineHealth(machine({ headroom: 'starved', load1: 0.2, cores: 10 })).dot).toBe('red');
    expect(machineHealth(machine({ headroom: 'tight' })).dot).toBe('amber');
  });

  it('gives a tight machine with no limiting host bucket one row', () => {
    expect(machineHealth(machine({ headroom: 'tight' })).rows.map((r) => r.resource)).toEqual(['Machine']);
  });

  it('reads an unmeasured machine, or none at all, as grey "not measured" with no body', () => {
    for (const reading of [machine({ headroom: 'unmeasured', load1: null, cores: null }), null, undefined]) {
      const h = machineHealth(reading);
      expect([h.dot, h.word, h.rows]).toEqual(['grey', 'not measured', []]);
    }
  });

  it('never yields the old text in any state', () => {
    const answers: HostAnswer[] = ['answered', 'unasked', 'unreachable', 'rate-limited'];
    const readings = [null, ...(['clear', 'tight', 'starved', 'unmeasured'] as const).map((headroom) => machine({ headroom }))];
    for (const m of readings) for (const a of answers) {
      const h = machineHealth(m, a);
      expect(JSON.stringify(h)).not.toContain('nothing — a machine is working');
      expect(h.line).not.toContain(OLD_TEXT);
    }
  });
});
