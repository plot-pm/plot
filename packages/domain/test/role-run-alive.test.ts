import { describe, expect, it } from 'vitest';

import { ROLE_NAMES } from '../src/rules/role-command.js';
import { roleRunAlive, type PidCheck } from '../src/rules/role-run-alive.js';

const read = (role: (typeof ROLE_NAMES)[number], pid: string, check: PidCheck) =>
  roleRunAlive({ role, pid, check: () => check });

describe('roleRunAlive', () => {
  it('follows the process table when it answers', () => {
    for (const role of ROLE_NAMES) {
      expect(read(role, '42', 'alive')).toBe(true);
      expect(read(role, '42', 'dead')).toBe(false);
    }
  });

  it('reads an unanswerable pid as alive for the roles that write', () => {
    expect(read('fixer', '42', 'unanswerable')).toBe(true);
    expect(read('main-repair', '42', 'unanswerable')).toBe(true);
  });

  it('reads an unanswerable pid as not alive for the read-only roles', () => {
    expect(read('reviewer', '42', 'unanswerable')).toBe(false);
    expect(read('unblocker', '42', 'unanswerable')).toBe(false);
  });

  it('reads no recorded pid as not alive without asking', () => {
    for (const pid of ['', '0', '-3', '4x', '1.5']) {
      expect(roleRunAlive({ role: 'fixer', pid, check: () => { throw new Error('asked'); } })).toBe(false);
    }
  });
});
