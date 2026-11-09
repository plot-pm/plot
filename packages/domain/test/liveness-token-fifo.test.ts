import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { livenessTokenFifo } from '../src/adapters/liveness-token/liveness-token-fifo.js';
import { TOKEN_FILENAME } from '../src/rules/worker-liveness.js';

const roots: string[] = [];
const children: ChildProcess[] = [];
afterAll(() => {
  for (const child of children) child.kill('SIGKILL');
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const desk = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'plot-token-')));
  roots.push(root);
  return root;
};

/** A `sleep` that inherited the token on fd 3. */
const holder = (fd: number): ChildProcess => {
  const child = spawn('sleep', ['30'], { stdio: ['ignore', 'ignore', 'ignore', fd] });
  children.push(child);
  return child;
};

const ended = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', () => resolve())));

describe('livenessTokenFifo', () => {
  const token = livenessTokenFifo();

  it('reads none where no token was made, and where a regular file stands at the path', () => {
    const d = desk();
    expect(token.read(d)).toEqual({ state: 'none', madeAtMs: null });
    writeFileSync(join(d, TOKEN_FILENAME), 'x');
    expect(token.read(d)).toEqual({ state: 'none', madeAtMs: null });
  });

  it('reads held while a holder lives and released once the last holder ends', async () => {
    const d = desk();
    const made = token.make(d);
    if (!made.ok) throw new Error(made.reason);
    expect(made.token.path).toBe(join(d, TOKEN_FILENAME));
    const child = holder(made.token.fd);
    token.close(made.token);
    token.close(made.token);
    expect(token.read(d)).toMatchObject({ state: 'held' });
    expect(token.read(d).madeAtMs).toBeGreaterThan(0);
    child.kill('SIGKILL');
    await ended(child);
    expect(token.read(d)).toMatchObject({ state: 'released' });
  });

  it('replaces an earlier run’s token by rename, so its stray holder does not hold the new one', async () => {
    const d = desk();
    const first = token.make(d);
    if (!first.ok) throw new Error(first.reason);
    const stray = holder(first.token.fd);
    token.close(first.token);
    const second = token.make(d);
    if (!second.ok) throw new Error(second.reason);
    token.close(second.token);
    expect(token.read(d)).toMatchObject({ state: 'released' });
    expect(readdirSync(d)).toEqual([TOKEN_FILENAME]);
    stray.kill('SIGKILL');
    await ended(stray);
  });

  it('leaves no file at the token path and names the reason when mkfifo fails', () => {
    const d = desk();
    const first = token.make(d);
    if (!first.ok) throw new Error(first.reason);
    token.close(first.token);
    const made = livenessTokenFifo('false').make(d);
    expect(made).toMatchObject({ ok: false });
    expect(!made.ok && made.reason).toContain(`${join(d, TOKEN_FILENAME)}.`);
    expect(existsSync(join(d, TOKEN_FILENAME))).toBe(false);
    expect(readdirSync(d)).toEqual([]);
  });

  it('names the missing program when mkfifo cannot start', () => {
    const made = livenessTokenFifo('/nonexistent/mkfifo').make(desk());
    expect(!made.ok && made.reason).toContain('ENOENT');
  });
});
