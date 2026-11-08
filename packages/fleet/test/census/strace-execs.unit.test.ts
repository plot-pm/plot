import { describe, expect, it } from 'vitest';

import { parseStraceExecs } from './strace-execs.js';

// Recorded `strace -f -qq -s 4096 -e trace=execve,execveat,clone,clone3,fork,vfork -o <file>`
// output. With `-o` and `-f`, each line starts with the pid and two spaces.
const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;

describe('parseStraceExecs', () => {
  it('counts every execve in a three-level tree and attributes each to its parent', () => {
    const text = lines(
      '100  execve("/bin/sh", ["sh", "-c", "bash -c \'git status\'"], 0x7ffd2a8 /* 20 vars */) = 0',
      '100  clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x7f1) = 101',
      '101  execve("/usr/bin/bash", ["bash", "-c", "git status"], 0x55d /* 20 vars */) = 0',
      '101  clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x7f2) = 102',
      '102  execve("/usr/bin/git", ["git", "status"], 0x55e /* 20 vars */) = 0',
      '102  +++ exited with 0 +++',
      '101  --- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_pid=102, si_uid=1000, si_status=0} ---',
    );

    const actual = parseStraceExecs(text);

    expect(actual.execs).toEqual([
      { pid: 100, ppid: null, syscall: 'execve', path: '/bin/sh', argv: ['sh', '-c', "bash -c 'git status'"] },
      { pid: 101, ppid: 100, syscall: 'execve', path: '/usr/bin/bash', argv: ['bash', '-c', 'git status'] },
      { pid: 102, ppid: 101, syscall: 'execve', path: '/usr/bin/git', argv: ['git', 'status'] },
    ]);
    expect(actual.forksWithoutExec).toEqual([]);
  });

  it('does not count an execve that fails with ENOENT, because no image starts', () => {
    const text = lines(
      '200  execve("/usr/local/bin/git", ["git", "rev-parse"], 0x7ff /* 9 vars */) = -1 ENOENT (No such file or directory)',
      '200  execve("/usr/bin/git", ["git", "rev-parse"], 0x7ff /* 9 vars */) = 0',
    );

    const actual = parseStraceExecs(text);

    expect(actual.execs).toEqual([
      { pid: 200, ppid: null, syscall: 'execve', path: '/usr/bin/git', argv: ['git', 'rev-parse'] },
    ]);
  });

  it('counts an execveat', () => {
    const text = lines(
      '300  vfork() = 301',
      '301  execveat(3, "", ["sleep", "1"], 0x7ff /* 4 vars */, AT_EMPTY_PATH) = 0',
    );

    const actual = parseStraceExecs(text);

    expect(actual.execs).toEqual([{ pid: 301, ppid: 300, syscall: 'execveat', path: '', argv: ['sleep', '1'] }]);
  });

  it('records a fork with no exec as secondary and never as an exec', () => {
    const text = lines(
      '400  execve("/bin/bash", ["bash", "-c", "x=$(echo hi)"], 0x7ff /* 3 vars */) = 0',
      '400  clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x7f) = 401',
      '401  +++ exited with 0 +++',
    );

    const actual = parseStraceExecs(text);

    expect(actual.execs).toHaveLength(1);
    expect(actual.forksWithoutExec).toEqual([{ pid: 401, ppid: 400 }]);
  });

  it('joins an unfinished execve with its resumed result', () => {
    const text = lines(
      '500  clone3({flags=CLONE_VM|CLONE_VFORK, exit_signal=SIGCHLD, stack=0x7f, stack_size=0x9000}, 88 <unfinished ...>',
      '501  execve("/bin/true", ["true"], 0x7ff /* 2 vars */ <unfinished ...>',
      '500  <... clone3 resumed>) = 501',
      '501  <... execve resumed>) = 0',
      '502  execve("/nope", ["nope"], 0x7ff /* 2 vars */ <unfinished ...>',
      '502  <... execve resumed>) = -1 ENOENT (No such file or directory)',
    );

    const actual = parseStraceExecs(text);

    expect(actual.execs).toEqual([{ pid: 501, ppid: 500, syscall: 'execve', path: '/bin/true', argv: ['true'] }]);
  });

  it('attributes a child whose lines precede the parent clone result', () => {
    const text = lines(
      '600  clone(child_stack=NULL, flags=SIGCHLD <unfinished ...>',
      '601  execve("/bin/ls", ["ls"], 0x7ff /* 2 vars */) = 0',
      '600  <... clone resumed>) = 601',
    );

    expect(parseStraceExecs(text).execs[0]).toMatchObject({ pid: 601, ppid: 600 });
  });

  it('attributes an exec started from a thread to the process that owns the thread, and counts no thread as a fork', () => {
    const text = lines(
      '700  execve("/usr/bin/node", ["node", "server.mjs"], 0x7ff /* 5 vars */) = 0',
      '700  clone3({flags=CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM, exit_signal=0, stack=0x7f}, 88) = 701',
      '701  clone3({flags=CLONE_VM|CLONE_VFORK, exit_signal=SIGCHLD, stack=0x7f}, 88) = 702',
      '702  execve("/usr/bin/git", ["git", "fetch"], 0x7ff /* 5 vars */) = 0',
    );

    const actual = parseStraceExecs(text);

    expect(actual.execs[1]).toMatchObject({ pid: 702, ppid: 700 });
    expect(actual.forksWithoutExec).toEqual([]);
  });

  it('reads the [pid N] prefix and C escapes in argv', () => {
    const text = lines(
      '[pid   800] execve("/bin/echo", ["echo", "a \\"b\\"\\n", "tab\\there"], 0x7ff /* 1 var */) = 0',
    );

    expect(parseStraceExecs(text).execs[0]).toEqual({
      pid: 800,
      ppid: null,
      syscall: 'execve',
      path: '/bin/echo',
      argv: ['echo', 'a "b"\n', 'tab\there'],
    });
  });

  it('keeps a truncated argv as far as strace printed it', () => {
    const text = lines('900  execve("/bin/x", ["x", "abc"...], 0x7ff /* 1 var */) = 0');

    expect(parseStraceExecs(text).execs[0]?.argv).toEqual(['x', 'abc']);
  });
});
