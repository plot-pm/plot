// The loopback predicate and its opt-in, as values.
//
// `test/write-gate.test.mjs` asserts the GATE — that a bound server refuses and
// spawns nothing. This asserts the DECISION the gate consults, where the exact
// membership of "loopback" and the exactness of the opt-in are testable without
// binding a port.
import { describe, it, expect } from 'vitest';
import {
  ALLOW_REMOTE_ENV,
  ALLOW_REMOTE_VALUE,
  remoteWritesAllowed,
  writeGate,
} from '../../src/server/write-gate.js';

/** No opt-in present — the state every normal board runs in. */
const NO_OPT_IN: NodeJS.ProcessEnv = {};
const OPTED_IN: NodeJS.ProcessEnv = { [ALLOW_REMOTE_ENV]: ALLOW_REMOTE_VALUE };

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

  it('names the escape exactly, including its value', () => {
    // A bare 403 sends a developer who bound wide for a reason to the source.
    // The message is the only part of a gate they will read, so it carries the
    // literal variable AND value — not a description of one.
    expect(reason).toContain(`${ALLOW_REMOTE_ENV}=${ALLOW_REMOTE_VALUE}`);
  });

  it('says what the escape costs, so it is not set casually', () => {
    expect(reason).toMatch(/claim branches|start agents|approve plans/);
  });

  it('is empty when the gate is open — there is nothing to explain', () => {
    expect(writeGate('localhost', NO_OPT_IN).reason).toBe('');
  });
});

describe('remoteWritesAllowed: the opt-in must be typed knowingly', () => {
  it('opens on the exact named value', () => {
    expect(remoteWritesAllowed(OPTED_IN)).toBe(true);
    expect(writeGate('0.0.0.0', OPTED_IN).allowed).toBe(true);
  });

  for (const guess of ['1', 'true', 'yes', 'on', '', 'I-UNDERSTAND', 'i understand']) {
    it(`stays shut for ${JSON.stringify(guess)} — a guess is not consent`, () => {
      // The VALUE is checked, never merely the presence of the variable. These
      // are what a person types when guessing at a flag, and guessing is the
      // failure mode a deliberate opt-in exists to prevent.
      expect(remoteWritesAllowed({ [ALLOW_REMOTE_ENV]: guess })).toBe(false);
      expect(writeGate('0.0.0.0', { [ALLOW_REMOTE_ENV]: guess }).allowed).toBe(false);
    });
  }

  it('the opt-in cannot be read as a convenience', () => {
    // The brief's constraint: a flag that reads like a convenience will be set
    // by someone who has not thought about it. Both halves of the name say what
    // it does — remote, writes — and the value is a sentence rather than a
    // switch.
    expect(ALLOW_REMOTE_ENV).toMatch(/REMOTE/);
    expect(ALLOW_REMOTE_ENV).toMatch(/WRITES/);
    expect(ALLOW_REMOTE_VALUE).not.toMatch(/^(1|true|yes|on)$/i);
  });
});
