import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fixerAttemptsFile, fixerAttemptsPath } from '../src/adapters/fixer-attempts/fixer-attempts-file.js';
import { FIXER_ATTEMPTS_VERSION, type FixerAttempt } from '../src/entities/fixer-attempts.js';

const attempt: FixerAttempt = {
  headSha: 'a'.repeat(40),
  finding: { kind: 'high', hash: 'h1' },
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fixer-attempts-file-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('fixerAttemptsFile', () => {
  it('reads a missing file as none, i.e. zero attempts', async () => {
    expect(await fixerAttemptsFile(root).read(42)).toEqual({ ok: true, value: 'none' });
  });

  it('reads a corrupt file as unreadable, not as none', async () => {
    mkdirSync(dirname(fixerAttemptsPath(root, 42)), { recursive: true });
    writeFileSync(fixerAttemptsPath(root, 42), '{ not json');
    expect(await fixerAttemptsFile(root).read(42)).toEqual({ ok: true, value: 'unreadable' });
  });

  it('reads a wrong-version file as unreadable', async () => {
    mkdirSync(dirname(fixerAttemptsPath(root, 42)), { recursive: true });
    writeFileSync(
      fixerAttemptsPath(root, 42),
      JSON.stringify({ v: FIXER_ATTEMPTS_VERSION + 1, pr: 42, attempts: [] }),
    );
    expect(await fixerAttemptsFile(root).read(42)).toEqual({ ok: true, value: 'unreadable' });
  });

  it('round-trips an appended attempt', async () => {
    const store = fixerAttemptsFile(root);
    expect((await store.append(42, attempt)).ok).toBe(true);
    expect(fixerAttemptsPath(root, 42)).toBe(join(root, '.plot', 'state', 'fixer-attempts', '42.json'));
    expect(await store.read(42)).toEqual({
      ok: true,
      value: { v: FIXER_ATTEMPTS_VERSION, pr: 42, attempts: [attempt] },
    });
  });

  it('counts two attempts on different heads of one PR as two entries in the same file', async () => {
    const store = fixerAttemptsFile(root);
    const second: FixerAttempt = { headSha: 'b'.repeat(40), finding: { kind: 'high', hash: 'h1' } };
    await store.append(42, attempt);
    await store.append(42, second);
    const result = await store.read(42);
    expect(result.ok).toBe(true);
    if (result.ok && result.value !== 'none' && result.value !== 'unreadable') {
      expect(result.value.attempts).toEqual([attempt, second]);
    } else {
      throw new Error('expected a record');
    }
  });

  it('keeps separate PRs in separate files', async () => {
    const store = fixerAttemptsFile(root);
    await store.append(1, attempt);
    expect(await store.read(2)).toEqual({ ok: true, value: 'none' });
  });

  it('refuses to append to an unreadable record rather than overwriting it', async () => {
    mkdirSync(dirname(fixerAttemptsPath(root, 42)), { recursive: true });
    writeFileSync(fixerAttemptsPath(root, 42), '{ not json');
    const result = await fixerAttemptsFile(root).append(42, attempt);
    expect(result).toEqual({ ok: false, why: 'failed' });
    expect(await fixerAttemptsFile(root).read(42)).toEqual({ ok: true, value: 'unreadable' });
  });

  it('leaves no temporary file after a write', async () => {
    await fixerAttemptsFile(root).append(42, attempt);
    expect(readdirSync(dirname(fixerAttemptsPath(root, 42)))).toEqual(['42.json']);
    expect(existsSync(fixerAttemptsPath(root, 42))).toBe(true);
  });

  it('surfaces a write failure the caller can refuse the fixer start on', async () => {
    const path = fixerAttemptsPath(root, 42);
    mkdirSync(dirname(path), { recursive: true });
    chmodSync(dirname(path), 0o500);
    try {
      const result = await fixerAttemptsFile(root).append(42, attempt);
      expect(result).toEqual({ ok: false, why: 'failed' });
    } finally {
      chmodSync(dirname(path), 0o700);
    }
  });

  it('surfaces a read failure distinct from a missing file', async () => {
    const path = fixerAttemptsPath(root, 42);
    mkdirSync(path, { recursive: true });
    const result = await fixerAttemptsFile(root).read(42);
    expect(result.ok).toBe(false);
  });
});
