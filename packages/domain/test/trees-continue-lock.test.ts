import { describe, expect, it } from 'vitest';
import { treesFixture, treesGit } from '../src/adapters/index.js';

const context = { repoRoot: '/nowhere', scriptDir: '/nowhere/skills/plot/scripts' };

describe('Trees.continueLock through git', () => {
  it('answers unaskable where no lock reader was given', async () => {
    const read = await treesGit(context, undefined, null).continueLock('/desk');
    expect(read).toMatchObject({ ok: false, why: 'unaskable' });
  });

  it('answers what the reader says for the desk', async () => {
    const seen: string[] = [];
    const trees = treesGit(context, undefined, null, (desk) => {
      seen.push(desk);
      return { held: true, pid: 4242, expiresInMs: 1000 };
    });
    expect(await trees.continueLock('/desk')).toEqual({ ok: true, value: { held: true, pid: 4242, expiresInMs: 1000 } });
    expect(seen).toEqual(['/desk']);
  });

  it('fails where the reader cannot read the lock file', async () => {
    const trees = treesGit(context, undefined, null, () => {
      throw new Error('EACCES');
    });
    expect(await trees.continueLock('/desk')).toEqual({ ok: false, why: 'failed' });
  });
});

describe('Trees.continueLock in a fixture', () => {
  it('reads a desk absent from the table as holding no lock', async () => {
    expect(await treesFixture().continueLock('/desk')).toEqual({ ok: true, value: { held: false } });
  });

  it('answers the table, and fails for an unread lock', async () => {
    const trees = treesFixture({ continueLocks: { '/held': { held: true, pid: 7, expiresInMs: 5 }, '/unread': 'unread' } });
    expect(await trees.continueLock('/held')).toEqual({ ok: true, value: { held: true, pid: 7, expiresInMs: 5 } });
    expect(await trees.continueLock('/unread')).toEqual({ ok: false, why: 'failed' });
  });
});
