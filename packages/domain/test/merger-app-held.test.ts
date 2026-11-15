import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mergerAppHeld, mergerKeyStamp } from '../src/adapters/merger-app/merger-app-held.js';
import type { MergerAppReading } from '../src/rules/merge-identity.js';

let root = '';
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'plot-merger-held-'));
});
afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

const context = { repoRoot: '/repo', scriptDir: '/scripts' };

describe('mergerAppHeld', () => {
  it('runs the check once while the stamp stands, and again after it moved', () => {
    let stamp = 'one';
    const reads: MergerAppReading[] = [{ read: 'usable' }, { read: 'absent' }];
    let calls = 0;
    const reader = mergerAppHeld(() => reads[calls++] ?? { read: 'unread' }, () => stamp);
    expect(reader.held(context)).toEqual({ read: 'usable' });
    expect(reader.held(context)).toEqual({ read: 'usable' });
    expect(calls).toBe(1);
    stamp = 'two';
    expect(reader.held(context)).toEqual({ read: 'absent' });
    expect(calls).toBe(2);
  });

  it('runs the check on every fresh read, and holds what it read', () => {
    let calls = 0;
    const reader = mergerAppHeld(() => {
      calls += 1;
      return calls === 1 ? { read: 'usable' } : { read: 'invalid', reason: 'gone' };
    }, () => 'same');
    reader.held(context);
    expect(reader.fresh(context)).toEqual({ read: 'invalid', reason: 'gone' });
    expect(reader.held(context)).toEqual({ read: 'invalid', reason: 'gone' });
    expect(calls).toBe(2);
  });
});

describe('mergerKeyStamp', () => {
  it('moves when a key file lands in the key directory, and when CLAUDE.md changes', () => {
    const repo = join(root, 'repo');
    mkdirSync(join(root, 'config', 'plot'), { recursive: true });
    mkdirSync(repo);
    const env = { XDG_CONFIG_HOME: join(root, 'config') };
    const ctx = { repoRoot: repo, scriptDir: '/scripts' };
    const before = mergerKeyStamp(ctx, env);
    expect(mergerKeyStamp(ctx, env)).toBe(before);
    writeFileSync(join(root, 'config', 'plot', 'plot-merger.1.private-key.pem'), 'key');
    const keyed = mergerKeyStamp(ctx, env);
    expect(keyed).not.toBe(before);
    writeFileSync(join(repo, 'CLAUDE.md'), '# config\n');
    expect(mergerKeyStamp(ctx, env)).not.toBe(keyed);
  });

  it('reads the directory PLOT_MERGER_APP_KEY names, and $HOME/.config where XDG_CONFIG_HOME is unset', () => {
    const stamp = mergerKeyStamp(context, { HOME: '/home/someone', PLOT_MERGER_APP_KEY: '/keys/merger.pem' });
    expect(stamp).toContain('/home/someone/.config/plot:absent');
    expect(stamp).toContain('/keys:absent');
  });
});
