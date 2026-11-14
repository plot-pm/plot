import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { spawnAttachedHolding } from '../src/adapters/agent-run/agent-run-sdk.js';
import { boundedRunProcess } from '../src/adapters/bounded-run/bounded-run-process.js';

const dir = mkdtempSync(join(tmpdir(), 'plot-token-hold-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A shell program that prints whether fd 3 is open. */
const PROBE = 'if [ -e /dev/fd/3 ]; then printf held; else printf none; fi';

describe('a harness start holds the token it is handed', () => {
  const processes = { childrenOf: async () => ({ ok: true as const, value: [] }) };

  it('boundedRun hands holdFd to the command as fd 3, and nothing without it', async () => {
    const fd = openSync(join(dir, 'token'), 'w');
    const held = join(dir, 'held.out');
    await boundedRunProcess(processes).run('bash', ['-c', PROBE], { cwd: dir, boundSeconds: 0, outFile: held, holdFd: fd });
    const none = join(dir, 'none.out');
    await boundedRunProcess(processes).run('bash', ['-c', PROBE], { cwd: dir, boundSeconds: 0, outFile: none });
    closeSync(fd);
    expect(readFileSync(held, 'utf8')).toBe('held');
    expect(readFileSync(none, 'utf8')).toBe('none');
  });

  it('the SDK spawn hands the descriptor to the child as fd 3, and nothing for null', async () => {
    const fd = openSync(join(dir, 'token-sdk'), 'w');
    const read = (holdFd: number | null): Promise<string> =>
      new Promise((resolve) => {
        const child = spawnAttachedHolding(holdFd)({ command: 'bash', args: ['-c', PROBE], cwd: dir, env: process.env, signal: new AbortController().signal } as never) as unknown as import('node:child_process').ChildProcess;
        let out = '';
        child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString()));
        child.once('close', () => resolve(out));
      });
    expect(await read(fd)).toBe('held');
    expect(await read(null)).toBe('none');
    closeSync(fd);
  });

  it('boundedRun answers failed for a holdFd that is not open, and starts nothing', async () => {
    const fd = 999;
    expect(() => fstatSync(fd)).toThrow();
    const out = join(dir, 'dead.out');
    const result = await boundedRunProcess(processes).run('bash', ['-c', 'printf ran'], { cwd: dir, boundSeconds: 0, outFile: out, holdFd: fd });
    expect(result).toEqual({ ok: false, why: 'failed' });
    expect(readFileSync(out, 'utf8')).toBe('');
  });
});
