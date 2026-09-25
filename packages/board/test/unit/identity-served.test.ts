// Who is reading the board — the host user and git's email in `serverInfo`.
//
// Wave 1 of docs/plans/2026-09-24-the-board-shows-me-only-my-work.md. The two
// readings arrive through the host and trees adapters, and an absent one is
// `''`. The memo is per module, so each case loads a fresh one.
import { describe, it, expect, vi } from 'vitest';
import { hostFixture, treesFixture } from '@plot-pm/domain/adapters';
import type { BuildBoardOptions } from '../../src/server/board.js';

const ROOT = '/estate';

const serverInfoWith = async (fixture: { account?: string; email?: string }) => {
  vi.resetModules();
  const mod = await import('../../src/server/server-info.js');
  const opts = {
    repoRoot: ROOT,
    scriptsDir: ROOT,
    hostAdapter: hostFixture({ account: fixture.account }),
    trees: treesFixture({
      branches: { [ROOT]: 'main' },
      emails: fixture.email === undefined ? {} : { [ROOT]: fixture.email },
    }),
  } as unknown as BuildBoardOptions;
  return mod.serverInfo(opts, 7777);
};

describe('the server names who is reading', () => {
  it('carries both identities, each as its own adapter answered it', async () => {
    const info = await serverInfoWith({ account: 'jwloka', email: 'jan.wloka@quatico.com' });
    expect(info.hostUser).toBe('jwloka');
    expect(info.gitEmail).toBe('jan.wloka@quatico.com');
  });

  it('answers `` for a reading that did not answer, never a placeholder', async () => {
    // CATCHES a payload that carries `unknown` as a login.
    const info = await serverInfoWith({});
    expect(info.hostUser).toBe('');
    expect(info.gitEmail).toBe('');
  });

  it('keeps one identity when the host names nobody', async () => {
    // Bitbucket's case: the host answers nothing, and git's email still travels.
    const info = await serverInfoWith({ email: 'jan.wloka@quatico.com' });
    expect(info.hostUser).toBe('');
    expect(info.gitEmail).toBe('jan.wloka@quatico.com');
  });
});
