// The loopback predicate, as a value.
//
// `test/write-gate.test.mjs` asserts the GATE — that a bound server refuses and
// spawns nothing. This asserts the DECISION the gate consults, where the exact
// membership of "loopback" is testable without binding a port.
import { describe, it, expect } from 'vitest';
import { writeGate } from '../../src/server/write-gate.js';

/** An empty env — the state every normal board runs in. */
const NO_OPT_IN: NodeJS.ProcessEnv = {};
/** The variable that opened the gate on any bind until issue #3311. */
const REMOVED_OPT_IN: NodeJS.ProcessEnv = { PLOT_BOARD_ALLOW_REMOTE_WRITES: 'i-understand' };

describe('writeGate: which hosts count as loopback', () => {
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    it(`allows ${host}`, () => {
      expect(writeGate(host, NO_OPT_IN).allowed).toBe(true);
    });
  }

  it('refuses 0.0.0.0 — the wildcard bind is reachable, which is the whole point', () => {
    // Deliberately NOT loopback, and the case the gate exists for: `0.0.0.0` is
    // what the fleet user test uses to reach the board over Tailscale, and
    // "sitting at the machine that owns the worktrees" stops being true the
    // moment the address is reachable from elsewhere.
    expect(writeGate('0.0.0.0', NO_OPT_IN).allowed).toBe(false);
  });

  for (const host of ['192.168.1.10', 'board.local', '::', '127.0.0.1.evil.com']) {
    it(`refuses ${host}`, () => {
      expect(writeGate(host, NO_OPT_IN).allowed).toBe(false);
    });
  }
});

describe('writeGate: the refusal is legible', () => {
  const { reason } = writeGate('0.0.0.0', NO_OPT_IN);

  it('names the binding it refused for', () => {
    expect(reason).toContain('0.0.0.0');
  });

  it('names the boundary, so the reader learns the rule and not just the verdict', () => {
    expect(reason).toContain('loopback');
  });

  it('names the two routes that keep the board on loopback', () => {
    expect(reason).toContain('tailscale serve');
    expect(reason).toContain('PLOT_BOARD_ORIGINS');
    expect(reason).toContain('ssh -L <port>:localhost:<port> <machine>');
  });

  it('does not name the removed variable where it is not set', () => {
    expect(reason).not.toContain('PLOT_BOARD_ALLOW_REMOTE_WRITES');
  });

  it('is empty when the gate is open — there is nothing to explain', () => {
    expect(writeGate('localhost', NO_OPT_IN).reason).toBe('');
  });
});

describe('writeGate: the removed opt-in opens nothing', () => {
  it('refuses 0.0.0.0 with the old variable set, and says why it stopped working', () => {
    // A gate that only deleted the opt-in branch would refuse here too, and
    // still never tell the operator why their setting stopped working.
    const verdict = writeGate('0.0.0.0', REMOVED_OPT_IN);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('PLOT_BOARD_ALLOW_REMOTE_WRITES');
    expect(verdict.reason).toMatch(/no longer opens/);
    expect(verdict.reason).toContain('tailscale serve');
    expect(verdict.reason).toContain('PLOT_BOARD_ORIGINS');
    expect(verdict.reason).toMatch(/SSH tunnel/);
  });

  for (const value of ['1', 'true', '', 'I-UNDERSTAND']) {
    it(`refuses 0.0.0.0 with the old variable set to ${JSON.stringify(value)}`, () => {
      expect(writeGate('0.0.0.0', { PLOT_BOARD_ALLOW_REMOTE_WRITES: value }).allowed).toBe(false);
    });
  }

  for (const host of ['localhost', '127.0.0.1', '::1']) {
    it(`still allows ${host} with the old variable set, and with an empty env`, () => {
      expect(writeGate(host, REMOVED_OPT_IN)).toEqual({ allowed: true, reason: '' });
      expect(writeGate(host, {})).toEqual({ allowed: true, reason: '' });
    });
  }
});
