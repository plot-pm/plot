import { describe, expect, it } from 'vitest';

import { censusGate, findStrace, traceExecs } from './strace-run.js';

const gate = censusGate({ stracePath: findStrace(process.env['PATH'] ?? ''), platform: process.platform });

describe.skipIf(gate.kind !== 'run')('traceExecs under strace -f', () => {
  it('returns every image a command tree starts, each with its parent', async () => {
    const actual = await traceExecs('/bin/sh', ['-c', '/bin/echo one >/dev/null; /bin/sh -c "/bin/echo two >/dev/null; :"; :']);

    expect(actual.code).toBe(0);
    const [root, ...rest] = actual.execs;
    expect(root).toMatchObject({ ppid: null, path: '/bin/sh' });
    const one = rest.find((e) => e.argv.join(' ') === '/bin/echo one');
    const inner = rest.find((e) => e.path === '/bin/sh');
    const two = rest.find((e) => e.argv.join(' ') === '/bin/echo two');
    expect(one?.ppid).toBe(root?.pid);
    expect(inner?.ppid).toBe(root?.pid);
    expect(two?.ppid).toBe(inner?.pid);
  });

  it('passes the traced command exit code through', async () => {
    const actual = await traceExecs('/bin/sh', ['-c', 'exit 3']);

    expect(actual.code).toBe(3);
    expect(actual.execs).toHaveLength(1);
  });
});
