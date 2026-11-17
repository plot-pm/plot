import { describe, expect, it, vi } from 'vitest';

import { run } from '../../src/server/entry/deliver-command.js';

describe('deliver-command', () => {
  it('refuses PLOT_UNATTENDED=1 before it reads the plan', async () => {
    const inner = vi.fn(async () => 0);
    let warned = '';
    const code = await run(['a-slug'], '/x', '/y', { run: inner, env: { PLOT_UNATTENDED: '1' } }, () => {}, (s) => (warned += s));
    expect(code).toBe(1);
    expect(inner).not.toHaveBeenCalled();
    expect(warned).toMatch(/board/);
  });

  it.each([['--release'], ['--release=1.2.3']])('refuses %s and names the release button', async (flag) => {
    const inner = vi.fn(async () => 0);
    let warned = '';
    const code = await run([flag, 'a-slug'], '/x', '/y', { run: inner, env: {} }, () => {}, (s) => (warned += s));
    expect(code).toBe(1);
    expect(inner).not.toHaveBeenCalled();
    expect(warned).toMatch(/release button/);
  });

  it('forwards its arguments and exit code to the deliver entry', async () => {
    const inner = vi.fn(async () => 4);
    const code = await run(['--branch', 'b', 'a-slug'], '/cwd', '/scripts', { run: inner, env: {} });
    expect(code).toBe(4);
    expect(inner.mock.calls[0].slice(0, 3)).toEqual([['--branch', 'b', 'a-slug'], '/cwd', '/scripts']);
  });
});
