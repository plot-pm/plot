import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { stateReceiptsFile } from '../src/adapters/state-receipts/state-receipts-file.js';

const oidOf = (content: string): string => {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PATH = 'docs/plans/2026-01-01-x.md';

const repoWith = (receipt?: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'plot-state-receipts-'));
  made.push(root);
  if (receipt !== undefined) {
    const dir = join(root, '.plot', 'state', 'state-receipts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, oidOf(PATH)), receipt);
  }
  return root;
};

const fileOf = (root: string): string => join(root, '.plot', 'state', 'state-receipts', oidOf(PATH));

describe('stateReceiptsFile.spend', () => {
  it('clears a matching receipt and deletes it, so the second spend answers false', async () => {
    const root = repoWith(`${PATH}\tDelivered\n`);
    const receipts = stateReceiptsFile(root, oidOf);
    expect(await receipts.spend(PATH, 'Delivered')).toEqual({ ok: true, value: true });
    expect(existsSync(fileOf(root))).toBe(false);
    expect(await receipts.spend(PATH, 'Delivered')).toEqual({ ok: true, value: false });
  });

  it('does not clear, and does not delete, a receipt for another value', async () => {
    const root = repoWith(`${PATH}\tApproved\n`);
    expect(await stateReceiptsFile(root, oidOf).spend(PATH, 'Delivered')).toEqual({ ok: true, value: false });
    expect(existsSync(fileOf(root))).toBe(true);
  });

  it('answers false when no receipt exists', async () => {
    expect(await stateReceiptsFile(repoWith(), oidOf).spend(PATH, 'Delivered')).toEqual({ ok: true, value: false });
  });

  it('answers false for a receipt with no value field', async () => {
    const root = repoWith('garbage');
    expect(await stateReceiptsFile(root, oidOf).spend(PATH, 'Delivered')).toEqual({ ok: true, value: false });
  });

  it('answers false when the receipt cannot be read', async () => {
    const root = repoWith(`${PATH}\tDelivered\n`);
    rmSync(fileOf(root));
    mkdirSync(fileOf(root));
    expect(await stateReceiptsFile(root, oidOf).spend(PATH, 'Delivered')).toEqual({ ok: true, value: false });
  });

  it('clears one of two concurrent spends of one receipt, in every trial', async () => {
    for (let trial = 0; trial < 20; trial += 1) {
      const root = repoWith(`${PATH}\tDelivered\n`);
      const receipts = stateReceiptsFile(root, oidOf);
      const answers = await Promise.all([receipts.spend(PATH, 'Delivered'), receipts.spend(PATH, 'Delivered')]);
      expect(answers.filter((answer) => answer.ok && answer.value)).toHaveLength(1);
    }
  });

  it('clears a matching receipt whose delete fails for a reason other than its absence', async () => {
    const root = repoWith(`${PATH}\tDelivered\n`);
    const dir = join(root, '.plot', 'state', 'state-receipts');
    chmodSync(dir, 0o500);
    try {
      expect(await stateReceiptsFile(root, oidOf).spend(PATH, 'Delivered')).toEqual({ ok: true, value: true });
      expect(existsSync(fileOf(root))).toBe(true);
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});
