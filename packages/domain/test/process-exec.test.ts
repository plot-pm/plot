import { describe, it, expect, vi } from 'vitest';
import { processExec, type ExecveHost } from '../src/adapters/process-exec.js';

describe('processExec — unaskable, never failed, when the host carries no execve', () => {
  it('answers unaskable on a host with no execve function', async () => {
    const host: ExecveHost = {};
    const result = await processExec(host).replace('/bin/node', ['loop.js'], {});
    expect(result).toEqual({ ok: false, why: 'unaskable' });
  });
});

describe('processExec — failed, when execve exists and throws', () => {
  it('answers failed when the call throws', async () => {
    const execve = vi.fn(() => {
      throw new Error('EACCES');
    }) as unknown as ExecveHost['execve'];
    const host: ExecveHost = { execve };
    const result = await processExec(host).replace('/bin/node', ['loop.js'], { FOO: 'bar' });
    expect(result).toEqual({ ok: false, why: 'failed' });
    expect(execve).toHaveBeenCalledWith('/bin/node', ['loop.js'], { FOO: 'bar' });
  });
});
