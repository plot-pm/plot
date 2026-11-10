import { describe, expect, it } from 'vitest';

import { between, treeOf } from './census-session.js';
import type { ExecRecord, StraceCensus } from './strace-execs.js';

const exec = (pid: number, ppid: number | null, ...argv: string[]): ExecRecord => ({
  pid,
  ppid,
  syscall: 'execve',
  path: `/bin/${argv[0] ?? ''}`,
  argv,
});

describe('the census windows', () => {
  it('takes the images between two marks and leaves the marks out', () => {
    const execs = [
      exec(1, null, 'node'),
      exec(2, 1, 'git', 'warm'),
      exec(3, 1, 'true', 'census-mark', 'w0'),
      exec(4, 1, 'git', 'in'),
      exec(5, 1, 'true', 'census-mark', 'w1'),
      exec(6, 1, 'git', 'after'),
    ];

    expect(between(execs, 'w0', 'w1').map((e) => e.argv[1])).toEqual(['in']);
    expect(between(execs, null, 'w0').map((e) => e.argv[1])).toEqual([undefined, 'warm']);
    expect(() => between(execs, 'w1', 'w2')).toThrow(/no mark w2/);
  });

  it('keeps a process tree across a fork that never exec’d, and drops a stranger', () => {
    const census: StraceCensus = {
      execs: [exec(1, null, 'node'), exec(12, 11, 'git', 'status'), exec(20, null, 'other')],
      forksWithoutExec: [{ pid: 11, ppid: 1 }],
    };

    expect(treeOf(census, census.execs, 1).map((e) => e.pid)).toEqual([1, 12]);
  });
});
