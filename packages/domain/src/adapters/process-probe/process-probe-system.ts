import { spawnSync } from 'node:child_process';
import type { OwnProcess, ProcessProbe } from '../../ports/process-probe.js';

/**
 * Maps `kill(target, 0)` onto an answer: `EPERM` is a process this user may not
 * signal, and so a live one.
 */
const signalZero = (target: number): boolean | null => {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    return null;
  }
};

/**
 * The real {@link ProcessProbe}: `kill(pid, 0)` for liveness, `kill(-pgid, 0)`
 * for a group, and `ps -o lstart=` for a start time.
 *
 * @returns the {@link ProcessProbe} port.
 */
export const processProbeSystem = (): ProcessProbe => {
  const alive = (pid: number): boolean | null =>
    Number.isInteger(pid) && pid > 0 ? signalZero(pid) : false;
  // `kill(-1, 0)` addresses every process this user may signal, and `-0` the
  // caller's own group: neither names one group.
  const groupAlive = (pgid: number): boolean | null =>
    Number.isInteger(pgid) && pgid > 1 ? signalZero(-pgid) : false;
  return {
    alive,
    groupAlive,
    startedAt: (pid) => {
      if (!Number.isInteger(pid) || pid <= 0) return null;
      const run = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C' },
      });
      if (run.status !== 0) return null;
      const started = Date.parse(run.stdout.trim());
      return Number.isNaN(started) ? null : started;
    },
    self: (): OwnProcess => ({
      pid: process.pid,
      startedAt: Math.trunc(Date.now() - process.uptime() * 1000),
      leadsGroup: groupAlive(process.pid) === true,
    }),
  };
};
