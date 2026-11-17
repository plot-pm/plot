import { describe, expect, it, vi } from 'vitest';

import { run } from '../../src/server/entry/approve-command.js';

describe('approve-command', () => {
  it('refuses PLOT_UNATTENDED=1 before it reads the plan', async () => {
    const inner = vi.fn(async () => 0);
    let warned = '';
    const code = await run(['a-slug'], '/x', '/y', { run: inner, env: { PLOT_UNATTENDED: '1' } }, () => {}, (s) => (warned += s));
    expect(code).toBe(1);
    expect(inner).not.toHaveBeenCalled();
    expect(warned).toMatch(/board/);
    expect(warned).toMatch(/fleet/);
  });

  it('forwards its arguments, directory and exit code to the approve entry', async () => {
    const inner = vi.fn(async () => 7);
    const code = await run(['--who', 'jwloka', 'a-slug'], '/cwd', '/scripts', { run: inner, env: {} });
    expect(code).toBe(7);
    expect(inner.mock.calls[0].slice(0, 3)).toEqual([['--who', 'jwloka', 'a-slug'], '/cwd', '/scripts']);
  });
});
