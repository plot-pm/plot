import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planStoreShell } from '../src/adapters/plan-store/plan-store-shell.js';
import { planStoreFixture } from '../src/adapters/plan-store/plan-store-fixture.js';
import { shellContext } from '../src/adapters/scripts.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plot-plan-store-write-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('planStoreShell: writeText', () => {
  it('replaces the file by rename, so a reader never sees a half-written one', async () => {
    const file = join(dir, 'plan.md');
    writeFileSync(file, 'old');
    const before = statSync(file).ino;
    const store = planStoreShell(shellContext(dir));
    expect(await store.writeText(file, 'new content')).toEqual({ ok: true, value: undefined });
    expect(readFileSync(file, 'utf8')).toBe('new content');
    // An in-place write keeps the inode; a rename over the target gives a new one.
    expect(statSync(file).ino).not.toBe(before);
    expect(readdirSync(dir)).toEqual(['plan.md']);
  });

  it('leaves the target and no temporary file behind when the rename fails', async () => {
    const target = join(dir, 'plan.md');
    mkdirSync(join(target, 'inside'), { recursive: true });
    const store = planStoreShell(shellContext(dir));
    expect((await store.writeText(target, 'x')).ok).toBe(false);
    expect(statSync(target).isDirectory()).toBe(true);
    expect(readdirSync(dir)).toEqual(['plan.md']);
  });

  it('creates missing parent directories and resolves a relative path against the repository', async () => {
    const store = planStoreShell(shellContext(dir));
    expect((await store.writeText('.plot/hold', 'a\n')).ok).toBe(true);
    expect(readFileSync(join(dir, '.plot', 'hold'), 'utf8')).toBe('a\n');
  });
});

describe('planStoreShell: readText and listDir', () => {
  it('answers null for an absent file and an empty list for an absent directory', async () => {
    const store = planStoreShell(shellContext(dir));
    expect(await store.readText('nope.md')).toEqual({ ok: true, value: null });
    expect(await store.listDir('nope')).toEqual({ ok: true, value: [] });
  });

  it('reads a file and lists a directory in name order', async () => {
    writeFileSync(join(dir, 'b.md'), 'B');
    writeFileSync(join(dir, 'a.md'), 'A');
    const store = planStoreShell(shellContext(dir));
    expect(await store.readText('b.md')).toEqual({ ok: true, value: 'B' });
    expect(await store.listDir('.')).toEqual({ ok: true, value: ['a.md', 'b.md'] });
  });
});

describe('planStoreFixture: the file operations', () => {
  it('writes, reads and lists the files it holds', async () => {
    const store = planStoreFixture({ files: { 'docs/sprints/a.md': 'A' } });
    await store.writeText('docs/sprints/b.md', 'B');
    await store.writeText('docs/sprints/sub/c.md', 'C');
    expect(await store.readText('docs/sprints/b.md')).toEqual({ ok: true, value: 'B' });
    expect(await store.readText('docs/sprints/none.md')).toEqual({ ok: true, value: null });
    expect(await store.listDir('docs/sprints/')).toEqual({ ok: true, value: ['a.md', 'b.md'] });
  });
});
