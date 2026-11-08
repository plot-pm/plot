import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appKeyShell } from '../src/adapters/merger-app/app-key-shell.js';
import { appKeyStartLines } from '../src/rules/app-key-start-lines.js';
import { probeAppKeysAtStart } from '../src/workflows/app-key-start-probe.js';

const scriptDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../skills/plot/scripts');
const KEY_ENV = ['PLOT_REVIEW_APP_KEY', 'PLOT_MERGER_APP_KEY', 'PLOT_WRITER_APP_KEY', 'XDG_CONFIG_HOME'];

describe('appKeyStartLines', () => {
  it('logs nothing for a usable key and for an undeclared one', () => {
    expect(
      appKeyStartLines([
        { configKey: 'Merger app', reading: { read: 'usable' } },
        { configKey: 'Writer app', reading: { read: 'absent' } },
      ]),
    ).toEqual([]);
  });

  it('names the key and the path for an invalid key', () => {
    expect(
      appKeyStartLines([{ configKey: 'Review app', reading: { read: 'invalid', reason: 'cannot be read: /x/k.pem' } }]),
    ).toEqual(["App key 'Review app' is not usable: cannot be read: /x/k.pem"]);
  });

  it('logs an unread check as a check that did not answer', () => {
    const [line] = appKeyStartLines([{ configKey: 'Merger app', reading: { read: 'unread' } }]);
    expect(line).toContain('the check did not answer');
  });

  it('logs a failed probe', () => {
    const [line] = appKeyStartLines([{ configKey: 'Merger app', reading: { read: 'failed', reason: 'boom' } }]);
    expect(line).toContain('probe failed (boom)');
  });
});

describe('probeAppKeysAtStart', () => {
  it('turns a throwing reader into a line and keeps reading', () => {
    const written: string[] = [];
    probeAppKeysAtStart((key) => {
      if (key === 'Review app') throw new Error('spawn failed');
      return { read: 'usable' };
    }, (line) => written.push(line));
    expect(written).toEqual(["App key 'Review app': the start probe failed (spawn failed)"]);
  });

  it('names a thrown value that is not an Error', () => {
    const lines = probeAppKeysAtStart((key) => {
      if (key === 'Merger app') throw 'no shell';
      return { read: 'usable' };
    }, () => {});
    expect(lines).toEqual(["App key 'Merger app': the start probe failed (no shell)"]);
  });
});

describe('the probe over a scratch repository', () => {
  let root: string;
  let config: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEY_ENV) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    root = mkdtempSync(join(tmpdir(), 'app-key-probe-'));
    config = join(root, 'xdg');
    process.env.XDG_CONFIG_HOME = config;
    execFileSync('git', ['init', '-q'], { cwd: root });
  });

  afterEach(() => {
    for (const key of KEY_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(root, { recursive: true, force: true });
  });

  const declare = (lines: string[]): void =>
    writeFileSync(join(root, 'CLAUDE.md'), `# T\n\n## Plot Config\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
  const lines = (): string[] => probeAppKeysAtStart((key) => appKeyShell({ repoRoot: root, scriptDir }, key), () => {});

  it('logs nothing for an id-only line whose key is in the config folder', () => {
    declare(['**Merger app:** 4242']);
    mkdirSync(join(config, 'plot'), { recursive: true });
    writeFileSync(join(config, 'plot', 'plot-merger.4242.private-key.pem'), 'k');
    expect(lines()).toEqual([]);
  });

  it('names the folder path for an id-only line whose key is missing', () => {
    declare(['**Merger app:** 4242']);
    const out = lines();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(join(config, 'plot', 'plot-merger.4242.private-key.pem'));
  });

  it('logs nothing where no App key is declared', () => {
    declare(['**Plan directory:** docs/plans/']);
    expect(lines()).toEqual([]);
  });

  it('checks the Review app key as well', () => {
    declare(['**Review app:** 77']);
    const out = lines();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("'Review app'");
    expect(out[0]).toContain('plot-review.77.private-key.pem');
  });
});
