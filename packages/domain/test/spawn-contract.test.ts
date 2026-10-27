import { describe, expect, it } from 'vitest';
import {
  SPAWN_CONTRACT,
  SPAWN_CONTRACT_ENV,
  bundleDriftDetected,
  bundleDriftEntry,
  bundleDriftText,
  spawnContractEnv,
  spawnContractReading,
  spawnerStatus,
  spawnerStatusEntry,
  spawnerStatusLines,
  spawnerStatusText,
} from '../src/rules/spawn-contract.js';

describe('spawnContractEnv', () => {
  it('carries SPAWN_CONTRACT under SPAWN_CONTRACT_ENV', () => {
    expect(spawnContractEnv()).toEqual({ [SPAWN_CONTRACT_ENV]: String(SPAWN_CONTRACT) });
  });
});

describe('spawnContractReading', () => {
  it('reads an unset variable as absent', () => {
    expect(spawnContractReading({})).toBe('absent');
  });

  it('reads a variable set to the empty string as empty', () => {
    expect(spawnContractReading({ [SPAWN_CONTRACT_ENV]: '' })).toBe('empty');
  });

  it.each(['x', '0'])('reads %s as unreadable', (value) => {
    expect(spawnContractReading({ [SPAWN_CONTRACT_ENV]: value })).toBe('unreadable');
  });

  it('reads a positive integer string as its number', () => {
    expect(spawnContractReading({ [SPAWN_CONTRACT_ENV]: '3' })).toEqual({ number: 3 });
  });
});

describe('spawnerStatus', () => {
  it('reads current when the recorded number equals the gate', () => {
    expect(spawnerStatus({ pid: 42, spawnContract: 3 }, 42, 3)).toEqual({ kind: 'current' });
  });

  it('reads stale when the spawner is behind the gate', () => {
    expect(spawnerStatus({ pid: 42, spawnContract: 2 }, 42, 3)).toEqual({
      kind: 'stale',
      spawnerNumber: 2,
      gateNumber: 3,
    });
  });

  it('reads stale when the spawner is ahead of the gate', () => {
    expect(spawnerStatus({ pid: 42, spawnContract: 5 }, 42, 3)).toEqual({
      kind: 'stale',
      spawnerNumber: 5,
      gateNumber: 3,
    });
  });

  it('reads unknown when there is no record', () => {
    expect(spawnerStatus(null, 42, 3)).toEqual({ kind: 'unknown' });
  });

  it('reads unknown when the recorded pid does not match the running pid', () => {
    expect(spawnerStatus({ pid: 42, spawnContract: 3 }, 99, 3)).toEqual({ kind: 'unknown' });
  });

  it('reads unknown when the gate did not answer', () => {
    expect(spawnerStatus({ pid: 42, spawnContract: 3 }, 42, null)).toEqual({ kind: 'unknown' });
  });

  it('takes no port and causes no process action — it is a pure comparison of plain values', () => {
    // spawnerStatus's signature is (SpawnerIdentity | null, number, number | null) => SpawnerStatusVerdict.
    // There is no processes/host/adapter parameter to call, so calling it twice with the
    // same inputs must yield the same output with nothing else observable changing.
    const first = spawnerStatus({ pid: 42, spawnContract: 2 }, 42, 3);
    const second = spawnerStatus({ pid: 42, spawnContract: 2 }, 42, 3);
    expect(first).toEqual(second);
  });
});

describe('spawnerStatusText', () => {
  it('renders current', () => {
    expect(spawnerStatusText({ kind: 'current' })).toBe('current');
  });

  it('renders stale naming both numbers', () => {
    expect(spawnerStatusText({ kind: 'stale', spawnerNumber: 2, gateNumber: 3 })).toBe(
      'stale: spawn contract 2, gate expects 3',
    );
  });

  it('renders unknown', () => {
    expect(spawnerStatusText({ kind: 'unknown' })).toBe('unknown');
  });
});

describe('spawnerStatusEntry', () => {
  it('is null for current', () => {
    expect(spawnerStatusEntry({ kind: 'current' })).toBeNull();
  });

  it('is null for unknown', () => {
    expect(spawnerStatusEntry({ kind: 'unknown' })).toBeNull();
  });

  it('is a rose entry for stale', () => {
    expect(spawnerStatusEntry({ kind: 'stale', spawnerNumber: 2, gateNumber: 3 })).toEqual({
      key: 'spawn-contract-stale',
      severity: 20,
      tone: 'rose',
      text: 'stale: spawn contract 2, gate expects 3',
    });
  });
});

describe('bundleDriftDetected', () => {
  it('is false when hashes match', () => {
    expect(bundleDriftDetected('abc', 'abc')).toBe(false);
  });

  it('is true when hashes differ', () => {
    expect(bundleDriftDetected('abc', 'def')).toBe(true);
  });

  it('is false when the recorded hash is absent', () => {
    expect(bundleDriftDetected(null, 'def')).toBe(false);
  });

  it('is false when the running hash is absent', () => {
    expect(bundleDriftDetected('abc', null)).toBe(false);
  });

  it('is evidence only, never folded into a stale verdict with equal contract numbers', () => {
    // A rebuild that changes the bundle's bytes but not SPAWN_CONTRACT is drift,
    // not staleness — the two stay on separate lines.
    const status = spawnerStatus({ pid: 1, spawnContract: 3 }, 1, 3);
    const drifted = bundleDriftDetected('abc', 'def');
    expect(status).toEqual({ kind: 'current' });
    expect(drifted).toBe(true);
  });
});

describe('bundleDriftText', () => {
  it('names the path and marks itself as evidence, not the verdict', () => {
    expect(bundleDriftText('/tmp/bundle.mjs')).toBe('bundle differs from /tmp/bundle.mjs (evidence, not the verdict)');
  });
});

describe('spawnerStatusLines', () => {
  it('prints the verdict line alone, indented, when nothing drifted', () => {
    expect(spawnerStatusLines({ kind: 'current' }, null)).toBe('  spawn contract: current\n');
  });

  it('prints the drift line after the verdict line when the bundle drifted', () => {
    expect(spawnerStatusLines({ kind: 'stale', spawnerNumber: 1, gateNumber: 2 }, 'bundle differs from /b.mjs (evidence, not the verdict)')).toBe(
      '  spawn contract: stale: spawn contract 1, gate expects 2\n  bundle differs from /b.mjs (evidence, not the verdict)\n',
    );
  });
});

describe('bundleDriftEntry', () => {
  it('is null when not drifted', () => {
    expect(bundleDriftEntry(false, '/tmp/bundle.mjs')).toBeNull();
  });

  it('is an amber entry when drifted', () => {
    expect(bundleDriftEntry(true, '/tmp/bundle.mjs')).toEqual({
      key: 'spawn-contract-bundle-drift',
      severity: 10,
      tone: 'amber',
      text: 'bundle differs from /tmp/bundle.mjs (evidence, not the verdict)',
    });
  });
});
