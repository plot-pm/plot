import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordBridge } from '../../src/server/entry/pulse-log.js';

describe('recordBridge where the state home is unread', () => {
  let dir: string;

  beforeEach(() => {
    // A directory outside any repository: git names no common dir for it.
    dir = mkdtempSync(join(tmpdir(), 'record-bridge-unread-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes nothing and does not throw', () => {
    const write = () => recordBridge(dir, { version: 1, plans: [] }, Date.now());

    expect(write).not.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });
});
