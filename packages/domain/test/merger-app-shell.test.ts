import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { mergerAppShell } from '../src/adapters/merger-app/merger-app-shell.js';
import type { ShellContext } from '../src/adapters/scripts.js';

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A scratch `ShellContext` whose `plot-merger-token.mjs` is a stub exiting `code` with `stderr`. */
const contextFor = (code: number, stderr = ''): ShellContext => {
  const repoRoot = mktemp();
  const scriptDir = mkdtemp('scripts-');
  roots.push(scriptDir);
  writeFileSync(
    join(scriptDir, 'plot-merger-token.mjs'),
    `#!/usr/bin/env node\n${stderr ? `process.stderr.write(${JSON.stringify(stderr)});\n` : ''}process.exit(${code});\n`,
  );
  chmodSync(join(scriptDir, 'plot-merger-token.mjs'), 0o755);
  return { repoRoot, scriptDir };
};

const mkdtemp = (prefix = 'merger-app-shell-'): string => mkdtempSync(join(tmpdir(), prefix));
const mktemp = (): string => {
  const dir = mkdtemp();
  roots.push(dir);
  return dir;
};

describe('mergerAppShell', () => {
  it('reads usable on exit 0', () => {
    expect(mergerAppShell(contextFor(0))).toEqual({ read: 'usable' });
  });

  it('reads absent on exit 5', () => {
    expect(mergerAppShell(contextFor(5, 'plot-host: pr-merge — Merger app not configured\n'))).toEqual({ read: 'absent' });
  });

  it('reads invalid with the reason on exit 4', () => {
    expect(mergerAppShell(contextFor(4, "plot-host: pr-merge — needs a 'Merger app' key\n"))).toEqual({
      read: 'invalid',
      reason: "plot-host: pr-merge — needs a 'Merger app' key",
    });
  });

  it('reads unread on any other exit code', () => {
    expect(mergerAppShell(contextFor(1))).toEqual({ read: 'unread' });
    expect(mergerAppShell(contextFor(3))).toEqual({ read: 'unread' });
  });

  it('reads unread where the script itself is missing', () => {
    const scriptDir = mkdtemp('scripts-missing-');
    roots.push(scriptDir);
    expect(mergerAppShell({ repoRoot: mktemp(), scriptDir })).toEqual({ read: 'unread' });
  });
});
