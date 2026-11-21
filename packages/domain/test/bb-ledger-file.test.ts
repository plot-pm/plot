import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { bbAccountKey, bbLedgerFile } from '../src/adapters/host/bb-ledger-file.js';
import { tempDirs } from './fixtures/temp-dirs.js';

const tempDir = tempDirs();

// 2026-08-29T10:42:03Z.
const NOW_S = 1_788_000_123;
const EMAIL = 'Me.Name@Example.com';
const KEY = bbAccountKey(EMAIL);
const ADAPTER = fileURLToPath(new URL('../src/adapters/host/bb-ledger-file.ts', import.meta.url));

const ledgerAt = (dir: string, nowS = NOW_S) => {
  const lines: string[] = [];
  const ledger = bbLedgerFile({ env: { BB_STATE_DIR: dir }, now: () => nowS * 1000, log: (line) => lines.push(line) });
  return { ledger, lines };
};

const warnings = (lines: readonly string[]): string[] => lines.filter((line) => line.startsWith('warning: '));

describe('the account key', () => {
  it("is the first 12 hex characters of the SHA-256 of the email with ASCII letters lowercased, as bb's", () => {
    expect(bbAccountKey('me.name@example.com')).toBe(bbAccountKey('ME.NAME@EXAMPLE.COM'));
    expect(KEY).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('the file ledger', () => {
  it('appends one byte-exact line per request to the hour file and logs the account line once', async () => {
    const dir = join(tempDir('plot-bb-ledger-'), 'bb');
    const { ledger, lines } = ledgerAt(dir);
    const first = await ledger.guard(EMAIL, 800);
    await ledger.guard(EMAIL, 800);
    expect(readFileSync(join(dir, `requests-${KEY}-2026082910.log`), 'utf8')).toBe(`${NOW_S}\n${NOW_S}\n`);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(first).toEqual({
      verdict: 'send',
      fields: { requests: 1, ceiling: 800, pausedUntil: null, waitSeconds: 0, nextFreeAt: null },
    });
    expect(lines).toEqual([
      `bb-ledger: account key ${KEY}, request file ${join(dir, `requests-${KEY}-2026082910.log`)}, 1 requests in the last hour, ceiling 800, state directory ${dir}`,
    ]);
  });

  it('refuses at the ceiling and writes nothing', async () => {
    const dir = tempDir('plot-bb-ledger-');
    const file = join(dir, `requests-${KEY}-2026082910.log`);
    writeFileSync(file, `${NOW_S - 10}\n`);
    const { ledger } = ledgerAt(dir);
    expect(await ledger.guard(EMAIL, 1)).toMatchObject({ verdict: 'ceiling', waitSeconds: 3590 });
    expect(readFileSync(file, 'utf8')).toBe(`${NOW_S - 10}\n`);
  });

  it('prunes request files older than the previous hour and keeps the previous one', async () => {
    const dir = tempDir('plot-bb-ledger-');
    writeFileSync(join(dir, 'requests-other-2026082908.log'), '1\n');
    writeFileSync(join(dir, `requests-${KEY}-2026082909.log`), `${NOW_S - 3000}\n`);
    await ledgerAt(dir).ledger.guard(EMAIL, 800);
    expect(readdirSync(dir).sort()).toEqual([`requests-${KEY}-2026082909.log`, `requests-${KEY}-2026082910.log`]);
  });

  it('writes the pause file after a 429 by rename, and refuses while it holds', async () => {
    const dir = tempDir('plot-bb-ledger-');
    const { ledger } = ledgerAt(dir);
    expect(await ledger.pauseAfter429(EMAIL, '30')).toEqual({ end: NOW_S + 300, length: 300 });
    expect(readFileSync(join(dir, `pause-${KEY}`), 'utf8')).toBe(`${NOW_S + 300} 300\n`);
    expect(readdirSync(dir)).toEqual([`pause-${KEY}`]);
    expect(await ledger.guard(EMAIL, 800)).toMatchObject({ verdict: 'paused', waitSeconds: 300 });
    expect(await ledgerAt(dir, NOW_S + 100).ledger.pauseAfter429(EMAIL, null)).toEqual({ end: NOW_S + 400, length: 300 });
  });

  it('records the request with no count where the ceiling is off', async () => {
    const dir = tempDir('plot-bb-ledger-');
    expect(await ledgerAt(dir).ledger.guard(EMAIL, null)).toEqual({
      verdict: 'send',
      fields: { requests: null, ceiling: null, pausedUntil: null, waitSeconds: 0 },
    });
    expect(readFileSync(join(dir, `requests-${KEY}-2026082910.log`), 'utf8')).toBe(`${NOW_S}\n`);
  });
});

describe('state that cannot be kept lets the request go out, with one warning', () => {
  it('sends where the state directory is a file', async () => {
    const dir = join(tempDir('plot-bb-ledger-'), 'bb');
    writeFileSync(dir, '');
    const { ledger, lines } = ledgerAt(dir);
    expect(await ledger.guard(EMAIL, 800)).toEqual({ verdict: 'send', fields: null });
    expect(await ledger.guard(EMAIL, 800)).toEqual({ verdict: 'send', fields: null });
    expect(await ledger.pauseAfter429(EMAIL, null)).toEqual({ end: NOW_S + 300, length: 300 });
    expect(warnings(lines)).toEqual([
      `warning: bb-ledger cannot keep its request count in ${dir} (the state directory cannot be used); the hourly budget is off for this call`,
    ]);
  });

  it('sends where the state directory is not writable', async () => {
    const dir = tempDir('plot-bb-ledger-');
    chmodSync(dir, 0o500);
    try {
      const { ledger, lines } = ledgerAt(dir);
      expect(await ledger.guard(EMAIL, 800)).toEqual({ verdict: 'send', fields: null });
      expect(await ledger.pauseAfter429(EMAIL, null)).toEqual({ end: NOW_S + 300, length: 300 });
      expect(warnings(lines)).toHaveLength(1);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it('sends without a line where a request file cannot be read', async () => {
    const dir = tempDir('plot-bb-ledger-');
    mkdirSync(join(dir, `requests-${KEY}-2026082910.log`));
    const { ledger, lines } = ledgerAt(dir);
    expect(await ledger.guard(EMAIL, 800)).toEqual({ verdict: 'send', fields: null });
    expect(await ledger.guard(EMAIL, 800)).toEqual({ verdict: 'send', fields: null });
    expect(warnings(lines)).toEqual([
      `warning: bb-ledger cannot keep its request count in ${dir} (a request file cannot be read); the hourly budget is off for this call`,
    ]);
  });

  it('answers the pause where the pause file cannot be replaced', async () => {
    const dir = tempDir('plot-bb-ledger-');
    mkdirSync(join(dir, `pause-${KEY}`));
    writeFileSync(join(dir, `pause-${KEY}`, 'keep'), '');
    const { ledger, lines } = ledgerAt(dir);
    expect(await ledger.pauseAfter429(EMAIL, null)).toEqual({ end: NOW_S + 300, length: 300 });
    expect(readdirSync(dir)).toEqual([`pause-${KEY}`]);
    expect(warnings(lines)).toEqual([
      `warning: bb-ledger cannot keep its request count in ${dir} (the pause file cannot be written); the hourly budget is off for this call`,
    ]);
  });

  it('warns and sends where no state directory can be named', async () => {
    const lines: string[] = [];
    const ledger = bbLedgerFile({ env: {}, log: (line) => lines.push(line) });
    expect(await ledger.guard(EMAIL, 800)).toEqual({ verdict: 'send', fields: null });
    expect(warnings(lines)).toHaveLength(1);
  });
});

describe('concurrent writers', () => {
  it('never tear a line when six processes append at once', async () => {
    // Separate processes, because two promises in one process prove nothing
    // about O_APPEND. Each child resolves the adapter's `.js` imports to `.ts`.
    const root = tempDir('plot-bb-ledger-');
    const dir = join(root, 'bb');
    const writer = join(root, 'writer.mjs');
    writeFileSync(
      writer,
      [
        "import { registerHooks } from 'node:module';",
        'registerHooks({',
        '  resolve: (specifier, context, next) => {',
        '    try { return next(specifier, context); } catch (error) {',
        "      if (specifier.endsWith('.js')) return next(`${specifier.slice(0, -3)}.ts`, context);",
        '      throw error;',
        '    }',
        '  },',
        '});',
        'const [adapter, dir, count] = process.argv.slice(2);',
        'const { bbLedgerFile } = await import(adapter);',
        'const ledger = bbLedgerFile({ env: { BB_STATE_DIR: dir }, log: () => undefined });',
        "for (let index = 0; index < Number(count); index += 1) await ledger.guard('me.name@example.com', null);",
      ].join('\n'),
      'utf8',
    );
    const each = 150;
    const writers = 6;
    const exits = await Promise.all(
      Array.from(
        { length: writers },
        () =>
          new Promise<number | null>((resolve) => {
            const child = spawn(process.execPath, [writer, ADAPTER, dir, String(each)], { stdio: 'ignore' });
            child.on('close', resolve);
          }),
      ),
    );
    expect(exits).toEqual(Array(writers).fill(0));
    expect(existsSync(dir)).toBe(true);
    const text = readdirSync(dir)
      .filter((name) => name.startsWith(`requests-${KEY}-`))
      .map((name) => readFileSync(join(dir, name), 'utf8'))
      .join('');
    const lines = text.split('\n');
    expect(lines.pop()).toBe('');
    expect(lines).toHaveLength(each * writers);
    expect(lines.filter((line) => !/^\d{10}$/.test(line))).toEqual([]);
  }, 30_000);
});
