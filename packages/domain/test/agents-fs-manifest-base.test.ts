import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { manifestBaseOf } from '../src/adapters/agents/agents-fs.js';

const made: string[] = [];
const temp = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('manifestBaseOf', () => {
  it('answers the base of the manifest whose worktree is the desk, through a symlink', async () => {
    const registry = temp('plot-manifest-base-registry-');
    const desk = temp('plot-manifest-base-desk-');
    const link = path.join(temp('plot-manifest-base-link-'), 'desk');
    fs.symlinkSync(desk, link);
    fs.writeFileSync(path.join(registry, 'a.json'), JSON.stringify({ session: 'a', worktree: '/elsewhere', base: 'sprint/other' }));
    fs.writeFileSync(path.join(registry, 'b.json'), JSON.stringify({ session: 'b', worktree: link, base: 'sprint/s' }));
    fs.writeFileSync(path.join(registry, 'c.json'), '{ not json');
    expect(await manifestBaseOf({ repoRoot: desk, scriptDir: desk }, desk, registry)).toEqual({ ok: true, value: 'sprint/s' });
  });

  it('answers empty where no manifest names the desk or the manifest records no base', async () => {
    const registry = temp('plot-manifest-base-registry-');
    const desk = temp('plot-manifest-base-desk-');
    fs.writeFileSync(path.join(registry, 'a.json'), JSON.stringify({ session: 'a', worktree: desk }));
    expect(await manifestBaseOf({ repoRoot: desk, scriptDir: desk }, desk, registry)).toEqual({ ok: true, value: '' });
    expect(await manifestBaseOf({ repoRoot: desk, scriptDir: desk }, '/nowhere', registry)).toEqual({ ok: true, value: '' });
  });

  it('fails where the registry cannot be listed', async () => {
    const desk = temp('plot-manifest-base-desk-');
    expect((await manifestBaseOf({ repoRoot: desk, scriptDir: desk }, desk, path.join(desk, 'missing'))).ok).toBe(false);
  });
});
