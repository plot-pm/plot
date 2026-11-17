import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRoleRuns } from '../../src/server/fleet.js';

let root = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'role-runs-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const state = (name: string, body: string): void => {
  const file = join(root, '.plot', 'state', name);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, body);
};

describe('readRoleRuns', () => {
  it('reads one agent per source and leaves the rest when one file is unparseable', async () => {
    const now = Date.now();
    state('review-in-flight.json', JSON.stringify([{ pr: 7, head: 'abcdef123', pid: process.pid, startedAt: now, mode: 'review' }]));
    state('fixer-attempts/8.json', 'not json');
    state('auto-design-in-flight.json', '{bad');
    const runs = await readRoleRuns(root, now);
    expect(runs.map((r) => r.role)).toEqual(['reviewer']);
  });

  it('reads no agent from an empty state directory', async () => {
    expect(await readRoleRuns(root, Date.now())).toEqual([]);
  });
});
