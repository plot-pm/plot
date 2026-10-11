import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { actionReceiptsFile } from '../src/adapters/action-receipts/action-receipts-file.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const repoWith = (action?: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'plot-action-receipts-'));
  made.push(root);
  if (action !== undefined) {
    const dir = join(root, '.plot', 'state', 'action-receipts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, action), `${action}\tslug\t2026-10-11T10:00:00\n`);
  }
  return root;
};

describe('actionReceiptsFile.clears', () => {
  it('clears an action with a receipt and leaves the file in place', async () => {
    const root = repoWith('approve');
    const receipts = actionReceiptsFile(root);
    expect(await receipts.clears('approve')).toEqual({ ok: true, value: true });
    expect(await receipts.clears('approve')).toEqual({ ok: true, value: true });
    expect(existsSync(join(root, '.plot', 'state', 'action-receipts', 'approve'))).toBe(true);
  });

  it('does not clear another action', async () => {
    expect(await actionReceiptsFile(repoWith('approve')).clears('deliver')).toEqual({ ok: true, value: false });
  });

  it('answers false when no receipt directory exists', async () => {
    expect(await actionReceiptsFile(repoWith()).clears('dispatch')).toEqual({ ok: true, value: false });
  });
});
