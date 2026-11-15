// Who is reading the board — the host user and git's email in `serverInfo`.
//
// Wave 1 of docs/plans/2026-09-24-the-board-shows-me-only-my-work.md. The two
// readings arrive through the host and trees adapters, and an absent one is
// `''`. The memo is per module, so each case loads a fresh one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { hostFixture, planStoreFixture, treesFixture } from '@plot-pm/domain/adapters';
import type { BuildBoardOptions } from '../../src/server/board.js';
import { removeTree } from '../rm-tree.mjs';

const ROOT = '/estate';

const serverInfoWith = async (fixture: { account?: string; email?: string; people?: string }) => {
  vi.resetModules();
  const mod = await import('../../src/server/server-info.js');
  const opts = {
    repoRoot: ROOT,
    scriptsDir: ROOT,
    hostAdapter: hostFixture({ account: fixture.account }),
    planStore: planStoreFixture({ config: fixture.people === undefined ? {} : { People: fixture.people } }),
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

describe('the server carries the declared People directory', () => {
  it('reads the People key into spelling-to-handle pairs', async () => {
    const info = await serverInfoWith({ account: 'jwloka', people: 'jwloka = Jan Wloka; eins78 = Max Albrecht' });
    expect(info.people).toEqual({
      jwloka: 'jwloka',
      'jan wloka': 'jwloka',
      eins78: 'eins78',
      'max albrecht': 'eins78',
    });
  });

  it('carries an empty directory where no key is declared', async () => {
    const info = await serverInfoWith({ account: 'jwloka' });
    expect(info.people).toEqual({});
  });
});

describe('the PR beat reads the identity held, and never asks again', () => {
  it('asks once where none is held, then answers the held reading while no identity file changed', async () => {
    vi.resetModules();
    const mod = await import('../../src/server/server-info.js');
    const host = hostFixture({ account: 'jwloka' });
    const account = vi.spyOn(host, 'account');
    const opts = {
      repoRoot: ROOT,
      scriptsDir: ROOT,
      hostAdapter: host,
      trees: treesFixture({ branches: { [ROOT]: 'main' }, emails: { [ROOT]: 'jan.wloka@quatico.com' } }),
    } as unknown as BuildBoardOptions;
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      expect((await mod.heldIdentity(opts)).hostUser).toBe('jwloka');
      now.mockReturnValue(start + 10 * 60_000);
      expect((await mod.heldIdentity(opts)).gitEmail).toBe('jan.wloka@quatico.com');
      expect(account).toHaveBeenCalledTimes(1);
      await mod.identity(opts);
      expect(account).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });
});

describe('the identity is read on a stamp change only', () => {
  const made: string[] = [];
  const saved = process.env.GH_CONFIG_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.GH_CONFIG_DIR;
    else process.env.GH_CONFIG_DIR = saved;
    for (const dir of made.splice(0)) removeTree(dir);
  });

  it('starts no process on 10 reads with no stamp change, and asks Host.account() once after hosts.yml moves', async () => {
    vi.resetModules();
    const mod = await import('../../src/server/server-info.js');
    const gh = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-identity-gh-'));
    made.push(gh);
    const hosts = path.join(gh, 'hosts.yml');
    fs.writeFileSync(hosts, 'github.com:\n  user: jwloka\n');
    process.env.GH_CONFIG_DIR = gh;
    const host = hostFixture({ account: 'jwloka' });
    const account = vi.spyOn(host, 'account');
    const trees = treesFixture({ branches: { [ROOT]: 'main' }, emails: { [ROOT]: 'jan.wloka@quatico.com' } });
    const email = vi.spyOn(trees, 'userEmail');
    const opts = {
      repoRoot: ROOT,
      scriptsDir: ROOT,
      hostAdapter: host,
      planStore: planStoreFixture({ config: {} }),
      trees,
    } as unknown as BuildBoardOptions;
    await mod.serverInfo(opts, 7777);
    account.mockClear();
    email.mockClear();
    for (let i = 0; i < 10; i += 1) await mod.serverInfo(opts, 7777);
    expect(account).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(hosts, later, later);
    await mod.serverInfo(opts, 7777);
    await mod.serverInfo(opts, 7777);
    expect(account).toHaveBeenCalledTimes(1);
  });

  it('names gh\'s hosts.yml, the repository config and the user\'s git config', async () => {
    const mod = await import('../../src/server/server-info.js');
    expect(mod.identityFiles('/r', { GH_CONFIG_DIR: '/gh' }, '/h')).toEqual([
      '/gh/hosts.yml',
      '/r/.git/config',
      '/h/.gitconfig',
      '/h/.config/git/config',
    ]);
  });
});
