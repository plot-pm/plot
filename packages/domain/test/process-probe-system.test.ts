import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';

import { processProbeSystem } from '../src/adapters/process-probe/process-probe-system.js';
import { IMPLEMENT_LOCK_SKEW_MS } from '../src/rules/implement-lock.js';

/** A pid no process holds: one that just exited. */
const deadPid = (): number => {
  const run = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(run.stdout);
};

describe('processProbeSystem', () => {
  const probe = processProbeSystem();

  it('reads this process as alive and an exited one as gone', () => {
    expect(probe.alive(process.pid)).toBe(true);
    expect(probe.alive(deadPid())).toBe(false);
    expect(probe.alive(0)).toBe(false);
    expect(probe.alive(1.5)).toBe(false);
  });

  it('reads a process this user may not signal as alive', () => {
    // pid 1 belongs to root, so `kill(1, 0)` answers EPERM for any other user.
    if (process.getuid?.() === 0) return;
    expect(probe.alive(1)).toBe(true);
  });

  it('reads a start time for this process within the lock skew of its own', () => {
    const started = probe.startedAt(process.pid);
    expect(started).not.toBeNull();
    expect(Math.abs((started as number) - probe.self().startedAt)).toBeLessThan(IMPLEMENT_LOCK_SKEW_MS);
  });

  it('reads no start time for an exited or invalid pid', () => {
    expect(probe.startedAt(deadPid())).toBeNull();
    expect(probe.startedAt(-3)).toBeNull();
  });

  it('answers a group question only for a group id above 1', () => {
    expect(probe.groupAlive(0)).toBe(false);
    expect(probe.groupAlive(1)).toBe(false);
    expect(probe.groupAlive(deadPid())).toBe(false);
  });

  it('reads a detached child\'s group as alive until the child exits', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { detached: true, stdio: 'ignore' });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    try {
      expect(probe.groupAlive(child.pid as number)).toBe(true);
    } finally {
      child.kill();
      await exited;
    }
    expect(probe.groupAlive(child.pid as number)).toBe(false);
  });

  it('reads this process\'s own pid and leadership', () => {
    const self = probe.self();
    expect(self.pid).toBe(process.pid);
    expect(self.leadsGroup).toBe(probe.groupAlive(process.pid) === true);
  });
});
